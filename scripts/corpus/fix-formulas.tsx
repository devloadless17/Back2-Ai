/**
 * Formulas KaTeX refuses, repaired only where a repair makes them draw.
 *
 *   npx tsx scripts/corpus/fix-formulas.tsx <questions.jsonl> <fixes.json>
 *
 * Each math span in a solution ($…$, $$…$$) that KaTeX refuses is tried with
 * three repairs, the first that draws is kept, and none is kept otherwise:
 *   - braces closed: "\mathrm{X^{\mathrm{h}} / \mathrm{Y}" (a group opened and
 *     never closed);
 *   - an array's column spec sized to its widest row: a variation table
 *     declared {c|ccccc} with seven cells a row;
 *   - a table body with no "\begin{array}": the opening put back.
 * A key row that is a label and a stray cell ("4 &") becomes "4 —".
 * Same guard as fix_key_rows.py: solutions a parts load writes are left.
 * Writes {id, column, before, after} for load-text-fixes.ts.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import katex from 'katex';

const draws = (tex: string, display: boolean) => {
  try {
    katex.renderToString(tex, { throwOnError: true, displayMode: display, strict: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

function balance(tex: string): string {
  let depth = 0;
  for (let i = 0; i < tex.length; i++) {
    if (tex[i] === '\\') { i++; continue; }
    if (tex[i] === '{') depth++;
    else if (tex[i] === '}') depth = Math.max(0, depth - 1);
  }
  return tex + '}'.repeat(depth);
}

function sizeArray(tex: string): string {
  return tex.replace(/\\begin\{array\}\{([^}]*)\}([\s\S]*?)\\end\{array\}/g, (all, spec: string, body: string) => {
    const widest = Math.max(...body.split(/\\\\/).map((r) => r.split('&').length));
    const have = spec.replace(/[^lcr]/g, '').length;
    if (widest <= have) return all;
    return `\\begin{array}{c|${'c'.repeat(widest - 1)}}${body}\\end{array}`;
  });
}

function openArray(tex: string): string {
  if (!/\\end\{array\}/.test(tex) || /\\begin\{array\}/.test(tex)) return tex;
  const widest = Math.max(...tex.split(/\\\\/).map((r) => r.split('&').length));
  return `\\begin{array}{c|${'c'.repeat(widest - 1)}}${tex}`;
}

function repair(text: string): string {
  let out = text.replace(/\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g, (all, d?: string, i?: string) => {
    const display = d !== undefined;
    const tex = (d ?? i)!;
    if (draws(tex, display)) return all;
    for (const fix of [balance, sizeArray, openArray, (t: string) => balance(sizeArray(t))]) {
      const t = fix(tex);
      if (t !== tex && draws(t, display)) return display ? `$$${t}$$` : `$${t}$`;
    }
    return all;
  });
  // A multi-line $$ block the page's Markdown reads only with its fences on
  // lines of their own ("4a $$\begin{array}…\end{array}$$").
  const pieces = out.split('$$');
  if (pieces.length % 2 === 1) {
    for (let k = 1; k < pieces.length; k += 2) {
      const body = pieces[k]!;
      if (!body.includes('\n') || !draws(body.trim(), true)) continue;
      if (!/(^|\n)[ \t]*$/.test(pieces[k - 1]!)) pieces[k - 1] = pieces[k - 1]!.replace(/[ \t]*$/, '\n');
      if (!/^[ \t]*(\n|$)/.test(pieces[k + 1]!)) pieces[k + 1] = '\n' + pieces[k + 1]!.replace(/^[ \t]*/, '');
      pieces[k] = `\n${body.trim()}\n`;
    }
    out = pieces.join('$$');
  }
  out = out.replace(/^(0[.,]\d+) &[ 	]*$/gm, '($1 pt)'); // a lone mark
  out = out.replace(/^(\d+(?:\.\d+)*[a-z]?) &[ 	]*$/gm, '$1 —');
  return out;
}

const [input, outPath] = process.argv.slice(2);
const loaded = new Set<string>();
const fixes: object[] = [];
for (const line of readFileSync(input!, 'utf8').split('\n').filter(Boolean)) {
  const r = JSON.parse(line);
  const pp = r.paper_parts;
  if (pp && (pp.parts ?? []).some((p: { answer?: string; answerImage?: string }) => p.answer || p.answerImage)) continue;
  if (loaded.has(r.official_solution)) continue;
  for (const column of ['official_solution', 'official_solution_latex']) {
    const before = r[column];
    if (!before) continue;
    const after = repair(before);
    if (after !== before) fixes.push({ id: r.id, title: r.title, column, before, after });
  }
}
writeFileSync(outPath!, JSON.stringify(fixes, null, 1));
console.log(`${fixes.length} column fix(es) -> ${outPath}`);
