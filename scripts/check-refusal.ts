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
 *
 * Grouped by track and by the language the student would type in, because a
 * threshold is only as good as the scripts it was measured against. Every probe
 * here was once Latin, and every one ran against GS — a track whose books are
 * English and French. The single number that came out of that refused "ما هي
 * البطالة؟" at 0.431, with all five of its top hits in the correct chapter of
 * the economics book. The question was never the ranking; it was that Arabic
 * cosines sit lower than Latin ones and nothing had ever measured where.
 */

import { PrismaClient } from '@prisma/client';

import { retrieveGrounding, CONCEPT_LEVEL_THRESHOLD, EXACT_MATCH_THRESHOLD, RELEVANCE_LEAD } from '../src/lib/retrieval';

const db = new PrismaClient();

type Group = {
  track: string;
  script: 'latin' | 'arabic';
  off: string[];
  on: string[];
};

/*
 * The on-syllabus probes name chapters this corpus provably holds — checked
 * against `chapters` before being written here. A probe for something the books
 * do not teach measures the syllabus, not the retriever, and reads as a defect.
 */
const GROUPS: Group[] = [
  {
    track: 'GS',
    script: 'latin',
    off: [
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
    ],
    on: [
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
    ],
  },
  {
    // Economics and sociology, taught in Arabic and examined in Arabic.
    track: 'SE',
    script: 'arabic',
    off: [
      'كيف أخبز الخبز في المنزل؟',
      'ما هو أفضل مطعم في بيروت؟',
      'من فاز بكأس العالم عام ٢٠١٨؟',
      'كيف أصلح حنفية تنقط؟',
      'كم يكلف الآيفون في لبنان؟',
      'كيف أجدد جواز سفري؟',
      'ما هي أفضل طريقة لتعلم العزف على الجيتار؟',
      'أعطني وصفة التبولة.',
      'ماذا ألبس في حفل زفاف في تموز؟',
      'ما هو أفضل مسلسل على نتفليكس؟',
    ],
    on: [
      'ما هي البطالة؟',
      'ما هو الإنتاج؟',
      'ما هو الاستثمار؟',
      'ما هو التضخم المالي؟',
      'ما هي الكلفة الثابتة والكلفة المتغيرة؟',
      'ما هو الدخل القومي؟',
      'ما هي السياسة الزراعية؟',
      'ما هي الجدوى الاقتصادية؟',
      'ما هي دالة الاستهلاك؟',
      'ما هي السياسة الصناعية؟',
    ],
  },
  {
    // Philosophy and Arabic literature, both Arabic-medium.
    track: 'LH',
    script: 'arabic',
    off: [
      'كيف أغير إطار السيارة؟',
      'ما هي أسعار الشقق في بيروت؟',
      'اكتب لي سيرة ذاتية لوظيفة نادل.',
      'ما هو أفضل هاتف يمكنني شراؤه؟',
      'كيف أطبخ الملوخية؟',
      'من هو أفضل لاعب كرة قدم في العالم؟',
    ],
    on: [
      'ما هو الوعي واللاوعي؟',
      'ما هي الحقيقة في الفلسفة؟',
      'ما هو الخير والقيم؟',
      'ما هو التمييز في النحو؟',
      'ما هي علاقات العمل؟',
    ],
  },
];

/** Tier 3 searches the student's own uploads; a user with none isolates the corpus. */
const PROBE_USER = '00000000-0000-0000-0000-000000000000';

function span(scores: number[]): string {
  if (scores.length === 0) return '—';
  const sorted = [...scores].sort((a, b) => a - b);
  return `${sorted[0]!.toFixed(3)} … ${sorted[sorted.length - 1]!.toFixed(3)}`;
}

async function main() {
  console.log(`thresholds: exact ${EXACT_MATCH_THRESHOLD}, concept ${CONCEPT_LEVEL_THRESHOLD}, lead ${RELEVANCE_LEAD}`);

  let wrong = 0;
  const summary: string[] = [];

  for (const group of GROUPS) {
    const track = await db.track.findFirst({ where: { code: group.track }, select: { id: true } });
    if (!track) {
      console.error(`No ${group.track} track — seed the taxonomy first.`);
      process.exitCode = 1;
      return;
    }
    const subjects = await db.subject.findMany({
      where: { trackId: track.id },
      select: { id: true, name: true },
    });
    const subjectIds = subjects.map((s) => s.id);

    console.log('');
    console.log(`${group.track} student, ${group.script} questions, ${subjects.length} subjects`);

    const offScores: number[] = [];
    const onScores: number[] = [];

    /*
     * Scored on `topSimilarity` — the number the pipeline itself gated on —
     * rather than on a plain vector search run alongside it. They differ: the
     * pipeline also searches the question bank and re-asks Arabic queries in the
     * other script, so its best hit can beat anything a single scoped vector
     * search returns. An earlier version of this reported the vector number and
     * the decision side by side, which made "answered at 0.434" look like a
     * threshold of 0.45 had been ignored.
     */
    for (const query of group.off) {
      const result = await retrieveGrounding({ query, subjectIds, userId: PROBE_USER });
      const refused = result.tier === 'ungrounded_refused';
      if (!refused) wrong += 1;
      offScores.push(result.topSimilarity ?? 0);
      if (!refused) {
        console.log(`    ANSWERED  ${(result.topSimilarity ?? 0).toFixed(3)}  ${result.tier}  ${query.slice(0, 40)}`);
      }
    }

    for (const query of group.on) {
      const result = await retrieveGrounding({ query, subjectIds, userId: PROBE_USER });
      const answered = result.tier !== 'ungrounded_refused';
      if (!answered) wrong += 1;
      onScores.push(result.topSimilarity ?? 0);
      if (!answered) {
        console.log(`    REFUSED   ${(result.topSimilarity ?? 0).toFixed(3)}  ${query.slice(0, 40)}`);
      }
    }

    /*
     * The gap between the two populations is the only number worth tuning on.
     * A threshold inside it separates them; a threshold outside it cannot, and
     * no amount of moving it by thousandths will help.
     */
    const worstOn = Math.min(...onScores);
    const bestOff = Math.max(...offScores);
    const gap = worstOn - bestOff;
    console.log(`    off-syllabus  ${span(offScores)}`);
    console.log(`    on-syllabus   ${span(onScores)}`);
    console.log(
      gap > 0
        ? `    separable: any threshold in (${bestOff.toFixed(3)}, ${worstOn.toFixed(3)}) — gap ${gap.toFixed(3)}`
        : `    NOT separable: they overlap by ${(-gap).toFixed(3)}`,
    );
    summary.push(
      `  ${group.track} ${group.script.padEnd(7)} off ${span(offScores)}   on ${span(onScores)}   ` +
        (gap > 0 ? `midpoint ${((bestOff + worstOn) / 2).toFixed(3)}` : `overlap ${(-gap).toFixed(3)}`),
    );
  }

  const total = GROUPS.reduce((n, g) => n + g.off.length + g.on.length, 0);
  console.log('');
  console.log('  where each population sits:');
  for (const line of summary) console.log(line);
  console.log('');
  console.log(wrong === 0 ? `All ${total} decisions correct.` : `${wrong} of ${total} decisions went the wrong way.`);
}

main()
  .catch((e) => {
    console.error('Check failed:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
