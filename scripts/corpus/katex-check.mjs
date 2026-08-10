import katex from 'katex';
import { existsSync, readFileSync } from 'node:fs';

const book = process.argv[2];
if (!book) {
  console.error('Usage: npm run corpus:katex <book>   (folder name under corpus/text/)');
  process.exit(1);
}
// Prefer the normalised text when it exists: that is what will be embedded and
// rendered, so it is what has to compile.
const candidates = [
  `corpus/text/${book}/document.clean.md`,
  `corpus/text/${book}/document.md`,
];
const path = candidates.find((p) => existsSync(p));
if (!path) {
  console.error(`No document found for ${book}. Looked for:\n  ${candidates.join('\n  ')}`);
  process.exit(1);
}
console.log(`reading ${path}\n`);
const md = readFileSync(path, 'utf8');

const parts = md.split(/<!-- page (\d+) -->/).slice(1);
const pages = [];
for (let i = 0; i < parts.length; i += 2) pages.push({ n: Number(parts[i]), text: parts[i + 1] });

// '$' is an anchor in a regex — it has to be escaped to mean a literal dollar.
const display = /\$\$([\s\S]*?)\$\$/g;
const inline = /\$([^$]+?)\$/g;

let ok = 0;
const failures = [];

for (const p of pages) {
  const stripped = p.text.replace(display, (m, expr) => {
    check(expr, p.n, 'display');
    return ' ';
  });
  let m;
  inline.lastIndex = 0;
  while ((m = inline.exec(stripped)) !== null) check(m[1], p.n, 'inline');
}

function check(expr, page, mode) {
  const e = expr.trim();
  if (!e) return;
  try {
    katex.renderToString(e, { throwOnError: true, displayMode: mode === 'display' });
    ok += 1;
  } catch (err) {
    failures.push({ page, mode, expr: e.slice(0, 64).replace(/\s+/g, ' '), err: String(err.message).slice(0, 90) });
  }
}

console.log(`pages           ${pages.length}`);
console.log(`equations OK    ${ok}`);
console.log(`equations FAIL  ${failures.length}`);
console.log('');
const byPage = {};
for (const f of failures) byPage[f.page] = (byPage[f.page] ?? 0) + 1;
console.log('failures per page:', JSON.stringify(byPage));
console.log('');
for (const f of failures.slice(0, 10)) {
  console.log(`  p${f.page} [${f.mode}] ${f.expr}`);
  console.log(`       -> ${f.err}`);
}
if (failures.length > 10) console.log(`  ... and ${failures.length - 10} more`);
