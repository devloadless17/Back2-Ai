/**
 * Does the assistant actually refuse what it should?
 *
 *   npm run check:refusal
 *
 * The calibration script measures vectors. This measures the decision, by
 * calling the real retrieval pipeline the chat route calls, with a real
 * student's subject list. A threshold that looks right in a spreadsheet and a
 * pipeline that refuses correctly are not the same claim, and only the second
 * one matters.
 *
 * Off-syllabus questions must come back `ungrounded_refused`. On-syllabus ones
 * must come back grounded. Anything else is printed loudly.
 */

import { PrismaClient } from '@prisma/client';

import { embed } from '../src/lib/ai/embeddings';
import { retrieveGrounding, CONCEPT_LEVEL_THRESHOLD, EXACT_MATCH_THRESHOLD, RELEVANCE_LEAD } from '../src/lib/retrieval';
import { searchContentChunks } from '../src/lib/vector';

const db = new PrismaClient();

const OFF_SYLLABUS = [
  'How do I bake sourdough bread at home?',
  'What is the offside rule in football?',
  'Quel est le meilleur restaurant de Beyrouth ?',
  'Who won the 2018 World Cup final?',
  'How much does an iPhone cost in Lebanon?',
  'Donne-moi une recette de tabbouleh.',
  'What should I wear to a wedding in July?',
  'Can you help me write a CV for a waiter job?',
  'How do I fix a leaking tap?',
  'Comment changer un pneu de voiture ?',
  'Quelle est la meilleure serie sur Netflix ?',
  'What is the best way to learn guitar?',
  'Tell me a joke about cats.',
  'How do I renew my passport?',
];

const ON_SYLLABUS = [
  'How do I integrate by parts?',
  'Explain the photoelectric effect.',
  'What is an ester and how is it formed?',
  'What is radioactivity?',
  'How do I use complex numbers in geometry?',
  'What is a conditional probability?',
  'Explain the second law of Newton.',
  'What is the half-life of a reaction?',
  'How does a capacitor charge in an RC circuit?',
  'What is a mechanical oscillator?',
  "Comment etablir l'equation differentielle d'un circuit RC ?",
  "Qu'est-ce qu'une suite geometrique ?",
  'Comment etudier les variations de la fonction exponentielle ?',
  "Qu'est-ce que la cinetique chimique ?",
  'Comment calculer une integrale par parties ?',
];

async function main() {
  const track = await db.track.findFirst({ where: { code: 'GS' }, select: { id: true } });
  if (!track) {
    console.error('No GS track — seed the taxonomy first.');
    process.exitCode = 1;
    return;
  }
  const subjects = await db.subject.findMany({ where: { trackId: track.id }, select: { id: true, name: true } });
  const subjectIds = subjects.map((s) => s.id);
  // Tier 3 searches this student's own uploads; a user with none isolates the
  // measurement to the corpus, which is what is being checked.
  const PROBE_USER = '00000000-0000-0000-0000-000000000000';

  console.log(`GS student, ${subjects.length} subjects: ${subjects.map((s) => s.name).join(', ')}`);
  console.log(`thresholds: exact ${EXACT_MATCH_THRESHOLD}, concept ${CONCEPT_LEVEL_THRESHOLD}, lead ${RELEVANCE_LEAD}`);
  console.log('');

  let wrong = 0;

  console.log('  should be REFUSED:');
  for (const query of OFF_SYLLABUS) {
    const result = await retrieveGrounding({ query, subjectIds, userId: PROBE_USER });
    const refused = result.tier === 'ungrounded_refused';
    if (!refused) wrong += 1;
    const top = result.topSimilarity?.toFixed(3) ?? '—';
    console.log(`    ${refused ? 'refused ' : 'ANSWERED'}  ${top}  ${query.slice(0, 52)}`);
  }

  console.log('');
  console.log('  should be ANSWERED:');
  for (const query of ON_SYLLABUS) {
    const result = await retrieveGrounding({ query, subjectIds, userId: PROBE_USER });
    const answered = result.tier !== 'ungrounded_refused';
    if (!answered) wrong += 1;
    const top = result.topSimilarity?.toFixed(3) ?? '—';
    console.log(`    ${answered ? `${result.tier}` : 'REFUSED'}  ${top}  ${query.slice(0, 52)}`);
  }

  /*
   * The raw numbers behind each decision.
   *
   * Printed for every probe, including the refused ones, because a refusal
   * hides the score that caused it — and the score is the thing being tuned.
   * These are short, paraphrased questions of the kind students actually type,
   * which score materially lower than the sentences-lifted-from-chunks that
   * `npm run calibrate` uses as a proxy. Thresholds set from the proxy alone
   * are too high, which is what this section exists to show.
   */
  console.log('');
  console.log('  raw scores (top hit, and its lead over the field):');
  for (const [label, queries] of [
    ['off-syllabus', OFF_SYLLABUS],
    ['on-syllabus ', ON_SYLLABUS],
  ] as const) {
    for (const query of queries) {
      const vector = await embed(query, 'query');
      const hits = await searchContentChunks(vector, subjectIds, 20);
      const scores = hits.map((h) => h.similarity);
      const median = scores[Math.floor(scores.length / 2)] ?? 0;
      const top = scores[0] ?? 0;
      console.log(`    ${label}  top ${top.toFixed(3)}  lead ${(top - median).toFixed(3)}  ${query.slice(0, 44)}`);
    }
  }

  console.log('');
  console.log(
    wrong === 0
      ? `All ${OFF_SYLLABUS.length + ON_SYLLABUS.length} decisions correct.`
      : `${wrong} decision(s) went the wrong way.`,
  );
}

main()
  .catch((e) => {
    console.error('Check failed:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
