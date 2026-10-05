/**
 * Text fixes, written only where the stored text is still what was read.
 *
 *   npm run corpus:text-fixes -- --source <fixes.json>                          report
 *   npm run corpus:text-fixes -- --source <fixes.json> --apply --confirm-db bac2   writes
 *   npm run corpus:text-fixes -- --restore <table> --confirm-db bac2
 *
 * A fix is {id, column, before, after} (fix_key_rows.py writes them). It is
 * written when question `id` holds exactly `before` in `column`; a row changed
 * since, or missing, is left alone and counted. Each row written is copied to
 * a backup table first; --restore puts it back.
 */
import { readFileSync } from 'node:fs';

import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();
const COLUMNS = new Set(['content_text', 'content_latex', 'official_solution', 'official_solution_latex']);

type Fix = { id: string; column: string; before: string; after: string; title?: string };

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function confirmDatabase(): Promise<string> {
  const rows = await db.$queryRaw<Array<{ d: string }>>`SELECT current_database() AS d`;
  const database = rows[0]!.d;
  if (arg('confirm-db') !== database) {
    throw new Error(`refusing to write: connected to "${database}", --confirm-db says "${arg('confirm-db') ?? '(none)'}"`);
  }
  return database;
}

async function restore(table: string) {
  await confirmDatabase();
  if (!/^backup_text_fixes_\d{14}$/.test(table)) throw new Error(`not a backup table of this script: ${table}`);
  const n = await db.$executeRawUnsafe(`
    UPDATE questions q SET content_text = b.content_text, content_latex = b.content_latex,
           official_solution = b.official_solution, official_solution_latex = b.official_solution_latex
      FROM ${table} b WHERE b.id = q.id`);
  console.log(`restored ${n} row(s) from ${table}`);
}

async function main() {
  const restoreFrom = arg('restore');
  if (restoreFrom) return restore(restoreFrom);
  const source = arg('source');
  if (!source) throw new Error('--source <fixes.json> is required');
  const fixes: Fix[] = JSON.parse(readFileSync(source, 'utf8'));
  for (const f of fixes) if (!COLUMNS.has(f.column)) throw new Error(`column not allowed: ${f.column}`);

  const ids = [...new Set(fixes.map((f) => f.id))];
  const rows = await db.$queryRawUnsafe<Array<Record<string, string | null>>>(
    `SELECT id::text AS id, content_text, content_latex, official_solution, official_solution_latex
       FROM questions WHERE id = ANY($1::uuid[])`,
    ids,
  );
  const byId = new Map(rows.map((r) => [r.id!, r]));
  const ready: Fix[] = [];
  let missing = 0;
  let changed = 0;
  let done = 0;
  for (const f of fixes) {
    const row = byId.get(f.id);
    if (!row) missing += 1;
    else if (row[f.column] === f.after) done += 1;
    else if (row[f.column] !== f.before) changed += 1;
    else ready.push(f);
  }
  console.log(`  fixes in file                 ${fixes.length}`);
  console.log(`  to write                      ${ready.length}`);
  console.log(`  already written               ${done}`);
  console.log(`  left alone: row missing       ${missing}`);
  console.log(`  left alone: text changed      ${changed}`);

  if (!process.argv.includes('--apply')) {
    console.log('\n  report only — pass --apply --confirm-db <database> to write.');
    return;
  }
  if (!ready.length) return;
  const database = await confirmDatabase();
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  const table = `backup_text_fixes_${stamp}`;
  await db.$executeRawUnsafe(
    `CREATE TABLE ${table} AS
       SELECT id, content_text, content_latex, official_solution, official_solution_latex
         FROM questions WHERE id = ANY($1::uuid[])`,
    [...new Set(ready.map((f) => f.id))],
  );
  let written = 0;
  for (const f of ready) {
    // The column name is from COLUMNS, never from the file unchecked.
    written += await db.$executeRawUnsafe(
      `UPDATE questions SET ${f.column} = $1 WHERE id = $2::uuid AND ${f.column} = $3`,
      f.after,
      f.id,
      f.before,
    );
  }
  console.log(`\n  ${written} column(s) written on ${database}; backup in ${table}.`);
  console.log(`  undo:  npm run corpus:text-fixes -- --restore ${table} --confirm-db ${database}`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
