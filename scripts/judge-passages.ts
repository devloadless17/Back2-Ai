/**
 * Does the passage retrieval hands over actually help answer the question?
 *
 *   npm run judge:passages -- --count 40
 *   npm run judge:passages -- --subject Chemistry --track GS --count 30
 *   npm run judge:passages -- --report
 *
 * THE ONLY NON-CIRCULAR MEASUREMENT THIS REPOSITORY CAN CHEAPLY GET.
 *
 * Every retrieval number here is currently the embedding grading itself. The
 * loader filed each question to the chapter of its nearest passage; the
 * benchmark then asks whether retrieval finds that chapter, using the same
 * embedding. It agrees with itself, scores well, and means nothing.
 *
 * `label:chapters` breaks that circle but asks an expensive question — "which
 * of these twenty-eight chapters is right?" — and for many questions there is
 * no right answer, because a question row is a whole exam exercise and a
 * Lebanese exercise spans topics on purpose. Two sessions produced zero labels.
 *
 * This asks the cheap question instead, and the one the product actually
 * claims: here is a question, here is the passage retrieval put first, does it
 * help? Yes or no. Ten seconds, no expertise about the chapter list, no answer
 * that is unavailable.
 *
 * It is not circular. The embedding proposes and a person disposes: nothing
 * about the judgement comes from the model being judged. What it yields is
 * precision@1 over real questions, which is the number every other decision
 * here should be argued against — whether to change the embedding model,
 * whether reranking pays outside Arabic, whether a threshold is right.
 *
 * Deliberately NOT stored on the question. A judgement here is about the
 * retrieval, not about the question or its chapter, and writing it to
 * `verified_status` would corrupt the chapter ground truth that
 * `label:chapters` exists to build. It goes to its own table.
 */

import { createInterface } from 'node:readline/promises';

import { embed } from '@/lib/ai/embeddings';
import { db } from '@/lib/db';

const argv = process.argv.slice(2);
const arg = (name: string) => {
  const i = argv.indexOf(name);
  return i === -1 ? null : argv[i + 1] ?? null;
};
const REPORT = argv.includes('--report');
const COUNT = Number(arg('--count')) || 40;
const SUBJECT = arg('--subject');
const TRACK = arg('--track');

