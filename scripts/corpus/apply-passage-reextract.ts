/**
 * Replaces stored reading passages with the text taken back from their PDFs.
 *
 *   npm run corpus:passage-reextract -- --rebuilt <file>
 *   npm run corpus:passage-reextract -- --rebuilt <file> --apply --confirm-db <dbname>
 *   npm run corpus:passage-reextract -- --rollback <run> --confirm-db <dbname>
 *
 * `reextract_passages.py` produces the file: each passage located in the paper
 * it was printed in, in the paper's own spelling. This writes it.
 *
 * WHY IT IS NEEDED. The stored French passages are broken apart mid-word —
 * "nous somm es", "formation d u", "à condit ion" — at a rate that makes them
 * tiring to read. The damage is not in the paper: the PDF's own text layer says
 * "sommes", "du", "condition". It came from our extraction, so the fix is to
 * take the text back rather than guess at repairs.
 *
 * THE GATE IS CHECKED AGAIN HERE, ON THE FINAL TEXT. A passage is written only
 * when its Latin letters, ignoring every space, are identical to what is already
 * stored. The Python checked the same thing before cleaning; this checks it
 * after, because cleaning runs in between. Two checks around one transformation,
 * because a passage is what a student is asked to read and a silent change to it
 * would be undetectable.
 *
 * DRY RUN UNLESS TOLD OTHERWISE, and `--apply` refuses unless `--confirm-db`
 * names the database the connection actually points at. The old text is written
 * to a backup before anything changes.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { Prisma } from '@prisma/client';

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
const REBUILT = arg('--rebuilt') ?? path.join(ROOT, 'corpus/.mapping/passages-rebuilt.json');

/*
 * Which text is being put back: the passage a comprehension exercise examines,
 * or the question's own body.
 *
 * They are cleaned differently and that difference matters. A passage carries
 * the paper's margin gutter, so its numbers are furniture; a question does not,
 * and a lone number inside one is a mark, an answer or a table row. Using the
 * passage rule on a question body would delete those.
 */
const FIELD = arg('--field') === 'body' ? 'body' : 'passage';
const COLUMN = FIELD === 'body' ? 'content_text' : 'source_passage';
const clean = FIELD === 'body' ? cleanQuestionText : cleanPassage;
const BACKUP_DIR = arg('--backup-dir') ?? 'corpus/.mapping';

const backupPath = (run: string, database: string) =>
  path.join(ROOT, BACKUP_DIR, `passage-reextract-${database}-${run}.json`);

type Backup = { run: string; rows: Record<string, string> };

/** What the gate compares: the passage's own letters and nothing else. */
const latin = (s: string) => (s.toLowerCase().match(/[a-zà-ÿ]/g) ?? []).join('');

const WORD = /[A-Za-zÀ-ÿ'’]+/g;

async function databaseName(): Promise<string> {
  const rows = await db.$queryRawUnsafe<Array<{ current_database: string }>>('select current_database()');
  const name = rows[0]?.current_database;
  if (!name) throw new Error('could not read the database name from this connection');
  return name;
}

function guardWrite(name: string) {
  if (!CONFIRM_DB) throw new Error(`--confirm-db is required to write; this connection is "${name}"`);
  if (CONFIRM_DB !== name) throw new Error(`--confirm-db says "${CONFIRM_DB}" but this connection is "${name}"`);
}

async function main() {
  const name = await databaseName();

  if (ROLLBACK) {
    guardWrite(name);
    const file = backupPath(ROLLBACK, name);
    if (!existsSync(file)) throw new Error(`no backup for run ${ROLLBACK} at ${file}`);
    const backup = JSON.parse(readFileSync(file, 'utf-8')) as Backup;
    let restored = 0;
    for (const [id, before] of Object.entries(backup.rows)) {
      restored += await db.$executeRaw`
        UPDATE questions SET ${Prisma.raw(COLUMN)} = ${before} WHERE id = ${id}::uuid`;
    }
    console.log(`  restored ${restored} passage(s) in ${name}.`);
    await db.$disconnect();
    return;
  }

  const rebuilt = JSON.parse(readFileSync(REBUILT, 'utf-8')) as Array<{ id: string; paper: string; passage: string }>;
  const stored = await db.$queryRawUnsafe<Array<{ id: string; subject: string; p: string }>>(
    `select q.id, s.name as subject, q.${COLUMN} as p` +
      ' from questions q join chapters ch on ch.id = q.chapter_id join subjects s on s.id = ch.subject_id' +
      ' where q.id = any($1::uuid[])',
    rebuilt.map((r) => r.id),
  );
  const byId = new Map(stored.map((r) => [r.id, r]));

  const fixes: Array<{ id: string; subject: string; before: string; after: string; joined: number }> = [];
  const refused: string[] = [];

  for (const r of rebuilt) {
    const was = byId.get(r.id);
    if (!was) continue;
    const after = clean(r.passage);

    // THE GATE. Same letters or it is not written, whatever else looks right.
    if (latin(after) !== latin(was.p)) {
      refused.push(r.id);
      continue;
    }
    if (after === was.p) continue;

    const joined = (was.p.match(WORD) ?? []).length - (after.match(WORD) ?? []).length;
    fixes.push({ id: r.id, subject: was.subject, before: was.p, after, joined });
  }

  const bySubject = fixes.reduce<Record<string, number>>((a, f) => ((a[f.subject] = (a[f.subject] ?? 0) + 1), a), {});
  const joined = fixes.reduce((a, f) => a + Math.max(0, f.joined), 0);
  console.log('');
  console.log(`  database ${name}`);
  console.log(`  field                        ${COLUMN}`);
  console.log(`  bodies offered               ${rebuilt.length}`);
  console.log(`  bodies to rewrite            ${fixes.length}`);
  console.log(`  refused — letters differ     ${refused.length}`);
  console.log(`  broken words put together    ${joined}`);
  console.log('  by subject:', bySubject);
  console.log('');
  for (const f of [...fixes].sort((a, b) => b.joined - a.joined).slice(0, 5)) {
    console.log(`    ${f.id.slice(0, 8)}  ${String(f.joined).padStart(3)} words rejoined  [${f.subject}]`);
  }
  console.log('');

  if (!APPLY) {
    console.log(`  DRY RUN — nothing written. Re-run with --apply --confirm-db ${name}.`);
    console.log('');
    await db.$disconnect();
    return;
  }

  guardWrite(name);
  const run = new Date().toISOString().slice(0, 19).replace(/[:T-]/g, '');
  const backup: Backup = { run, rows: {} };
  for (const f of fixes) backup.rows[f.id] = f.before;
  writeFileSync(backupPath(run, name), JSON.stringify(backup));

  let written = 0;
  for (const f of fixes) {
    written += await db.$executeRaw`
      UPDATE questions SET ${Prisma.raw(COLUMN)} = ${f.after}
       WHERE id = ${f.id}::uuid AND ${Prisma.raw(COLUMN)} = ${f.before}`;
  }
  console.log(`  wrote ${written} passage(s).`);
  console.log(`  backup: ${path.relative(ROOT, backupPath(run, name))}`);
  console.log(`  rollback: npm run corpus:passage-reextract -- --rollback ${run} --confirm-db ${name}`);
  console.log('');
  await db.$disconnect();
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await db.$disconnect();
  process.exit(1);
});
