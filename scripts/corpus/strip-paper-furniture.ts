/**
 * Remove the page footer and detached marks column from questions already loaded.
 *
 *   npm run corpus:strip-furniture                                report only
 *   npm run corpus:strip-furniture -- --apply --confirm-db bac2   writes
 *   npm run corpus:strip-furniture -- --restore <table> --confirm-db bac2
 *
 * A student saw a question that ended in thirteen lines of "(علامتان)" and
 * "الثلاثاء 11 تموز 2023 / مشروع": the marks column and footer of the paper,
 * read after the last question. load-exams.ts now strips them on the way in;
 * this applies the SAME function (paper-furniture.ts) to the rows already in
 * the database, so what is stored is exactly what a reload would write and
 * neither undoes the other.
 *
 * Both columns a student can be shown: content_text, and content_latex, which
 * the screens prefer when it is set.
 *
 * Before writing, every row it changes is copied to a backup table named in
 * the output; --restore puts those values back. A changed row's embedding is
 * cleared, so run `npm run ingest -- --embed-missing` afterwards.
 */

import { PrismaClient } from '@prisma/client';

import { stripPaperFurniture } from './paper-furniture';

const db = new PrismaClient();

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
  if (!/^backup_paper_furniture_\d+$/.test(table)) throw new Error(`not a backup table of this script: ${table}`);
  const n = await db.$executeRawUnsafe(`
    UPDATE questions q SET content_text = b.content_text, content_latex = b.content_latex, embedding = NULL
      FROM ${table} b WHERE b.id = q.id`);
  console.log(`  restored ${n} row(s) from ${table}. Run: npm run ingest -- --embed-missing`);
}

async function main() {
  const restoreFrom = arg('restore');
  if (restoreFrom) return restore(restoreFrom);
  const apply = process.argv.includes('--apply');
  const database = apply ? await confirmDatabase() : null;

  const rows = await db.$queryRaw<
    Array<{ id: string; content_text: string; content_latex: string | null; subject: string; track: string | null }>
  >`
    SELECT q.id::text, q.content_text, q.content_latex, s.name AS subject, t.code AS track
      FROM questions q
      JOIN chapters c ON c.id = q.chapter_id
      JOIN subjects s ON s.id = c.subject_id
      LEFT JOIN tracks t ON t.id = s.track_id
     WHERE q.verified_status <> 'rejected'`;

  const changes: Array<{ id: string; text: string; latex: string | null }> = [];
  const bySubject = new Map<string, number>();
  const removedLines = new Map<string, number>();
  const examples: string[] = [];

  for (const row of rows) {
    const text = stripPaperFurniture(row.content_text);
    const latex = row.content_latex === null ? null : stripPaperFurniture(row.content_latex);
    if (!text.removed.length && !latex?.removed.length) continue;
    // Never empty a question: if nothing but furniture is left, leave it for a person.
    if (!text.text.trim() || (latex && !latex.text.trim())) continue;
    changes.push({ id: row.id, text: text.text, latex: latex ? latex.text : null });
    const key = `${row.track ?? '-'} ${row.subject}`;
    bySubject.set(key, (bySubject.get(key) ?? 0) + 1);
    for (const line of [...text.removed, ...(latex?.removed ?? [])]) {
      const shape = line.replace(/ـ+/g, '').replace(/\s+/g, ' ');
      removedLines.set(shape, (removedLines.get(shape) ?? 0) + 1);
    }
    if (examples.length < 8) examples.push(`${key}: …${text.text.slice(-60).replace(/\n/g, ' ')}  ⟵ removed ${JSON.stringify(text.removed)}`);
  }

  console.log(`  questions checked   ${rows.length}`);
  console.log(`  questions to clean  ${changes.length}`);
  for (const [k, v] of [...bySubject].sort((a, b) => b[1] - a[1])) console.log(`    ${String(v).padStart(4)}  ${k}`);
  console.log('  lines removed, most common:');
  for (const [k, v] of [...removedLines].sort((a, b) => b[1] - a[1]).slice(0, Number(arg("show") ?? 15))) console.log(`    ${String(v).padStart(4)}  ${k}`);
  console.log('  examples:');
  for (const e of examples) console.log(`    ${e}`);

  if (!apply) {
    console.log('\n  report only — nothing written. Re-run with --apply --confirm-db <database>.');
    return;
  }
  if (!changes.length) return;

  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  const table = `backup_paper_furniture_${stamp}`;
  const ids = changes.map((c) => c.id);
  await db.$executeRawUnsafe(
    `CREATE TABLE ${table} AS SELECT id, content_text, content_latex FROM questions WHERE id = ANY($1::uuid[])`,
    ids,
  );

  for (const change of changes) {
    await db.$executeRaw`
      UPDATE questions SET content_text = ${change.text}, content_latex = ${change.latex}, embedding = NULL
       WHERE id = ${change.id}::uuid`;
  }
  console.log(`\n  ${changes.length} question(s) cleaned on ${database}; backup in ${table}.`);
  console.log(`  undo:  npm run corpus:strip-furniture -- --restore ${table} --confirm-db ${database}`);
  console.log('  next:  npm run ingest -- --embed-missing');
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
