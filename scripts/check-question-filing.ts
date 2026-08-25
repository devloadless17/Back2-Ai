/**
 * Is a question filed under a chapter that holds its material?
 *
 *   npm run check:filing
 *   npm run check:filing -- --subject Mathematics --track GS --sample 200
 *
 * A past-exam question is filed by the loader to the chapter of the nearest
 * course passage. That is a snapshot: chapter spans move when a TOC override or
 * a locator fix lands, the passages move with them, and the question keeps
 * pointing where it was put.
 *
 * MOST QUESTIONS DO NOT HAVE ONE CHAPTER, and the first version of this report
 * did not know that. A question row here is a whole exam EXERCISE, not a
 * sub-question — 2.1 sub-questions on average, 1,058 of them with three or
 * more, one with twenty-five — and a Lebanese exercise is deliberately built
 * across topics: "Part A: solve the differential equation. Part B: study the
 * function, its asymptotes and the area under its curve." That is three
 * chapters in one row, and no single answer to "which chapter?" is right.
 *
 * Measured on science questions, the top three chapters sit within 0.03 of each
 * other for 18% of them and the top two for a further 28%. So 46% have no
 * single owner. Reporting those as suspect — which this did — invents a
 * two-thousand-question problem and pushes whoever reads it into re-filing that
 * cannot help, because every destination is as wrong as the one before.
 *
 * Three outcomes now, and only the last is a defect:
 *
 *   settled      one chapter clearly wins and the question is filed there
 *   multi-topic  the top chapters are within MARGIN of each other; the question
 *                spans them, and where it sits is a presentational choice
 *   MIS-FILED    one chapter clearly wins, and it is not the one on the row
 *
 * Even then: this is the embedding judging a decision the embedding made, so
 * agreement proves nothing. Only the last line is output.
 */

import { embed } from '@/lib/ai/embeddings';
import { db } from '@/lib/db';

const argv = process.argv.slice(2);
const arg = (name: string) => {
  const i = argv.indexOf(name);
  return i === -1 ? null : argv[i + 1] ?? null;
};
const SAMPLE = Number(arg('--sample')) || 300;
const SUBJECT = arg('--subject');
const TRACK = arg('--track');

/** Chapters within this of the top one are not distinguishable from it. */
const MARGIN = 0.03;
/** Below this the winner is the least bad of a bad set, not a match. */
const WEAK = 0.65;
const TOP_N = 6;

async function main() {
  const questions = await db.$queryRaw<
    { id: string; content_text: string; subject_id: string; chapter_id: string; chapter: string; subject: string }[]
  >`
    SELECT q.id, q.content_text, s.id AS subject_id, c.id AS chapter_id,
           c.name AS chapter, s.name AS subject
      FROM questions q
      JOIN chapters c ON c.id = q.chapter_id
      JOIN subjects s ON s.id = c.subject_id
      LEFT JOIN tracks t ON t.id = s.track_id
     WHERE q.verified_status = 'unverified'
       AND length(q.content_text) > 60
       AND (${SUBJECT}::text IS NULL OR s.name = ${SUBJECT})
       AND (${TRACK}::text IS NULL OR t.code = ${TRACK})
     ORDER BY random()
     LIMIT ${SAMPLE}
  `;

  let settled = 0;
  let multi = 0;
  let misfiled = 0;
  let unknown = 0;
  const examples: string[] = [];

  for (const q of questions) {
    const vector = `[${(await embed(q.content_text.slice(0, 1500), 'query')).join(',')}]`;
    const ranked = await db.$queryRaw<{ chapter_id: string; name: string; similarity: number }[]>`
      SELECT ch.id AS chapter_id, ch.name,
             max(1 - (cc.embedding <=> ${vector}::vector)) AS similarity
        FROM content_chunks cc
        JOIN chapter_content_chunks link ON link.chunk_id = cc.id
        JOIN chapters ch ON ch.id = link.chapter_id
       WHERE ch.subject_id = ${q.subject_id}::uuid AND cc.embedding IS NOT NULL
       GROUP BY ch.id, ch.name
       ORDER BY similarity DESC
       LIMIT ${TOP_N}
    `;
    if (ranked.length < 2) continue;
    const best = Number(ranked[0]!.similarity);
    const second = Number(ranked[1]!.similarity);

    if (best < WEAK) {
      unknown += 1;
    } else if (best - second <= MARGIN) {
      // No clear owner. Where it sits is a choice, not a mistake.
      multi += 1;
    } else if (ranked[0]!.chapter_id === q.chapter_id) {
      settled += 1;
    } else {
      misfiled += 1;
      if (examples.length < 10) {
        examples.push(
          `    ${q.subject.slice(0, 16).padEnd(16)} "${q.chapter.slice(0, 28)}" ` +
            `-> "${ranked[0]!.name.slice(0, 28)}" (${best.toFixed(3)} vs ${second.toFixed(3)})`,
        );
      }
    }
  }

  const n = settled + multi + misfiled + unknown;
  const pct = (x: number) => `${((100 * x) / Math.max(1, n)).toFixed(1)}%`;
  console.log(`\n${n} question(s) checked${SUBJECT ? ` — ${SUBJECT}${TRACK ? ` (${TRACK})` : ''}` : ''}\n`);
  console.log(`  settled     filed under the clear winner      ${String(settled).padStart(5)}  ${pct(settled)}`);
  console.log(`  multi-topic no clear winner (within ${MARGIN})     ${String(multi).padStart(5)}  ${pct(multi)}   not a defect`);
  console.log(`  unknown     nothing scores above ${WEAK}         ${String(unknown).padStart(5)}  ${pct(unknown)}`);
  console.log(`  MIS-FILED   a clear winner, and it is not it  ${String(misfiled).padStart(5)}  ${pct(misfiled)}   <- the defect`);
  if (examples.length) {
    console.log('\n  mis-filed examples:');
    examples.forEach((e) => console.log(e));
  }
  console.log(
    `\n  A question row is a whole exam exercise, so "multi-topic" is the normal\n` +
      `  case, not a backlog. Only the MIS-FILED line is worth acting on, and even\n` +
      `  that is the embedding judging its own earlier decision.`,
  );
  await db.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