async function ensureTable() {
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS passage_judgements (
      question_id uuid NOT NULL,
      chunk_id    uuid NOT NULL,
      helpful     boolean NOT NULL,
      similarity  double precision,
      judged_at   timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (question_id, chunk_id)
    )`);
}

async function report() {
  const rows = await db.$queryRaw<
    { subject: string; judged: bigint; helpful: bigint; avg_sim: number | null }[]
  >`
    SELECT s.name AS subject, count(*) AS judged,
           count(*) FILTER (WHERE j.helpful) AS helpful,
           avg(j.similarity) AS avg_sim
      FROM passage_judgements j
      JOIN questions q ON q.id = j.question_id
      JOIN chapters c ON c.id = q.chapter_id
      JOIN subjects s ON s.id = c.subject_id
     GROUP BY s.name ORDER BY judged DESC
  `;
  if (!rows.length) {
    console.log('\nNothing judged yet. Run without --report to start.\n');
    return;
  }
  console.log('\nPRECISION@1 — is the first passage handed over actually useful?\n');
  let j = 0;
  let h = 0;
  for (const r of rows) {
    const judged = Number(r.judged);
    const helpful = Number(r.helpful);
    j += judged;
    h += helpful;
    console.log(
      `  ${r.subject.slice(0, 22).padEnd(24)}${String(helpful).padStart(4)} / ${String(judged).padEnd(4)}` +
        `  ${((100 * helpful) / judged).toFixed(0)}%   mean similarity ${(r.avg_sim ?? 0).toFixed(3)}`,
    );
  }
  console.log(`\n  overall ${h} / ${j} = ${((100 * h) / j).toFixed(1)}% precision@1`);
  console.log(
    j < 50
      ? '\n  Under about fifty this is an anecdote, not a measurement.\n'
      : '\n  This is the one retrieval number here that is not self-graded.\n',
  );
}

async function main() {
  await ensureTable();
  if (REPORT) {
    await report();
    await db.$disconnect();
    return;
  }

  const questions = await db.$queryRaw<
    { id: string; content_text: string; subject_id: string; subject: string }[]
  >`
    SELECT q.id, q.content_text, s.id AS subject_id, s.name AS subject
      FROM questions q
      JOIN chapters c ON c.id = q.chapter_id
      JOIN subjects s ON s.id = c.subject_id
      LEFT JOIN tracks t ON t.id = s.track_id
     WHERE q.verified_status <> 'rejected'
       AND length(q.content_text) > 80
       AND (${SUBJECT}::text IS NULL OR s.name = ${SUBJECT})
       AND (${TRACK}::text IS NULL OR t.code = ${TRACK})
       AND NOT EXISTS (SELECT 1 FROM passage_judgements j WHERE j.question_id = q.id)
     ORDER BY random()
     LIMIT ${COUNT}
  `;

  if (!questions.length) {
    console.log('Nothing left to judge with those filters.');
    await db.$disconnect();
    return;
  }

  console.log(`\n${questions.length} question(s) to judge.`);
  console.log('For each: "y" if the passage helps answer the question, "n" if it');
  console.log('does not, "s" to skip, "q" to stop.\n');

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let judged = 0;
  let helpful = 0;

  for (const [i, q] of questions.entries()) {
    const vector = `[${(await embed(q.content_text.slice(0, 1500), 'query')).join(',')}]`;
    const top = await db.$queryRaw<{ id: string; content_text: string; similarity: number }[]>`
      SELECT cc.id, cc.content_text, 1 - (cc.embedding <=> ${vector}::vector) AS similarity
        FROM content_chunks cc
        JOIN chapter_content_chunks link ON link.chunk_id = cc.id
        JOIN chapters ch ON ch.id = link.chapter_id
       WHERE ch.subject_id = ${q.subject_id}::uuid AND cc.embedding IS NOT NULL
       ORDER BY cc.embedding <=> ${vector}::vector
       LIMIT 1
    `;
    if (!top[0]) continue;

    console.log('\n' + '─'.repeat(72));
    console.log(`(${i + 1}/${questions.length})  ${q.subject}\n`);
    console.log(`QUESTION:\n  ${q.content_text.replace(/\s+/g, ' ').slice(0, 420)}\n`);
    console.log(`PASSAGE RETRIEVED (${Number(top[0].similarity).toFixed(3)}):`);
    console.log(`  ${top[0].content_text.replace(/\s+/g, ' ').slice(0, 420)}`);

    /*
     * A closed stdin is an answer too: stop, and keep what was already judged.
     * Without this a piped or non-interactive run dies on ERR_USE_AFTER_CLOSE
     * and takes the session's judgements down with it — which is exactly the
     * failure that made two `label:chapters` sessions record nothing.
     */
    let answer: string;
    try {
      answer = (await rl.question('\n  helpful? (y/n/s/q) ')).trim().toLowerCase();
    } catch {
      console.log('\n  input closed.');
      break;
    }
    if (answer === 'q') break;
    if (answer !== 'y' && answer !== 'n') continue;

    await db.$executeRaw`
      INSERT INTO passage_judgements (question_id, chunk_id, helpful, similarity)
      VALUES (${q.id}::uuid, ${top[0].id}::uuid, ${answer === 'y'}, ${Number(top[0].similarity)})
      ON CONFLICT (question_id, chunk_id) DO UPDATE SET helpful = EXCLUDED.helpful
    `;
    judged += 1;
    if (answer === 'y') helpful += 1;
  }

  rl.close();
  console.log(`\n${judged} judged, ${helpful} helpful.`);
  if (judged) await report();
  await db.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
