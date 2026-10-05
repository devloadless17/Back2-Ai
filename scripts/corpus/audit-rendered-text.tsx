/**
 * What a student reads on a past-paper page, checked for three kinds of damage.
 *
 *   npx tsx scripts/corpus/audit-rendered-text.tsx <questions.jsonl> <report-dir>
 *
 * The input is one JSON row per question (id, cycle, title, subject, language,
 * content_text, content_latex, official_solution, official_solution_latex,
 * paper_parts, visuals), exported from the database the page reads. Each text
 * goes through the page's own steps (bodyToRender, paperPartsOf, partMarkdown,
 * the Markdown + KaTeX pipeline of MathText), so what is counted is what shows:
 *
 *   formula  KaTeX could not draw a formula: the student sees its source in red.
 *   loose    a printed table or graph flattened into a column of fragments
 *            ("Cholesterol level in the / blood (mg.dl-1) ≤ 120 150 220 ≥250 /
 *            3 4 6 8 / Document 1 / Document 2"), Life Sciences SE 2021-2.
 *   key      a marking key row with its label printed twice ("1.2 1.2 —",
 *            "11.1 —") or a stray cell ("2 2 &", a lone "2").
 *
 * No database, no network, no model. Writes <report-dir>/audit.json (every
 * finding) and prints counts per track and subject.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import type { PluggableList } from 'unified';

import { normalizeMathDelimiters } from '@/lib/math-delimiters';
import { paperPartsOf, partMarkdown } from '@/lib/paper-parts';
import { bodyToRender } from '@/lib/question-body';
import { repairSymbolFont } from '@/lib/symbol-font';

const REMARK = [remarkMath, [remarkGfm, { singleTilde: false }], remarkBreaks] as PluggableList;

type Row = {
  id: string; cycle: string; title: string; subject: string; language: string;
  content_text: string | null; content_latex: string | null;
  official_solution: string | null; official_solution_latex: string | null;
  paper_parts: unknown; visuals: number;
};
type Finding = { kind: 'formula' | 'loose' | 'key'; where: string; sample: string };

/** The formulas KaTeX refused, as MathText would render this text. */
function formulaErrors(text: string): string[] {
  const body = repairSymbolFont(normalizeMathDelimiters(text));
  const html = renderToStaticMarkup(
    createElement(ReactMarkdown, { remarkPlugins: REMARK, rehypePlugins: [rehypeKatex], skipHtml: true }, body),
  );
  const out: string[] = [];
  for (const m of html.matchAll(/<span class="katex-error"[^>]*>([\s\S]*?)<\/span>/g)) {
    out.push(m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').slice(0, 160));
  }
  return out;
}

const SENTENCE_END = /[.:;?!»]\s*$/;
const LIST_HEAD = /^\s*(?:[-•*]|[a-zA-Z0-9]{1,3}\s*[-.)]|\|)/;

/**
 * A run of fragment lines: at least 5 lines in a row of at most 8 words, none
 * ending a sentence or opening a list item, and at least one of them nothing
 * but numbers or a bare "Document N" caption. Prose and numbered questions
 * never qualify; a flattened table or graph does.
 */
function looseRuns(text: string): string[] {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('!['));
  const out: string[] = [];
  let run: string[] = [];
  const flush = () => {
    const telltale = run.some((l) => /^[\d\s.,%≤≥<>±+\-–]+$/.test(l) || /^\*{0,2}(?:Document|Doc\.?)\s*[-–]?\s*\d+\*{0,2}$/i.test(l));
    if (run.length >= 5 && telltale) out.push(run.join(' / ').slice(0, 220));
    run = [];
  };
  for (const line of lines) {
    const words = line.split(/\s+/).length;
    if (words <= 8 && !SENTENCE_END.test(line) && !LIST_HEAD.test(line) && !line.includes('$$')) run.push(line);
    else flush();
  }
  flush();
  return out;
}

/** Key rows whose label is printed twice, and stray table cells. */
function keyDamage(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const m = line.match(/^(\d+(?:\.\d+)*)\s?(\d+(?:\.\d+)*)\s*(?:—|&|$)/);
    if (m && (m[1] === m[2] || (m[1] + m[2]).length > 2 && doubled(m[1] + m[2]))) out.push(line.slice(0, 120));
    else if (m && doubled(m[1]) && /—/.test(line)) out.push(line.slice(0, 120));
    else if (/^(?:\d+\s+)*\d*\s*&\s*$/.test(line) && line.includes('&')) out.push(line);
  }
  return out;
}

