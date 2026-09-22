/**
 * Clears display text that belongs to a different exercise.
 *
 *   npm run corpus:clear-mismatched                                   # dry run (default)
 *   npm run corpus:clear-mismatched -- --show 10                      # print the evidence
 *   npm run corpus:clear-mismatched -- --apply --confirm-db <dbname>  # write
 *   npm run corpus:clear-mismatched -- --rollback <run> --confirm-db <dbname>
 *
 * WHY. `content_latex` is what the viewer and the tutor prefer, so whatever is
 * in that column IS the question as far as a student is concerned. Rows exist
 * where it holds another exercise entirely — a capacitor question displaying a
 * hydrogen-photon one — or nothing but the ministry's Arabic masthead. They
 * came from `reextract-questions.ts`, which found its text by searching the
 * paper and could land on the wrong exercise; the row's own `content_text` is
 * the right exercise.
 *
 * Clearing the column is the whole fix: `QuestionBody` falls back to
 * `content_text`, which is that row's own statement. Nothing is deleted and no
 * text is rewritten — a cleared row can be refilled by `corpus:display-text`
 * the moment the generator covers it.
 *
 * TWO RULES, BOTH EVIDENCE, NOT A THRESHOLD ON ITS OWN:
 *
 *   1. SCRIPT FLIP — the stored statement is Latin and the display text is
 *      Arabic, or the reverse. An exercise does not change alphabet.
 *
 *   2. IT BELONGS TO SOMEBODY ELSE — the display text's opening words are
 *      mostly absent from this row's statement AND match another row's
 *      statement. Overlap alone would also catch a row whose `content_text` is
 *      OCR wreckage, which is exactly where a good `content_latex` matters
 *      most, so a second row has to claim the text before it is cleared.
 *
 * NEVER CLEARS Mathpix display text: anything byte-identical to a record in
 * corpus/.mapping/display-text.json is left alone, whatever the rules say.
 * That text is generated FROM the paper's own lines and is gated already
 * (`load-display-text.ts`), and the scheme rule there deliberately produces
 * text that does not match a polluted statement.
 *
 * DRY RUN UNLESS TOLD OTHERWISE, and reversible: the previous value of every
 * cleared row is written to corpus/.mapping/clear-mismatched-<db>-<run>.json,
 * and `--rollback` puts it back where the row is still empty.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { db } from '../../src/lib/db';

const ROOT = process.cwd();
const ARTIFACT = path.join(ROOT, 'corpus/.mapping/display-text.json');

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}
const APPLY = process.argv.includes('--apply');
const ROLLBACK = arg('rollback');
const CONFIRM_DB = arg('confirm-db');
const SHOW = Number(arg('show') ?? 0);
const BACKUP_DIR = arg('backup-dir') ?? 'corpus/.mapping';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const backupPath = (run: string, database: string) =>
  path.join(ROOT, BACKUP_DIR, `clear-mismatched-${database}-${run.slice(0, 16)}.json`);

const ARABIC = /[؀-ۿ]/gu;
const LETTER = /\p{L}/gu;

/** The opening words of a body, maths and punctuation removed. */
function head(text: string, n = 12): string[] {
  return text
    .replace(/\$[^$]*\$/g, ' ')
    .replace(/[^\p{L}\s]/gu, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, n);
}

/** Which alphabet a body is written in, or null when it is too short to say. */
function script(text: string): 'arabic' | 'latin' | null {
  const letters = (text.match(LETTER) ?? []).length;
  if (letters < 40) return null;
  const arabic = (text.match(ARABIC) ?? []).length;
  if (arabic > letters * 0.6) return 'arabic';
  if (arabic < letters * 0.05) return 'latin';
  return null;
}

const overlap = (words: string[], against: Set<string>) =>
  words.length === 0 ? 1 : words.filter((w) => against.has(w)).length / words.length;

async function currentDatabase(): Promise<string> {
  const rows = await db.$queryRaw<Array<{ d: string }>>`SELECT current_database() AS d`;
  return rows[0]!.d;
}

async function guardWrite() {
  const database = await currentDatabase();
  if (!CONFIRM_DB || CONFIRM_DB !== database) {
    throw new Error(`refusing to write: connected to "${database}", --confirm-db says "${CONFIRM_DB ?? '(none)'}"`);
  }
  return database;
}

type Backup = { run: string; rows: Record<string, string> };

