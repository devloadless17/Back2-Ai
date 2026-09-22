/**
 * Loads Mathpix display text (display_text.py) into `questions.content_latex`.
 *
 *   npm run corpus:display-text                                   # dry run (default): report only
 *   npm run corpus:display-text -- --show 5                       # print five texts that would be written
 *   npm run corpus:display-text -- --apply --confirm-db <dbname>  # write
 *   npm run corpus:display-text -- --rollback <run> --confirm-db <dbname>
 *
 * WHY `content_latex`. It is the column the viewer and the tutor already
 * prefer (`MathText`, `readable()`), and the one `reextract-questions.ts`
 * filled from the PDF text layer — the lossy text this replaces. `content_text`
 * is never touched: it is what the original reader saw, and embeddings are
 * built from it, so nothing here needs re-embedding.
 *
 * THE GATE IS THE PAGE ITSELF. Each text is run through the viewer's own
 * Markdown pipeline — the same delimiter and symbol-font repairs, the same
 * remark/rehype plugins in the same order — and refused if KaTeX reports an
 * error, if LaTeX source survives into the prose, or if a table did not come
 * out as a table. A refused exercise keeps the text it has.
 *
 * DRY RUN UNLESS TOLD OTHERWISE. `--apply` writes nothing unless `--confirm-db`
 * names the database the connection actually points at.
 *
 * IDEMPOTENT AND REVERSIBLE. A row already holding the text is skipped. The
 * value each row held before its first write is kept in
 * corpus/.mapping/display-text-backup-<database>-<run>.json, never overwritten by a later
 * apply; `--rollback` restores it only where the row still holds exactly what
 * this run wrote, so a later edit is never clobbered.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import rehypeKatex from 'rehype-katex';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';

import { db } from '../../src/lib/db';
import { normalizeMathDelimiters } from '../../src/lib/math-delimiters';
import { repairSymbolFont } from '../../src/lib/symbol-font';

const ROOT = process.cwd();
const ARTIFACT = path.join(ROOT, 'corpus/.mapping/display-text.json');
const EXAMS = path.join(ROOT, 'corpus/exams.json');

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}
const APPLY = process.argv.includes('--apply');
const ROLLBACK = arg('rollback');
const CONFIRM_DB = arg('confirm-db');
const SHOW = Number(arg('show') ?? 0);

const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
/*
 * Per database as well as per run: the same artifact applied locally and in
 * production must not share one backup.
 *
 * `--backup-dir` because the VPS runs this in the `ops` container, where
 * `corpus/` is mounted read-only (deploy/docker-compose.prod.yml) and writing
 * the backup there would throw before a single row was written. It points at
 * the writable scratch mount instead.
 */
const BACKUP_DIR = arg('backup-dir') ?? 'corpus/.mapping';
const backupPath = (run: string, database: string) =>
  path.join(ROOT, BACKUP_DIR, `display-text-backup-${database}-${run.slice(0, 16)}.json`);

type Record_ = {
  paper: string;
  sha256: string;
  ordinal: number;
  index: string | number | null;
  verdict: 'ok' | 'refused';
  reason?: string;
  markdown?: string;
};
type Backup = { run: string; rows: Record<string, { before: string | null; written: string }> };

// ---------------------------------------------------------------------------
// The page's own pipeline
// ---------------------------------------------------------------------------
const pipeline = unified()
  .use(remarkParse)
  .use(remarkMath)
  .use(remarkGfm, { singleTilde: false })
  .use(remarkBreaks)
  .use(remarkRehype)
  .use(rehypeKatex);

type Node = { type: string; tagName?: string; value?: string; properties?: { className?: unknown }; children?: Node[] };

/** LaTeX that should never be seen as prose. */
const LEAK = /\\(begin|end|mathrm|frac|item|section|hline|multirow|multicolumn|textbf|includegraphics|caption|left|right)\b|\$/;

/** Why the page would show this text badly, or null if it renders cleanly. */
export function renderProblem(markdown: string): string | null {
  if (markdown.includes('�')) return 'replacement character';
  const body = repairSymbolFont(normalizeMathDelimiters(markdown));
  const tree = pipeline.runSync(pipeline.parse(body)) as unknown as Node;
  let problem: string | null = null;
  let tables = 0;
  const walk = (n: Node, inMath: boolean) => {
    if (problem) return;
    const cls = n.properties?.className;
    const classes = Array.isArray(cls) ? (cls as string[]) : [];
    if (classes.includes('katex-error')) {
      const source = (n.children ?? []).map((c) => c.value ?? '').join('');
      problem = `katex error: ${source.replace(/\s+/g, ' ').slice(0, 90)}`;
      return;
    }
    if (n.tagName === 'table') tables += 1;
    const math = inMath || classes.some((c) => c.startsWith('katex'));
    if (n.type === 'text' && !math && n.value && LEAK.test(n.value)) {
      problem = `latex in prose: ${n.value.trim().slice(0, 60)}`;
      return;
    }
    for (const c of n.children ?? []) walk(c, math);
  };
  walk(tree, false);
  if (problem) return problem;
  const expected = (markdown.match(/^\|(---\|)+$/gm) ?? []).length;
  if (tables !== expected) return `tables: expected ${expected}, rendered ${tables}`;
  return null;
}

