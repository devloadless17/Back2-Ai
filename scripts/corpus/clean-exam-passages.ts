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

import { cleanPassage } from './passage-cleanup';

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

type Backup = { run: string; rows: Record<string, string> };

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
      UPDATE questions SET source_passage = ${before} WHERE id = ${id}::uuid`;
  }
  console.log(`  restored ${restored} passage(s) in ${name}.`);
}

async function main() {
  const name = await database();
  if (ROLLBACK) {
    await rollback(ROLLBACK, name);
    await db.$disconnect();
    return;
  }

  const rows = await db.$queryRawUnsafe<Array<{ id: string; subject: string; p: string }>>(
    'select q.id, s.name as subject, q.source_passage as p' +
      ' from questions q join chapters ch on ch.id = q.chapter_id join subjects s on s.id = ch.subject_id' +
      " where s.language <> 'ar' and q.source_passage is not null and q.source_passage <> ''",
  );

  const fixes = rows
    .map((r) => ({ ...r, after: cleanPassage(r.p) }))
    .filter((r) => r.after !== r.p);

  const bySubject = fixes.reduce<Record<string, number>>((a, f) => ((a[f.subject] = (a[f.subject] ?? 0) + 1), a), {});
  const removed = fixes.reduce((a, f) => a + (f.p.length - f.after.length), 0);
  console.log('');
  console.log(`  database ${name}`);
  console.log(`  passages read                ${rows.length}`);
  console.log(`  passages to clean            ${fixes.length}`);
  console.log(`  characters of furniture      ${removed}`);
  console.log('  by subject:', bySubject);
  console.log('');
  for (const f of fixes.slice(0, 5)) {
    const first = f.after.split('\n').find((l) => l.trim()) ?? '';
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
  for (const f of fixes) backup.rows[f.id] = f.p;
  writeFileSync(backupPath(run, name), JSON.stringify(backup));

  let written = 0;
  for (const f of fixes) {
    written += await db.$executeRaw`
      UPDATE questions SET source_passage = ${f.after}
       WHERE id = ${f.id}::uuid AND source_passage = ${f.p}`;
  }
  console.log(`  wrote ${written} passage(s).`);
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