async function rollback(run: string) {
  const database = await guardWrite();
  const file = backupPath(run, database);
  if (!existsSync(file)) throw new Error(`no backup for run ${run} at ${file}`);
  const backup = JSON.parse(readFileSync(file, 'utf-8')) as Backup;
  let restored = 0;
  let skipped = 0;
  for (const [id, before] of Object.entries(backup.rows)) {
    const n = await db.$executeRaw`
      UPDATE questions SET content_latex = ${before} WHERE id = ${id}::uuid AND content_latex IS NULL`;
    if (n) restored += 1;
    else skipped += 1;
  }
  console.log(`database ${database}: restored ${restored}; left alone (refilled since) ${skipped}`);
}

async function main() {
  if (ROLLBACK) return rollback(ROLLBACK);
  const database = await currentDatabase();
  console.log(`database ${database}\n`);

  const generated = new Set<string>(
    existsSync(ARTIFACT)
      ? (JSON.parse(readFileSync(ARTIFACT, 'utf-8')) as Array<{ markdown?: string }>)
          .map((r) => r.markdown)
          .filter((m): m is string => Boolean(m))
      : [],
  );
  if (generated.size === 0) console.log('warning: no display-text artifact found — Mathpix text cannot be recognised\n');

  const rows = await db.$queryRaw<Array<{ id: string; text: string; latex: string }>>`
    SELECT id::text, content_text AS text, content_latex AS latex
      FROM questions WHERE content_latex IS NOT NULL`;

  // Who else could this text belong to? An inverted index over opening words.
  const owners = new Map<string, string[]>();
  const ownHead = new Map<string, Set<string>>();
  for (const r of rows) {
    const words = head(r.text);
    ownHead.set(r.id, new Set(words));
    for (const w of new Set(words)) {
      const list = owners.get(w) ?? [];
      list.push(r.id);
      owners.set(w, list);
    }
  }

  const doomed: Array<{ id: string; why: string; text: string; latex: string }> = [];
  let protectedByArtifact = 0;
  for (const r of rows) {
    if (generated.has(r.latex)) {
      protectedByArtifact += 1;
      continue;
    }
    const mine = ownHead.get(r.id)!;
    const shown = head(r.latex);
    const a = script(r.text);
    const b = script(r.latex);
    if (a && b && a !== b) {
      doomed.push({ id: r.id, why: `script flip: statement ${a}, display ${b}`, text: r.text, latex: r.latex });
      continue;
    }
    if (mine.size < 4 || shown.length < 4) continue;
    if (overlap(shown, mine) >= 0.25) continue;

    // Does another row's statement claim this text?
    const counts = new Map<string, number>();
    for (const w of new Set(shown)) {
      for (const id of owners.get(w) ?? []) if (id !== r.id) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    let best = { id: '', score: 0 };
    for (const [id, c] of counts) {
      if (c < 3) continue;
      const score = overlap(shown, ownHead.get(id)!);
      if (score > best.score) best = { id, score };
    }
    if (best.score >= 0.6) {
      doomed.push({ id: r.id, why: `belongs to ${best.id.slice(0, 8)} (${Math.round(best.score * 100)}% of its opening)`, text: r.text, latex: r.latex });
    }
  }

  console.log(`rows with display text        ${rows.length}`);
  console.log(`  Mathpix text, never cleared ${protectedByArtifact}`);
  console.log(`  showing another exercise    ${doomed.length}`);
  const flips = doomed.filter((d) => d.why.startsWith('script flip')).length;
  console.log(`    by script flip            ${flips}`);
  console.log(`    claimed by another row    ${doomed.length - flips}`);

  for (const d of doomed.slice(0, SHOW)) {
    console.log(`\n  ${d.id} — ${d.why}`);
    console.log(`     says:  ${d.text.replace(/\s+/g, ' ').slice(0, 90)}`);
    console.log(`     shows: ${d.latex.replace(/\s+/g, ' ').slice(0, 90)}`);
  }

  if (!APPLY) {
    console.log(`\nDRY RUN: ${doomed.length} row(s) would have content_latex cleared. Re-run with --apply --confirm-db ${database}.`);
    return;
  }
  await guardWrite();
  const run = sha256(doomed.map((d) => d.id).sort().join(','));
  const file = backupPath(run, database);
  const backup: Backup = existsSync(file) ? JSON.parse(readFileSync(file, 'utf-8')) : { run, rows: {} };
  for (const d of doomed) if (!backup.rows[d.id]) backup.rows[d.id] = d.latex;
  writeFileSync(file, JSON.stringify(backup));

  let cleared = 0;
  for (const d of doomed) {
    cleared += await db.$executeRaw`UPDATE questions SET content_latex = NULL WHERE id = ${d.id}::uuid`;
  }
  console.log(`\ncleared ${cleared} row(s). Backup: ${path.relative(ROOT, file)}`);
  console.log(`rollback: npm run corpus:clear-mismatched -- --rollback ${run} --confirm-db ${database}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
