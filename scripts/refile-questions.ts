/**
 * Re-files questions whose stored chapter no longer holds their material.
 *
 *   npm run refile:questions                          what it would move
 *   npm run refile:questions -- --subject Mathematics --track GS
 *   npm run refile:questions -- --apply
 *
 * A past-exam question is filed by the loader to the chapter of the nearest
 * course passage, and that is a snapshot of one moment. Chapter spans move —
 * a TOC override, a locator fix — and the passages move with them while the
 * question keeps pointing where it was put. `npm run check:filing` measured the
 * result on GS mathematics: 40% of questions are filed under a chapter that is
 * not in the top six for their own text.
 *
 * This runs the loader's own decision again, against the corpus as it now
 * stands. It is not a better mechanism than the one that filed them; it is the
 * same mechanism against corrected chapters.
 *
 * THREE THINGS IT WILL NOT DO.
 *
 * It will not touch a question a human has judged. Those 38 rows are the only
 * non-circular ground truth in the project and re-deciding them by embedding
 * would destroy the measurement while looking like progress.
 *
 * It will not move a question on a weak match. If the stored chapter is absent
 * from the top six AND the best new candidate is under `FLOOR`, then nothing
 * here knows where the question belongs, and swapping one guess for another
 * buys nothing while making the mistake look freshly considered. Those are
 * counted and left alone.
 *
 * It will not move a question whose stored chapter is merely ranked low. Being
 * second is not being wrong. Only absence from the top six — the signal that
 * matched the human labelling — qualifies.
 *
 * Every move is written to a receipt with the question id and the chapter it
 * came off, because a chapter_id update overwrites the only record of where a
 * question used to be.
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { embed } from '@/lib/ai/embeddings';
import { db } from '@/lib/db';

const argv = process.argv.slice(2);
const arg = (name: string) => {
  const i = argv.indexOf(name);
  return i === -1 ? null : argv[i + 1] ?? null;
};
const APPLY = argv.includes('--apply');
const SUBJECT = arg('--subject');
const TRACK = arg('--track');
const LIMIT = Number(arg('--limit')) || 0;

const TOP_N = 6;
/** Below this, the best candidate is the least bad of a bad set, not a match. */
const FLOOR = 0.65;
/** Chapters within this of the winner are not distinguishable from it. */
const MARGIN = 0.03;
const RECEIPT = path.join(process.cwd(), 'corpus', 'refiled-questions-by-embedding.json');

type Move = {
  questionId: string;
  subject: string;
  from: string;
  fromChapterId: string;
  to: string;
  toChapterId: string;
  similarity: number;
  statement: string;
};

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
     ORDER BY s.name, q.id
  `;

  const pool = LIMIT ? questions.slice(0, LIMIT) : questions;
  const moves: Move[] = [];
  let kept = 0;
  let tooWeak = 0;
  let noChapters = 0;
  /** Questions that span chapters, where no single destination is right. */
  let multiTopic = 0;

  for (const q of pool) {
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
    if (!ranked.length) {
      noChapters += 1;
      continue;
    }
    if (ranked.some((r) => r.chapter_id === q.chapter_id)) {
      kept += 1;
      continue;
    }
    const best = ranked[0]!;
    if (Number(best.similarity) < FLOOR) {
      tooWeak += 1;
      continue;
    }
    /*
     * A question with no single owner is not moved.
     *
     * A question row is a whole exam exercise, and a Lebanese exercise is built
     * across topics on purpose — "Part A: solve the differential equation.
     * Part B: study the function and the area under its curve" is three
     * chapters in one row. On science questions the top two chapters sit within
     * MARGIN of each other 28% of the time and the top three 18%.
     *
     * For those, every destination is as defensible as the one it came from,
     * so moving buys nothing and costs the churn — plus it makes a considered
     * decision out of a coin toss, which is worse than leaving the coin where
     * it landed. The single-chapter model cannot express these; until it can,
     * they stay put.
     */
    if (Number(best.similarity) - Number(ranked[1]?.similarity ?? 0) <= MARGIN) {
      multiTopic += 1;
      continue;
    }
    moves.push({
      questionId: q.id,
      subject: q.subject,
      from: q.chapter,
      fromChapterId: q.chapter_id,
      to: best.name,
      toChapterId: best.chapter_id,
      similarity: Number(best.similarity),
      statement: q.content_text.replace(/\s+/g, ' ').slice(0, 110),
    });
  }

  console.log(`\n${pool.length} unverified question(s) examined\n`);
  console.log(`  stored chapter still in the top ${TOP_N}      ${String(kept).padStart(5)}   left alone`);
  console.log(`  absent, and no confident alternative     ${String(tooWeak).padStart(5)}   left alone (best < ${FLOOR})`);
  console.log(`  absent, but the question spans chapters  ${String(multiTopic).padStart(5)}   left alone (no single owner)`);
  console.log(`  absent, with one clear alternative       ${String(moves.length).padStart(5)}   ${APPLY ? 'MOVED' : 'would move'}`);
  if (noChapters) console.log(`  subject has no passages at all           ${String(noChapters).padStart(5)}   left alone`);

  const sample = moves.slice(0, 15);
  if (sample.length) {
    console.log('\n  a sample, to be read rather than trusted:');
    for (const m of sample) {
      console.log(`\n    ${m.statement}`);
      console.log(`      "${m.from}"  ->  "${m.to}"  (${m.similarity.toFixed(3)})`);
    }
  }

  if (APPLY && moves.length) {
    /*
     * Appended, never overwritten. Each run covers a different slice — one
     * subject, then another — and a receipt that replaced the last one would
     * leave the earlier moves with no record of where those questions came
     * from, which is the only thing making this reversible at all.
     */
    let prior: Move[] = [];
    try {
      prior = JSON.parse(await readFile(RECEIPT, 'utf8')) as Move[];
    } catch {
      // No receipt yet.
    }
    const known = new Set(prior.map((m) => m.questionId));
    await writeFile(
      RECEIPT,
      JSON.stringify([...prior, ...moves.filter((m) => !known.has(m.questionId))], null, 2),
      'utf8',
    );
    for (const m of moves) {
      await db.$executeRaw`
        UPDATE questions SET chapter_id = ${m.toChapterId}::uuid WHERE id = ${m.questionId}::uuid
      `;
    }
    console.log(`\n  receipt: ${RECEIPT}`);
  } else if (moves.length) {
    console.log('\nNothing changed. Re-run with --apply.');
  }
  await db.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
