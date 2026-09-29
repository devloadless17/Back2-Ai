/**
 * Move attempts onto the chapter their question now belongs to, and recompute
 * the mastery they feed.
 *
 *   npm run corpus:follow-attempts                          report only
 *   npm run corpus:follow-attempts -- --apply --confirm-db bac2
 *
 * An attempt records the chapter the student practised in, which is right —
 * until a question is re-filed. After the chapter review moved complex-number
 * exercises out of "Groupes", a student's answers to them still counted toward
 * "Groupes": a weak score on a chapter that now holds none of those questions,
 * and a "weakest chapter" link that opens an empty page.
 *
 * The rule reads only the database as it stands, so it runs the same on any
 * copy after the re-filing: an attempt whose chapter no longer offers its
 * question (no question_chapters row for the pair) moves to the question's
 * own chapter. Attempts in a chapter that still offers the question — the
 * "also" links, the other tracks' copies — are left where they are.
 *
 * Every moved attempt is copied to a backup table first; the report prints the
 * undo. Mastery is recomputed for both the old and the new chapter of each
 * student affected.
 */
import { PrismaClient } from '@prisma/client';

import { recomputeChapterMastery } from '../../src/lib/queries/progress';

const db = new PrismaClient();
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

async function main() {
  const stranded = await db.$queryRaw<Array<{ id: string; user_id: string; from_id: string; to_id: string }>>`
    SELECT a.id::text, a.user_id::text, a.chapter_id::text AS from_id, q.chapter_id::text AS to_id
      FROM attempts a JOIN questions q ON q.id = a.question_id
     WHERE a.chapter_id IS NOT NULL
       AND a.chapter_id <> q.chapter_id
       AND NOT EXISTS (SELECT 1 FROM question_chapters qc WHERE qc.question_id = a.question_id AND qc.chapter_id = a.chapter_id)`;
  const users = new Set(stranded.map((s) => s.user_id));
  console.log(`  attempts on a chapter that no longer offers their question: ${stranded.length} (${users.size} students)`);
  if (!process.argv.includes('--apply') || stranded.length === 0) {
    if (stranded.length) console.log('  report only. Re-run with --apply --confirm-db <database>.');
    return;
  }
  const [{ d }] = await db.$queryRaw<Array<{ d: string }>>`SELECT current_database() AS d`;
  if (arg('confirm-db') !== d) throw new Error(`refusing to write: connected to "${d}", --confirm-db says "${arg('confirm-db') ?? '(none)'}"`);

  const table = `backup_follow_attempts_${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}`;
  const ids = stranded.map((s) => s.id);
  await db.$executeRawUnsafe(`CREATE TABLE ${table} AS SELECT id, chapter_id FROM attempts WHERE id = ANY($1::uuid[])`, ids);
  await db.$executeRawUnsafe(
    `UPDATE attempts a SET chapter_id = q.chapter_id FROM questions q WHERE q.id = a.question_id AND a.id = ANY($1::uuid[])`,
    ids,
  );

  const pairs = new Set(stranded.flatMap((s) => [`${s.user_id}|${s.from_id}`, `${s.user_id}|${s.to_id}`]));
  for (const pair of pairs) {
    const [userId, chapterId] = pair.split('|') as [string, string];
    await recomputeChapterMastery(userId, chapterId);
  }
  console.log(`  moved ${ids.length}; mastery recomputed for ${pairs.size} (student, chapter) pairs.`);
  console.log(`  undo: UPDATE attempts a SET chapter_id = b.chapter_id FROM ${table} b WHERE b.id = a.id;  (then re-run to recompute)`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
