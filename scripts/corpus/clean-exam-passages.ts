/**
 * Removes the exam paper's furniture from the reading passages.
 *
 *   npm run corpus:clean-passages                                  # dry run (default)
 *   npm run corpus:clean-passages -- --apply --confirm-db <dbname> # write
 *   npm run corpus:clean-passages -- --rollback <run> --confirm-db <dbname>
 *
 * A French comprehension passage arrives carrying the ministry's Arabic cover
 * line, the line-number gutter the paper prints down its margin, and long runs
 * of blank lines where the layout used to be. None of it is the text the student
 * is asked to read. `passage-cleanup.ts` holds the rules and the reasoning.
 *
 * ARABIC-TAUGHT SUBJECTS ARE NEVER TOUCHED, by this query and again by the rule
 * itself: an Arabic passage legitimately opens in Arabic, and stripping that
 * would delete its first paragraph.
 *
 * DRY RUN UNLESS TOLD OTHERWISE, and `--apply` refuses to write unless
 * `--confirm-db` names the database the connection actually points at.
 *
 * IT WRITES THE OLD TEXT TO A BACKUP BEFORE IT CHANGES ANYTHING, and the backup
 * is written first, so a failure to save it cannot leave edited rows behind.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { db } from '../../src/lib/db';

import { cleanPassage, cleanQuestionText } from './passage-cleanup';

const ROOT = process.cwd();
const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(f);
const arg = (f: string) => {
  const i = argv.indexOf(f);
  return i < 0 ? null : argv[i + 1] ?? null;
};
const APPLY = has('--apply');
const ROLLBACK = arg('--rollback');
const CONFIRM_DB = arg('--confirm-db');
const BACKUP_DIR = arg('--backup-dir') ?? 'corpus/.mapping';

const backupPath = (run: string, database: string) =>
  path.join(ROOT, BACKUP_DIR, `passages-${database}-${run}.json`);

type Before = { p: string | null; t: string; x: string | null };
type Backup = { run: string; rows: Record<string, Before> };

async function database(): Promise<string> {
  const rows = await db.$queryRawUnsafe<Array<{ current_database: string }>>('select current_database()');
  const name = rows[0]?.current_database;
  if (!name) throw new Error('could not read the database name from this connection');
  return name;
}

async function guardWrite(name: string) {
  if (!CONFIRM_DB) throw new Error(`--confirm-db is required to write; this connection is "${name}"`);
  if (CONFIRM_DB !== name) throw new Error(`--confirm-db says "${CONFIRM_DB}" but this connection is "${name}"`);
}

async function rollback(run: string, name: string) {
  await guardWrite(name);
  const file = backupPath(run, name);
  if (!existsSync(file)) throw new Error(`no backup for run ${run} at ${file}`);
  const backup = JSON.parse(readFileSync(file, 'utf-8')) as Backup;
  let restored = 0;
  for (const [id, before] of Object.entries(backup.rows)) {
    restored += await db.$executeRaw`
      UPDATE questions
         SET source_passage = ${before.p}, content_text = ${before.t}, content_latex = ${before.x}
       WHERE id = ${id}::uuid`;
  }
  console.log(`  restored ${restored} row(s) in ${name}.`);
}

async function main() {
  const name = await database();
  if (ROLLBACK) {
    await rollback(ROLLBACK, name);
    await db.$disconnect();
    return;
  }

  /*
   * ARABIC-TAUGHT SUBJECTS ARE EXCLUDED HERE, and the rules decline again on
   * their own. Two guards for one mistake, because that mistake — treating an
   * Arabic paper's own text as a header — deletes the question outright.
   */
  const rows = await db.$queryRawUnsafe<
    Array<{ id: string; subject: string; p: string | null; t: string; x: string | null }>
  >(
    'select q.id, s.name as subject, q.source_passage as p, q.content_text as t, q.content_latex as x' +
      ' from questions q join chapters ch on ch.id = q.chapter_id join subjects s on s.id = ch.subject_id' +
      " where s.language <> 'ar'",
  );

  const fixes = rows
    .map((r) => ({
      ...r,
      afterP: r.p ? cleanPassage(r.p) : r.p,
      afterT: cleanQuestionText(r.t ?? ''),
      afterX: r.x ? cleanQuestionText(r.x) : r.x,
    }))
    .filter((r) => r.afterP !== r.p || r.afterT !== (r.t ?? '') || r.afterX !== r.x);

  const bySubject = fixes.reduce<Record<string, number>>((a, f) => ((a[f.subject] = (a[f.subject] ?? 0) + 1), a), {});
  const len = (s: string | null) => (s ? s.length : 0);
  const removed = fixes.reduce(
    (a, f) => a + (len(f.p) - len(f.afterP)) + (len(f.t) - len(f.afterT)) + (len(f.x) - len(f.afterX)),
    0,
  );
  console.log('');
  console.log(`  database ${name}`);
  console.log(`  rows read                    ${rows.length}`);
  console.log(`  rows to clean                ${fixes.length}`);
  console.log(`    passages                   ${fixes.filter((f) => f.afterP !== f.p).length}`);
  console.log(`    question text              ${fixes.filter((f) => f.afterT !== (f.t ?? '')).length}`);
  console.log(`    question latex             ${fixes.filter((f) => f.afterX !== f.x).length}`);
  console.log(`  characters of furniture      ${removed}`);
  console.log('  by subject:', bySubject);
  console.log('');
  for (const f of fixes.slice(0, 5)) {
    const first = (f.afterT || f.afterP || '').split('\n').find((l) => l.trim()) ?? '';
    console.log(`    ${f.id.slice(0, 8)}  now opens: ${first.trim().slice(0, 70)}`);
  }
  console.log('');

  if (!APPLY) {
    console.log(`  DRY RUN — nothing written. Re-run with --apply --confirm-db ${name}.`);
    console.log('');
    await db.$disconnect();
    return;
  }

  await guardWrite(name);
  const run = new Date().toISOString().slice(0, 19).replace(/[:T-]/g, '');
  const backup: Backup = { run, rows: {} };
  for (const f of fixes) backup.rows[f.id] = { p: f.p, t: f.t, x: f.x };
  writeFileSync(backupPath(run, name), JSON.stringify(backup));

  let written = 0;
  for (const f of fixes) {
    // The WHERE clause carries every column's old value, so a row someone else
    // changed since the plan was made is left alone rather than overwritten.
    written += await db.$executeRaw`
      UPDATE questions
         SET source_passage = ${f.afterP}, content_text = ${f.afterT}, content_latex = ${f.afterX}
       WHERE id = ${f.id}::uuid
         AND content_text = ${f.t}
         AND source_passage IS NOT DISTINCT FROM ${f.p}
         AND content_latex IS NOT DISTINCT FROM ${f.x}`;
  }
  console.log(`  wrote ${written} row(s).`);
  console.log(`  backup: ${path.relative(ROOT, backupPath(run, name))}`);
  console.log(`  rollback: npm run corpus:clean-passages -- --rollback ${run} --confirm-db ${name}`);
  console.log('');
  await db.$disconnect();
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await db.$disconnect();
  process.exit(1);
});
