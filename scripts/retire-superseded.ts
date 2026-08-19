/**
 * Retires past-exam questions that a better copy has replaced.
 *
 *   npm run retire:superseded            what it would do
 *   npm run retire:superseded -- --apply
 *
 * Until `source_ref` existed, the loader identified an exercise by its own
 * text, so every improvement to the parser inserted a corrected copy beside the
 * copy it was meant to replace. 958 past-exam rows carry no ref and are the
 * residue of that.
 *
 * They are not all stale, and the difference matters more than the cleanup
 * does. 672 have a stamped row saying the same thing to within 0.995 — those
 * are the superseded copies. The other 286 have no counterpart at all: they are
 * mostly LH Philosophie, from papers the current extractor no longer parses, and
 * deleting them would silently remove real questions from the bank. So the
 * criterion here is "a better copy demonstrably exists", never "has no ref".
 *
 * Nothing is deleted. The rows are marked `rejected`, which retrieval and
 * practice already skip, so the change is one UPDATE away from being undone and
 * no attempt, simulation or answer loses the row it points at. That matters:
 * thirteen of these have student activity attached.
 */

import { readFileSync, writeFileSync } from 'node:fs';

import { db } from '@/lib/db';

/** Where the retired ids are recorded, so the change can be undone exactly. */
const RECEIPT = 'corpus/retired-superseded.json';

/** How alike a stamped row must be before it counts as the same question. */
const SUPERSEDES = 0.995;

async function main() {
  const apply = process.argv.includes('--apply');

  if (process.argv.includes('--undo')) {
    const { ids } = JSON.parse(readFileSync(RECEIPT, 'utf-8')) as { ids: string[] };
    const back = await db.question.updateMany({
      where: { id: { in: ids } },
      data: { verifiedStatus: 'unverified' },
    });
    console.log(`${back.count} question(s) put back to unverified.`);
    return;
  }

  const doomed: { id: string; subject: string; track: string; text: string; similarity: number }[] =
    await db.$queryRaw`
      SELECT DISTINCT ON (o.id)
        o.id, s.name AS subject, t.code AS track,
        left(o.content_text, 70) AS text,
        1 - (o.embedding <=> k.embedding) AS similarity
      FROM questions o
      JOIN chapters co ON co.id = o.chapter_id
      JOIN subjects s ON s.id = co.subject_id
      JOIN tracks t ON t.id = s.track_id
      JOIN chapters ck ON ck.subject_id = co.subject_id
      JOIN questions k ON k.chapter_id = ck.id AND k.source_ref IS NOT NULL
      WHERE o.source_ref IS NULL
        AND o.source_type = 'past_exam'
        AND o.verified_status <> 'rejected'
        AND o.embedding IS NOT NULL AND k.embedding IS NOT NULL
        AND 1 - (o.embedding <=> k.embedding) >= ${SUPERSEDES}
      ORDER BY o.id, 1 - (o.embedding <=> k.embedding) DESC`;

  const kept: { n: bigint }[] = await db.$queryRaw`
    SELECT count(*) AS n FROM questions o
    WHERE o.source_ref IS NULL AND o.source_type = 'past_exam'
      AND NOT EXISTS (
        SELECT 1 FROM questions k
        JOIN chapters ck ON ck.id = k.chapter_id
        JOIN chapters co ON co.id = o.chapter_id
        WHERE k.source_ref IS NOT NULL AND ck.subject_id = co.subject_id
          AND k.embedding IS NOT NULL AND o.embedding IS NOT NULL
          AND 1 - (o.embedding <=> k.embedding) >= ${SUPERSEDES}
      )`;

  console.log(`${doomed.length} superseded copies would be retired`);
  console.log(`${kept[0]!.n} refless rows have no better copy and are LEFT ALONE\n`);

  const byTrack = new Map<string, number>();
  for (const row of doomed) byTrack.set(row.track, (byTrack.get(row.track) ?? 0) + 1);
  for (const [track, n] of [...byTrack].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${track}: ${n}`);
  }

  console.log('\n  a sample:');
  for (const row of doomed.slice(0, 6)) {
    console.log(`    ${row.similarity.toFixed(4)}  [${row.track}] ${row.subject.slice(0, 16).padEnd(18)}${row.text.replace(/\s+/g, ' ')}`);
  }

  if (!apply) {
    console.log('\nNothing changed. Re-run with --apply to mark these rejected.');
    return;
  }

  const ids = doomed.map((d) => d.id);

  /*
   * The exact list is written before the update, not after.
   *
   * An undo that means "whatever I changed" is worth nothing if the process
   * died halfway, or if a reviewer rejects a question next week and the two
   * become indistinguishable. This file names the rows, so putting them back
   * never touches a decision somebody else made.
   */
  writeFileSync(RECEIPT, JSON.stringify({ retiredAt: new Date().toISOString(), ids }, null, 1), 'utf-8');

  const updated = await db.question.updateMany({
    where: { id: { in: ids } },
    data: { verifiedStatus: 'rejected' },
  });
  console.log(`
${updated.count} question(s) marked rejected.`);
  console.log(`  ids recorded in ${RECEIPT}`);
  console.log('  undo:  npm run retire:superseded -- --undo');
}

main()
  .catch((e) => {
    console.error('Retire failed:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