/** "1.11.1" = "1.1" + "1.1"; "11.1" = "1" + "1.1": a label run into itself. */
function doubled(token: string): boolean {
  for (let i = 1; i < token.length; i++) {
    const a = token.slice(0, i);
    const b = token.slice(i);
    if (/\.$/.test(a) || /^\./.test(b)) continue;
    if (b.startsWith(a) && /^\d+(?:\.\d+)*$/.test(a) && /^\d+(?:\.\d+)*$/.test(b) && (a.includes('.') || b.includes('.'))) return true;
  }
  return false;
}

function trackOf(title: string): string {
  return title.match(/ (GS|LS|SE|LH) /)?.[1] ?? '?';
}

const [input, outDir] = process.argv.slice(2);
if (!input || !outDir) {
  console.error('usage: audit-rendered-text.tsx <questions.jsonl> <report-dir>');
  process.exit(1);
}
const rows: Row[] = readFileSync(input, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const report: Record<string, { questions: number; findings: Record<string, number> }> = {};
const all: (Finding & { id: string; cycle: string; title: string; subject: string })[] = [];

for (const row of rows) {
  const section = `${trackOf(row.title)} | ${row.subject}`;
  report[section] ??= { questions: 0, findings: { formula: 0, loose: 0, key: 0 } };
  report[section].questions += 1;
  const texts: { where: string; text: string; question: boolean }[] = [];
  const parts = paperPartsOf(row.paper_parts);
  let partsAnswered = false;
  if (parts) {
    texts.push({ where: 'intro', text: bodyToRender(parts.intro, parts.intro), question: true });
    parts.parts.forEach((p, i) => {
      texts.push({ where: `part ${p.label || i + 1}`, text: partMarkdown(p.text), question: true });
      if (p.answer) texts.push({ where: `answer ${p.label || i + 1}`, text: p.answer, question: false });
    });
    if (parts.fullKey) texts.push({ where: 'full key', text: parts.fullKey, question: false });
    partsAnswered = parts.parts.some((p) => p.answer || p.answerImage);
  } else {
    texts.push({ where: 'question', text: bodyToRender(row.content_latex, row.content_text ?? ''), question: true });
  }
  if (!partsAnswered) {
    const solution = bodyToRender(row.official_solution_latex, row.official_solution ?? '').trim();
    if (solution) texts.push({ where: 'solution', text: solution, question: false });
  }
  const seen = new Set<string>();
  const add = (f: Finding) => {
    const key = `${f.kind}|${f.sample}`;
    if (seen.has(key)) return;
    seen.add(key);
    report[section].findings[f.kind] += 1;
    all.push({ ...f, id: row.id, cycle: row.cycle, title: row.title, subject: row.subject });
  };
  for (const t of texts) {
    for (const s of formulaErrors(t.text)) add({ kind: 'formula', where: t.where, sample: s });
    if (t.question) for (const s of looseRuns(t.text)) add({ kind: 'loose', where: t.where, sample: s });
    if (!t.question) for (const s of keyDamage(t.text)) add({ kind: 'key', where: t.where, sample: s });
  }
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'audit.json'), JSON.stringify(all, null, 1));
const questionsHit = (kind: string, section: string) =>
  new Set(all.filter((f) => f.kind === kind && `${trackOf(f.title)} | ${f.subject}` === section).map((f) => f.id)).size;
console.log('section'.padEnd(46), 'questions', 'formula', 'loose', 'key   (questions affected)');
for (const section of Object.keys(report).sort()) {
  const r = report[section];
  console.log(
    section.padEnd(46),
    String(r.questions).padStart(9),
    String(questionsHit('formula', section)).padStart(7),
    String(questionsHit('loose', section)).padStart(5),
    String(questionsHit('key', section)).padStart(4),
  );
}
console.log(`\n${all.length} findings in ${new Set(all.map((f) => f.id)).size} questions of ${rows.length}`);
