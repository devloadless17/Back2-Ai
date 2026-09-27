/**
 * Repairs a numeral Mathpix read as a superscript.
 *
 *   npm run corpus:repair-superscripts                                   # dry run
 *   npm run corpus:repair-superscripts -- --apply --confirm-db <dbname>
 *   npm run corpus:repair-superscripts -- --rollback <run> --confirm-db <dbname>
 *
 * WHY. A physics question read "the radioactive decay is represented by the
 * curve in document" and then stopped, with a small circle on the next line.
 * The paper says "document 5". Mathpix wrote `document ${ }^{\circ}$` — an
 * empty-base superscript — and the viewer renders that as a floating degree
 * mark, so the student is pointed at a document with no number.
 *
 * MOST EMPTY-BASE SUPERSCRIPTS ARE CORRECT AND MUST NOT BE TOUCHED. Of the 15
 * in this corpus that are not isotope notation, six are real: `m/s ${ }^{2}$`,
 * `mm ${ }^{3}$` of blood, `(z') ${ }^{6}$`. A rule that stripped the construct
 * wholesale would turn m/s² into m/s and silently corrupt the physics. So this
 * repairs two named shapes and leaves everything else alone.
 *
 *   A LOST DOCUMENT NUMBER — `document ${ }^{…}$`. The digit is recoverable
 *   because `content_text`, which comes from the PDF's own text layer rather
 *   than from Mathpix, still has it. Applied ONLY when the text layer's
 *   document numbers are unanimous and there are as many of them as there are
 *   broken references, so a paper citing documents 1 and 2 is never flattened
 *   to one of them. Both affected rows cite document 5 three times.
 *
 *   AN ORDINAL MARK — `N ${ }^{0}$`, which is "N°" set as a superscript zero.
 *   Needs no external evidence: a standalone capital N before an empty-base
 *   zero is the abbreviation for "numéro" in every instance here ("N° de
 *   l'expérience", "«Santé» N° 25-2005"). Cosmetic rather than a loss of
 *   meaning, but it is the same OCR slip and it reads as an exponent.
 *
 * It rewrites `content_latex` only. `content_text` is the evidence this works
 * from and is never modified.
 *
 * DRY RUN UNLESS TOLD OTHERWISE, and reversible: the previous value of every
 * row is written to corpus/.mapping/superscript-refs-<db>-<run>.json.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { db } from '../../src/lib/db';

const ROOT = process.cwd();

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}
const APPLY = process.argv.includes('--apply');
const ROLLBACK = arg('rollback');
const CONFIRM_DB = arg('confirm-db');
const BACKUP_DIR = arg('backup-dir') ?? 'corpus/.mapping';

const backupPath = (run: string, database: string) =>
  path.join(ROOT, BACKUP_DIR, `superscript-refs-${database}-${run}.json`);

type Backup = { run: string; rows: Record<string, string> };

/** `document ${ }^{0}$` / `document ${ }^{\circ}$`, in any of the three languages. */
const DOCUMENT_REF = /(document|doc|mستند)(\s*)\$\{ \}\^\{[^}]*\}\$/gi;
/** A standalone capital N before an empty-base zero: the ordinal mark. */
const ORDINAL_N = /\bN(\s*)\$\{ \}\^\{0\}\$/g;
/** The document numbers the PDF's own text layer still carries. */
const TEXT_DOCUMENT_NUMBER = /(?:document|doc)\s*(\d+)/gi;

async function currentDatabase(): Promise<string> {
  const rows = await db.$queryRaw<Array<{ d: string }>>`SELECT current_database() AS d`;
  return rows[0]!.d;
}

async function guardWrite() {
  const database = await currentDatabase();
  if (!CONFIRM_DB || CONFIRM_DB !== database) {
    throw new Error(
      `refusing to write: connected to "${database}", --confirm-db says "${CONFIRM_DB ?? '(none)'}"`,
    );
  }
  return database;
}

async function rollback(run: string) {
  const database = await guardWrite();
  const file = backupPath(run, database);
  if (!existsSync(file)) throw new Error(`no backup for run ${run} at ${file}`);
  const backup = JSON.parse(readFileSync(file, 'utf-8')) as Backup;
  let restored = 0;
  for (const [id, before] of Object.entries(backup.rows)) {
    restored += await db.$executeRaw`
      UPDATE questions SET content_latex = ${before} WHERE id = ${id}::uuid`;
  }
  console.log(`\n  database ${database}: ${restored} row(s) restored.\n`);
}

