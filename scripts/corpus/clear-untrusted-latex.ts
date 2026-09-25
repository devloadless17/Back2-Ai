/**
 * Clears display text that the gated generator never produced.
 *
 *   npm run corpus:clear-untrusted                                   # dry run (default)
 *   npm run corpus:clear-untrusted -- --show 10                      # print the evidence
 *   npm run corpus:clear-untrusted -- --apply --confirm-db <dbname>  # write
 *   npm run corpus:clear-untrusted -- --rollback <run> --confirm-db <dbname>
 *
 * WHY. Students were shown biology questions with the answers printed under
 * them. `content_latex` is what the viewer and the tutor prefer, so whatever
 * sits in that column IS the question as far as a candidate is concerned, and
 * on those rows it held the marking scheme: "The parathyroid glands are
 * endocrine glands because they do not show excretory ducts (0.5pt), they are
 * richly irrigated by blood vessels (0.5pt)". On an exam-preparation product
 * that is the worst thing the column can contain.
 *
 * WHY NOT A RULE ABOUT THE TEXT. Three were tried and each one broke:
 *
 *   - LENGTH. Maths display text is legitimately several times longer than the
 *     statement, because LaTeX markup is verbose. 83 maths rows are "much
 *     longer" and 6 of those are contaminated.
 *   - MARK ANNOTATIONS. A question paper prints its own marks: "(5 points)"
 *     beside an exercise heading is the paper, not the scheme.
 *   - SMALL MARK ANNOTATIONS. Better — a scheme scores in half-points after
 *     every clause — but the schemes come in two shapes, and the other one is a
 *     table whose "Note" column holds bare numbers with no "pt" anywhere in it.
 *     Nothing in the text distinguishes that column from the exercise.
 *
 * SO THE RULE IS PROVENANCE, NOT CONTENT. `display_text.py` builds display text
 * from the paper's own Mathpix lines, inside the statement span that C1 placed,
 * and refuses a container that starts in the marking scheme, that fails recall
 * or precision against the canonical statement, or that is Arabic at all. Its
 * output is the artifact. Anything in `content_latex` that is not byte-identical
 * to a record in that artifact came from `reextract-questions.ts`, which found
 * its text by searching the paper and could land anywhere — the next exercise,
 * the ministry masthead, or the scheme.
 *
 * Measured on the local corpus: 2,980 rows carry display text, 2,275 of them
 * are the generator's and 705 are not. 263 of those 705 are shown to students;
 * the rest sit on rows already rejected, and are cleared anyway so that
 * un-rejecting one never brings the junk back with it.
 *
 * Of the 705, 495 contain Arabic — which the generator refuses outright, so
 * they cannot be its work — and 92 name a marking scheme in so many words.
 *
 * The same 263 student-visible rows come back if you instead read the loader's
 * own backup files and ask which ids it ever wrote: a different question,
 * answered from a different file, agreeing exactly and with nothing extra on
 * either side.
 *
 * CLEARING IS THE WHOLE FIX. `QuestionBody` falls back to `content_text`, which
 * is that row's own statement; every one of the 263 has one, and none is
 * shorter than twenty characters. Nothing is deleted and no text is rewritten.
 * A cleared row is refilled by `corpus:display-text` the moment the generator
 * covers it, which is the only path that should ever have filled it.
 *
 * WHAT IT COSTS. 288 of the 705 contain formula markup, and some of those were
 * probably right. They go back to their plain-text statement, which renders
 * without formulas. That is a presentation loss against a correctness win, and
 * the trade is not close: the fallback is always this row's own question, while
 * the column being cleared is text with no provenance at all.
 *
 * IT REFUSES TO RUN WITHOUT THE ARTIFACT. An empty artifact makes every row
 * look untrusted and would wipe the column for the whole corpus. The sibling
 * script `clear-mismatched-latex.ts` only warns in that case because its rules
 * stand on their own; this one has no rule left without the file.
 *
 * DRY RUN UNLESS TOLD OTHERWISE, and reversible: the previous value of every
 * cleared row is written to corpus/.mapping/clear-untrusted-<db>-<run>.json,
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
  path.join(ROOT, BACKUP_DIR, `clear-untrusted-${database}-${run}.json`);

type Backup = { run: string; rows: Record<string, string> };

/**
 * Names a marking scheme outright, in any of the three languages.
 *
 * `corrigé` only as `corrigé type` or `corrigé et barème`. On its own it also
 * matches the French imperative that opens a whole family of biology and
 * chemistry questions — "Corrige les expressions suivantes" — which is the
 * question, not its answer. Left loose it reported 113 schemes where there are
 * 92, and 13 of the 21 it invented sat on rows the generator wrote correctly.
 */
