/**
 * Past-exam questions filed under a cycle they are not written in.
 *
 *   npm run prune:misfiled            report only, writes nothing
 *   npm run prune:misfiled -- --apply hide the rows it found
 *
 * ---------------------------------------------------------------------------
 * It compares against the CYCLE's language, not the subject's. That distinction
 * is the whole correctness of this script, and getting it wrong did real damage
 * once already.
 *
 * The humanities are taught in Arabic and have a single subject — there is one
 * `فلسفة عامة`, and `subjectLanguagesFor('fr')` returns `['fr','ar']` precisely
 * so a French-track student is shown it. The CRDP still prints those papers in
 * three languages, which is why `exam_cycles.language` exists.
 *
 * So a French philosophy question sitting in a French cycle under the Arabic
 * subject is filed correctly. An earlier version of this script compared
 * against the subject and called all 270 of them misfiled, hiding papers that
 * `refile-exam-languages.ts` had just put right minutes before.
 * ---------------------------------------------------------------------------
 *
 * It hides rather than deletes. `Attempt.question` cascades on delete, so
 * removing these rows would take every mark any student earned on them — the
 * one thing here that cannot be regenerated from the corpus. Setting
 * `verified_status = 'rejected'` is the switch the product already reads:
 * `old-cycles`, `practice`, the quiz builder, `next-up` and `lib/exam` all
 * filter `verifiedStatus: { not: 'rejected' }`.
 *
 * The test is one-sided on purpose. A French paper may quote Arabic and an
 * Arabic paper may carry a French term, so "the scripts differ" is not evidence
 * on its own. A row is only reported when the disagreement is wholesale, and
 * the report says how many ambiguous rows were left alone.
 */
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

/** Arabic block, plus the supplement and extended ranges the OCR emits. */
const ARABIC = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/g;
const LETTER = /[\p{Letter}]/gu;

/** Share of a question's letters that are Arabic, 0–1. */
function arabicShare(text: string): number {
  const letters = text.match(LETTER)?.length ?? 0;
  if (letters === 0) return 0;
  return (text.match(ARABIC)?.length ?? 0) / letters;
}

/**
 * Wholesale disagreement only.
 *
 * `0.02` and `0.60`, not `0` and `0.5`: a stray Arabic glyph from a scanned
 * header should not condemn a French paper, and a genuinely Arabic paper is
 * never 45% Arabic — it is 90%+. The band between the two is where quotation
 * lives, and nothing in it is touched.
 */
const NO_ARABIC_AT_ALL = 0.02;
const MOSTLY_ARABIC = 0.6;

type Verdict = 'ok' | 'misfiled' | 'ambiguous';

/**
 * Compared against the language of the paper this question is printed in.
 *
 * `cycleLanguage`, never the subject's — see the note at the top of this file.
 */
function verdictFor(cycleLanguage: string, text: string): Verdict {
  const share = arabicShare(text);

  if (cycleLanguage === 'ar') {
    if (share < NO_ARABIC_AT_ALL) return 'misfiled';
    return share < MOSTLY_ARABIC ? 'ambiguous' : 'ok';
  }

  // A French or English edition.
  if (share > MOSTLY_ARABIC) return 'misfiled';
  return share > NO_ARABIC_AT_ALL ? 'ambiguous' : 'ok';
}

async function main() {
  const apply = process.argv.includes('--apply');

  const questions = await db.question.findMany({
    where: { sourceType: 'past_exam', sourceExamId: { not: null }, verifiedStatus: { not: 'rejected' } },
    select: {
      id: true,
      contentText: true,
      sourceExam: {
        select: { id: true, title: true, language: true, subject: { select: { name: true } } },
      },
    },
  });

  const byCycle = new Map<
    string,
    { title: string; language: string; subject: string; ok: number; ambiguous: number; misfiled: string[] }
  >();

  for (const q of questions) {
    const cycle = q.sourceExam;
    if (!cycle) continue;

    const entry =
      byCycle.get(cycle.id) ??
      {
        title: cycle.title,
        language: cycle.language,
        subject: cycle.subject.name,
        ok: 0,
        ambiguous: 0,
        misfiled: [] as string[],
      };

    const verdict = verdictFor(cycle.language, q.contentText);
    if (verdict === 'misfiled') entry.misfiled.push(q.id);
    else if (verdict === 'ambiguous') entry.ambiguous += 1;
    else entry.ok += 1;

    byCycle.set(cycle.id, entry);
  }

  const affected = [...byCycle.values()].filter((c) => c.misfiled.length > 0);
  affected.sort((a, b) => b.misfiled.length - a.misfiled.length);

  const totalMisfiled = affected.reduce((n, c) => n + c.misfiled.length, 0);
  const totalAmbiguous = [...byCycle.values()].reduce((n, c) => n + c.ambiguous, 0);

  console.log('');
  console.log(`  past-exam questions examined   ${questions.length}`);
  console.log(`  exam cycles                    ${byCycle.size}`);
  console.log(`  cycles holding misfiled rows   ${affected.length}`);
  console.log(`  rows to hide                   ${totalMisfiled}`);
  console.log(`  left alone as ambiguous        ${totalAmbiguous}   (scripts mixed, not wholesale)`);
  console.log('');

  console.log('  worst cycles:');
  for (const cycle of affected.slice(0, 12)) {
    console.log(
      `    ${String(cycle.misfiled.length).padStart(3)} to hide, ${String(cycle.ok).padStart(3)} kept` +
        `   [cycle is .${cycle.language}]  ${cycle.title}`,
    );
  }
  if (affected.length > 12) console.log(`    … and ${affected.length - 12} more cycles`);
  console.log('');

  if (!apply) {
    console.log('  DRY RUN — nothing was written. Re-run with --apply to hide these rows.');
    console.log('  Nothing is ever deleted: --apply sets verified_status = rejected, which every');
    console.log('  student-facing query already filters out, and which can be set back.');
    console.log('');
    await db.$disconnect();
    return;
  }

  const ids = affected.flatMap((c) => c.misfiled);
  const result = await db.question.updateMany({
    where: { id: { in: ids } },
    data: { verifiedStatus: 'rejected' },
  });

  console.log(`  hidden: ${result.count} rows now carry verified_status = rejected.`);
  console.log('  Student surfaces drop them on the next page load. Nothing was deleted.');
  console.log('');
  await db.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