/** The repaired body, or null when nothing here can be repaired safely. */
export function repair(latex: string, text: string): { next: string; documents: number; ordinals: number } | null {
  let next = latex;
  let documents = 0;
  let ordinals = 0;

  const broken = latex.match(DOCUMENT_REF)?.length ?? 0;
  if (broken > 0) {
    const numbers = [...text.matchAll(TEXT_DOCUMENT_NUMBER)].map((m) => m[1]!);
    const unanimous = numbers.length > 0 && new Set(numbers).size === 1;
    // As many numbers in the text layer as broken references, or a paper citing
    // documents 1 and 2 would have both flattened to whichever came first.
    if (unanimous && numbers.length >= broken) {
      next = next.replace(DOCUMENT_REF, (_m, word: string, gap: string) => `${word}${gap || ' '}${numbers[0]}`);
      documents = broken;
    }
  }

  const ordinalCount = next.match(ORDINAL_N)?.length ?? 0;
  if (ordinalCount > 0) {
    next = next.replace(ORDINAL_N, 'N°');
    ordinals = ordinalCount;
  }

  return next === latex ? null : { next, documents, ordinals };
}

async function main() {
  if (ROLLBACK) return rollback(ROLLBACK);
  const database = await currentDatabase();

  /*
   * Built as a value, not written into the template.
   *
   * The literal two characters `$` `{` open an interpolation in a tagged
   * template, so spelling the pattern inline turned it into a bound parameter
   * and the query silently matched a different 19 rows — the report said 19
   * found and 0 repaired, which reads like a regex bug and was not one.
   */
  const emptySuperscript = `%${String.fromCharCode(36)}{ }^{%`;

  const rows = await db.$queryRaw<Array<{ id: string; latex: string; text: string }>>`
    SELECT id::text, content_latex AS latex, content_text AS text
      FROM questions
     WHERE verified_status <> 'rejected'
       AND content_latex IS NOT NULL
       AND content_latex LIKE ${emptySuperscript}`;

  const fixes: { id: string; before: string; after: string; documents: number; ordinals: number }[] = [];
  for (const row of rows) {
    const out = repair(row.latex, row.text ?? '');
    if (out) fixes.push({ id: row.id, before: row.latex, after: out.next, ...out });
  }

  const documents = fixes.reduce((n, f) => n + f.documents, 0);
  const ordinals = fixes.reduce((n, f) => n + f.ordinals, 0);

  console.log('');
  console.log(`  database ${database}`);
  console.log(`  bodies carrying an empty-base superscript   ${rows.length}`);
  console.log(`  bodies repaired                             ${fixes.length}`);
  console.log(`    document numbers restored                 ${documents}`);
  console.log(`    ordinal marks (N° set as a superscript)   ${ordinals}`);
  console.log('');
  for (const f of fixes.slice(0, 6)) {
    const at = f.after.search(/document\s*\d|N°/);
    console.log(`    ${f.id.slice(0, 8)}  …${f.after.slice(Math.max(0, at - 34), at + 16).replace(/\s+/g, ' ')}…`);
  }
  console.log('');

  if (!APPLY) {
    console.log(`  DRY RUN — nothing written. Re-run with --apply --confirm-db ${database}.`);
    console.log('');
    return;
  }

  await guardWrite();
  const run = new Date().toISOString().slice(0, 19).replace(/[:T-]/g, '');
  const backup: Backup = { run, rows: {} };
  for (const f of fixes) backup.rows[f.id] = f.before;
  writeFileSync(backupPath(run, database), JSON.stringify(backup));

  let written = 0;
  for (const f of fixes) {
    written += await db.$executeRaw`
      UPDATE questions SET content_latex = ${f.after}
       WHERE id = ${f.id}::uuid AND content_latex = ${f.before}`;
  }
  console.log(`  wrote ${written} row(s).`);
  console.log(`  backup: ${path.relative(ROOT, backupPath(run, database))}`);
  console.log(`  rollback: npm run corpus:repair-superscripts -- --rollback ${run} --confirm-db ${database}`);
  console.log('');
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