const SCHEME_WORDS =
  /(اسس التصحيح|أسس التصحيح|marking scheme|bar[eè]me|corrig[eé]\s+(type|et)|answer key)/i;
const ARABIC = /[؀-ۿ]/;
const FORMULA = /\\[a-zA-Z]+|\$/;

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
  let occupied = 0;
  for (const [id, before] of Object.entries(backup.rows)) {
    // Only where the row is still empty: a cleared row that `corpus:display-text`
    // has since refilled holds the generator's text, which is better than this.
    const n = await db.$executeRaw`
      UPDATE questions SET content_latex = ${before}
       WHERE id = ${id}::uuid AND content_latex IS NULL`;
    if (n) restored += 1;
    else occupied += 1;
  }
  console.log('');
  console.log(`  database ${database}: restored ${restored}; left alone (refilled since) ${occupied}`);
  console.log('');
}

async function main() {
  if (ROLLBACK) return rollback(ROLLBACK);

  const database = await currentDatabase();

  if (!existsSync(ARTIFACT)) {
    throw new Error(
      `refusing to run: ${path.relative(ROOT, ARTIFACT)} is missing.\n` +
        '  Without it every row looks untrusted and this would clear the whole corpus.',
    );
  }

  const generated = new Set(
    (JSON.parse(readFileSync(ARTIFACT, 'utf-8')) as Array<{ markdown?: string }>)
      .map((r) => r.markdown)
      .filter((m): m is string => Boolean(m))
      .map(sha256),
  );
  if (generated.size === 0) {
    throw new Error('refusing to run: the display-text artifact holds no generated text.');
  }

  const rows = await db.$queryRaw<
    Array<{ id: string; subject: string; latex: string; visible: boolean }>
  >`
    SELECT q.id::text, s.name AS subject, q.content_latex AS latex,
           (q.verified_status <> 'rejected') AS visible
      FROM questions q
      JOIN chapters ch ON ch.id = q.chapter_id
      JOIN subjects s ON s.id = ch.subject_id
     WHERE q.content_latex IS NOT NULL
     ORDER BY s.name`;

  const untrusted = rows.filter((r) => !generated.has(sha256(r.latex)));

  const bySubject = new Map<string, number>();
  for (const row of untrusted) bySubject.set(row.subject, (bySubject.get(row.subject) ?? 0) + 1);

  console.log('');
  console.log(`  database ${database}`);
  console.log(`  artifact ${path.relative(ROOT, ARTIFACT)} — ${generated.size} generated texts`);
  console.log('');
  console.log(`  rows carrying display text   ${rows.length}`);
  console.log(`  written by the generator     ${rows.length - untrusted.length}`);
  console.log(`  to clear                     ${untrusted.length}`);
  console.log(
    `    of those, shown to students  ${untrusted.filter((r) => r.visible).length}   (the rest are already rejected)`,
  );
  console.log('');
  console.log(`    of those, containing Arabic  ${untrusted.filter((r) => ARABIC.test(r.latex)).length}   (the generator refuses Arabic papers)`);
  console.log(`    naming a marking scheme      ${untrusted.filter((r) => SCHEME_WORDS.test(r.latex)).length}`);
  console.log(`    carrying formula markup      ${untrusted.filter((r) => FORMULA.test(r.latex)).length}   (what clearing costs)`);
  console.log('');
  for (const [subject, n] of [...bySubject.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(n).padStart(4)}  ${subject}`);
  }
  console.log('');

  for (const row of untrusted.slice(0, SHOW)) {
    console.log(`===== ${row.subject} (${row.id})\n${row.latex.replace(/\s+/g, ' ').slice(0, 500)}\n`);
  }

  if (!APPLY) {
    console.log(`  DRY RUN — nothing was written. Re-run with --apply --confirm-db ${database}.`);
    console.log('  Every cleared row falls back to its own content_text, and --rollback undoes it.');
    console.log('');
    return;
  }

  await guardWrite();

  const run = new Date().toISOString().slice(0, 19).replace(/[:T-]/g, '');
  const backup: Backup = { run, rows: {} };
  for (const row of untrusted) backup.rows[row.id] = row.latex;
  writeFileSync(backupPath(run, database), JSON.stringify(backup));

  let cleared = 0;
  for (const row of untrusted) {
    cleared += await db.$executeRaw`
      UPDATE questions SET content_latex = NULL
       WHERE id = ${row.id}::uuid AND content_latex = ${row.latex}`;
  }

  console.log(`  cleared ${cleared} row(s). Each now renders its own content_text.`);
  console.log(`  backup: ${path.relative(ROOT, backupPath(run, database))}`);
  console.log(`  rollback: npm run corpus:clear-untrusted -- --rollback ${run} --confirm-db ${database}`);
  console.log('');
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