// ---------------------------------------------------------------------------
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

async function rollback(run: string) {
  const database = await guardWrite();
  const file = backupPath(run, database);
  if (!existsSync(file)) throw new Error(`no backup for run ${run} at ${file}`);
  const backup = JSON.parse(readFileSync(file, 'utf-8')) as Backup;
  let restored = 0;
  let changedSince = 0;
  for (const [id, { before, written }] of Object.entries(backup.rows)) {
    const n = await db.$executeRaw`
      UPDATE questions SET content_latex = ${before} WHERE id = ${id}::uuid AND content_latex = ${written}`;
    if (n) restored += 1;
    else changedSince += 1;
  }
  console.log(`database ${database}: restored ${restored}; left alone (changed since, or never written) ${changedSince}`);
}

async function main() {
  if (ROLLBACK) return rollback(ROLLBACK);
  // KaTeX's strict-mode notes (a Unicode letter in maths, `\\` in display) are
  // rendered fine by the page; they are not failures and they bury the report.
  console.warn = () => {};

  const raw = readFileSync(ARTIFACT);
  const run = sha256(raw);
  const records = JSON.parse(raw.toString('utf-8')) as Record_[];
  const database = await currentDatabase();
  console.log(`database ${database}`);
  console.log(`artifact ${path.relative(ROOT, ARTIFACT)} run ${run}\n`);

  const exams = new Map(
    (JSON.parse(readFileSync(EXAMS, 'utf-8')) as Array<{ sha256: string; exercises: Array<{ index: string | number | null }> }>)
      .map((e) => [e.sha256, e]),
  );
  const subjects = await db.subject.findMany({ select: { id: true } });

  const tally = new Map<string, number>();
  const bump = (k: string) => tally.set(k, (tally.get(k) ?? 0) + 1);
  const writes: Array<{ id: string; before: string | null; text: string; label: string }> = [];
  const refusedByRender: string[] = [];

  for (const r of records) {
    if (r.verdict !== 'ok' || !r.markdown) {
      bump(`generator refused: ${r.reason}`);
      continue;
    }
    // The artifact's index must still be the exercise's index in exams.json,
    // or the sourceRef below would name a different row.
    const ex = exams.get(r.sha256)?.exercises[r.ordinal - 1];
    if (!ex || String(ex.index) !== String(r.index)) {
      bump('exams.json changed since the artifact');
      continue;
    }
    const problem = renderProblem(r.markdown);
    if (problem) {
      bump(`render gate: ${problem.split(':')[0]}`);
      if (refusedByRender.length < 60) refusedByRender.push(`${r.paper} #${r.ordinal} — ${problem}`);
      continue;
    }
    const refs = subjects.map((s) => sha256(`${s.id}:${r.sha256}:${r.index}:${r.ordinal - 1}`));
    const rows = await db.question.findMany({ where: { sourceRef: { in: refs } }, select: { id: true, contentLatex: true } });
    if (rows.length === 0) {
      bump('no question row (not loaded, or pruned)');
      continue;
    }
    for (const q of rows) {
      if (q.contentLatex === r.markdown) {
        bump('already current');
        continue;
      }
      bump(q.contentLatex ? 'would replace existing content_latex' : 'would fill empty content_latex');
      writes.push({ id: q.id, before: q.contentLatex, text: r.markdown, label: `${r.paper} #${r.ordinal}` });
    }
  }

  console.log('outcome');
  for (const [k, v] of [...tally.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(5)}  ${k}`);
  if (refusedByRender.length) {
    console.log('\nrender-gate examples');
    for (const line of refusedByRender) console.log(`  ${line}`);
  }
  for (const w of writes.slice(0, SHOW)) {
    console.log(`\n===== ${w.label} (${w.id})\n--- before\n${(w.before ?? '(empty)').slice(0, 600)}\n--- after\n${w.text.slice(0, 1200)}`);
  }

  if (!APPLY) {
    console.log(`\nDRY RUN: ${writes.length} row(s) would be written. Re-run with --apply --confirm-db ${database}.`);
    return;
  }
  await guardWrite();

  // Keep the first "before" a row ever had under this run.
  const file = backupPath(run, database);
  const backup: Backup = existsSync(file) ? JSON.parse(readFileSync(file, 'utf-8')) : { run, rows: {} };
  for (const w of writes) {
    if (!backup.rows[w.id]) backup.rows[w.id] = { before: w.before, written: w.text };
  }
  writeFileSync(file, JSON.stringify(backup));

  let written = 0;
  for (const w of writes) {
    written += await db.$executeRaw`UPDATE questions SET content_latex = ${w.text} WHERE id = ${w.id}::uuid`;
  }
  console.log(`\nwrote ${written} row(s). Backup: ${path.relative(ROOT, file)}`);
  console.log(`rollback: npm run corpus:display-text -- --rollback ${run} --confirm-db ${database}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
