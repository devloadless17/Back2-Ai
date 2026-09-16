import { db } from '@/lib/db';
import { costMicros } from '@/lib/ai/budget';
import { retrieveGrounding } from '@/lib/retrieval';

/**
 * What happens when a seventeen-year-old types the way they actually type.
 *
 *   npm run try:casual              what tier each question reaches  (cheap)
 *   npm run try:casual -- --answer  also generate the answers        (not cheap)
 *
 * WHY THIS IS NOT THE PROBE SET. Every retrieval number this project has —
 * top-1 59%, coverage 95% — comes from `corpus/retrieval-probes.json`, whose
 * questions were GENERATED FROM the passage they are supposed to find. They are
 * well-formed, on-topic, use the textbook's own vocabulary, and are written in
 * the subject's own language. Real students are none of those things.
 *
 * The cases below are the ones that actually arrive:
 *
 *   arabizi        Lebanese students type Arabic in Latin letters. "shu ya3ne
 *                  el isti3ara" has no Arabic character in it at all, so every
 *                  script-based branch in retrieval.ts reads it as Latin.
 *   bare topic     "suites geometriques" — no question, just a noun.
 *   frustration    "je comprends rien aux derivees" — a feeling, not a query.
 *   pointing       "how do i do question 3" — refers to something we cannot see.
 *   wrong language a French-track student asking about French maths in English.
 *   off syllabus   must still be refused. Included so a run that grounds
 *                  everything is recognisable as broken rather than as good.
 *
 * The first pass costs almost nothing: retrieval runs, and the only model call
 * is the keyword expansion, and only when the first search found nothing. It
 * reports the TIER, which is what decides whether the student is answered at
 * all. Generating the answers is a separate flag because that is where the
 * money is.
 */

const ANSWER = process.argv.includes('--answer');

type Case = { label: string; subject: string; query: string };

const SUBJECTS = {
  mathsFr: '8186aa68-e642-4178-b731-2e1a8cfcffe6', // GS Mathematiques
  chimieFr: '4821bec8-a11a-4a05-9c54-a3b7ae819ec9', // GS Chimie
  adabAr: '9665e311-4101-47e0-b507-568a9f377306', // LH أدب عربي
  philoAr: '02a3a7ed-6fb3-40f6-ac18-855a438b4e51', // LH فلسفة عامة
  englishEn: '4d4e1ccc-223b-4044-9c31-8e628a6a6681', // LS English
};

const CASES: Case[] = [
  { label: 'arabizi', subject: SUBJECTS.adabAr, query: 'shu ya3ne el isti3ara w kif bfar2a 3an el tashbih' },
  { label: 'arabizi', subject: SUBJECTS.philoAr, query: 'shu el far2 ben el 3a2l w el 7ads' },
  { label: 'arabic, casual', subject: SUBJECTS.adabAr, query: 'ما بفهم شو الفرق بين الاستعارة والكناية' },
  { label: 'bare topic', subject: SUBJECTS.mathsFr, query: 'suites geometriques' },
  { label: 'frustration', subject: SUBJECTS.mathsFr, query: 'je comprends rien aux derivees aide moi stp' },
  { label: 'txt-speak', subject: SUBJECTS.chimieFr, query: 'cest quoi une reaction doxydoreduction jai pas compris' },
  { label: 'pointing', subject: SUBJECTS.mathsFr, query: 'comment on fait la question 3' },
  { label: 'wrong language', subject: SUBJECTS.mathsFr, query: 'how do i find the limit of a sequence' },
  { label: 'one word', subject: SUBJECTS.englishEn, query: 'obesity' },
  { label: 'casual english', subject: SUBJECTS.englishEn, query: 'whats the main idea i have to write about' },
  { label: 'OFF-SYLLABUS', subject: SUBJECTS.mathsFr, query: 'cest quoi la meilleure serie sur netflix' },
  { label: 'OFF-SYLLABUS', subject: SUBJECTS.adabAr, query: 'كيف اطبخ التبولة' },
];

async function spentSince(mark: Date): Promise<number> {
  const rows = await db.aiUsage.findMany({
    where: { createdAt: { gt: mark } },
    select: { model: true, inputTokens: true, cachedInputTokens: true, outputTokens: true },
  });
  return (
    Number(
      rows.reduce(
        (s, r) =>
          s +
          costMicros({
            model: r.model,
            inputTokens: r.inputTokens,
            cachedInputTokens: r.cachedInputTokens,
            outputTokens: r.outputTokens,
          }),
        0n,
      ),
    ) / 1_000_000
  );
}

async function main() {
  const started = new Date();
  console.log('');
  console.log('  ' + 'case'.padEnd(17) + 'question'.padEnd(52) + 'tier'.padEnd(21) + 'kind');
  console.log('  ' + '─'.repeat(104));

  for (const c of CASES) {
    const g = await retrieveGrounding({
      query: c.query,
      subjectIds: [c.subject],
      userId: '00000000-0000-0000-0000-000000000000',
    });

    const refused = g.context.trim().length === 0;
    const tier = refused ? 'REFUSED' : g.tier;
    const sim = g.topSimilarity === null ? '' : ` ${g.topSimilarity.toFixed(2)}`;

    console.log(
      '  ' +
        c.label.padEnd(17) +
        (c.query.length > 50 ? c.query.slice(0, 49) + '…' : c.query).padEnd(52) +
        (tier + sim).padEnd(21) +
        `${g.classification.kind}/${g.classification.confidence}`,
    );

    if (ANSWER && !refused) {
      const { ai } = await import('@/lib/ai');
      const { systemPrompt } = await import('@/lib/chat');
      const locale = c.subject === SUBJECTS.adabAr || c.subject === SUBJECTS.philoAr ? 'ar' : 'fr';
      const answer = await ai().complete({
        system: systemPrompt(g.tier, g.classification, locale),
        messages: [
          {
            role: 'user',
            content: `# Course material you may use\n${g.context}\n\n# Student question\n${c.query}`,
          },
        ],
        effort: 'high',
      });
      console.log('\n' + answer.text.split('\n').map((l) => `      │ ${l}`).join('\n') + '\n');
    }
  }

  await new Promise((r) => setTimeout(r, 1500));
  console.log(`\n  spent $${(await spentSince(started)).toFixed(4)}\n`);
  await db.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
