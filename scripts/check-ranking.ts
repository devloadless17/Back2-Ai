/**
 * Does the material handed to the tutor actually answer the question?
 *
 *   npm run check:ranking
 *
 * `check:refusal` asks whether the pipeline decides to speak. This asks whether
 * what it hands over is worth speaking from. They fail differently: a query can
 * clear every threshold and still be given six passages that mention the topic
 * without explaining it — six exercises saying "prove that (v_n) is geometric"
 * and never the paragraph defining one. The tutor then correctly reports that
 * its material does not define the term, which is honest and useless.
 *
 * Judged on `grounding.context`, the exact text the model receives, rather than
 * on the search results or the shortened source labels. An earlier version of
 * this script measured the labels and reported a third of the true figure.
 *
 * The bar is deliberately low: for "what is X", somewhere in the context there
 * should be X together with wording that explains rather than instructs.
 * Clearing it does not prove the answer is good; failing it proves it cannot be.
 */

import { PrismaClient } from '@prisma/client';

import { retrieveGrounding } from '../src/lib/retrieval';

const db = new PrismaClient();

const PROBES: { track: string; query: string; term: RegExp }[] = [
  { track: 'GS', query: 'What is the photoelectric effect?', term: /photoelectric|photo[ée]lectrique/i },
  { track: 'GS', query: 'What is radioactivity?', term: /radioactiv/i },
  { track: 'GS', query: 'What is an ester?', term: /ester/i },
  { track: 'GS', query: 'What is a conditional probability?', term: /conditional|conditionnelle/i },
  { track: 'GS', query: 'What is a mechanical oscillator?', term: /oscillat/i },
  { track: 'GS', query: "Qu'est-ce qu'un nombre complexe ?", term: /complexe/i },
  { track: 'GS', query: "Qu'est-ce que la cinétique chimique ?", term: /cin[ée]tique/i },
  { track: 'GS', query: "Qu'est-ce qu'une fonction logarithme ?", term: /logarithme/i },
  { track: 'LS', query: 'What is an enzyme?', term: /enzyme/i },
  { track: 'LS', query: 'What is a nerve impulse?', term: /nerve|nerveux|influx/i },
  { track: 'SE', query: "Qu'est-ce qu'une suite géométrique ?", term: /g[ée]om[ée]trique/i },
  { track: 'LH', query: "Qu'est-ce que la conscience en philosophie ?", term: /conscience|وعي/i },
];

/** Wording that explains something, in any of the corpus's three languages. */
const EXPLAINS = new RegExp(
  [
    'on appelle', 'est appelée?', 'est appelé', 'se définit', 'définition', 'on dit que',
    'est dite?\\b', 'on nomme', 'consiste à', 'correspond à',
    'is called', 'is defined', 'we call', 'definition', 'refers to', 'consists of',
    'يسمى', 'تعريف', 'يعرف', 'هي عملية',
    'théorème', 'theorem', 'propriété', 'property', 'نظرية', 'خاصية',
  ].join('|'),
  'i',
);

/** A window around the term, so "definition" three pages away does not count. */
const WINDOW = 400;

function explainsTheTerm(context: string, term: RegExp): boolean {
  const global = new RegExp(term.source, 'gi');
  let match: RegExpExecArray | null;
  while ((match = global.exec(context)) !== null) {
    const from = Math.max(0, match.index - WINDOW);
    if (EXPLAINS.test(context.slice(from, match.index + WINDOW))) return true;
  }
  return false;
}

async function main() {
  let onTopic = 0;
  let explained = 0;

  console.log('  probe                                          tier            chars   verdict');
  console.log('  ' + '-'.repeat(92));

  for (const probe of PROBES) {
    const track = await db.track.findUnique({ where: { code: probe.track }, select: { id: true } });
    if (!track) continue;
    const subjects = await db.subject.findMany({ where: { trackId: track.id }, select: { id: true } });

    const grounding = await retrieveGrounding({
      query: probe.query,
      subjectIds: subjects.map((s) => s.id),
      userId: '00000000-0000-0000-0000-000000000000',
    });

    const context = grounding.context;
    const mentions = probe.term.test(context);
    const explains = mentions && explainsTheTerm(context, probe.term);

    if (mentions) onTopic += 1;
    if (explains) explained += 1;

    const verdict = explains ? 'explains it' : mentions ? 'mentions only' : 'not in the material';
    console.log(
      `  ${probe.query.slice(0, 44).padEnd(46)}${grounding.tier.padEnd(16)}${String(context.length).padStart(6)}   ${verdict}`,
    );
  }

  console.log('');
  console.log(`  term appears in the material:  ${onTopic}/${PROBES.length}`);
  console.log(`  material explains the term:    ${explained}/${PROBES.length}`);
}

main()
  .catch((e) => {
    console.error('Check failed:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
