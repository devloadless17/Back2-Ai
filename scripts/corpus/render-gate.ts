/**
 * Would the page show this Markdown badly? Run through the page's own
 * pipeline — remark-math, GFM, breaks, KaTeX — after the same delimiter and
 * font repair `MathText` applies. Shared by the loaders that write text a
 * student reads (load-display-text.ts, load-paper-parts.ts).
 */
import rehypeKatex from 'rehype-katex';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';

import { normalizeMathDelimiters } from '../../src/lib/math-delimiters';
import { repairSymbolFont } from '../../src/lib/symbol-font';

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
  let escaped = body.split(String.raw`\$`).length - 1;
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
    if (n.type === 'text' && !math && n.value) {
      // A dollar written escaped is money in prose, meant to show as itself.
      const dollars = n.value.split('$').length - 1;
      escaped -= dollars;
      if (LEAK.test(n.value.replaceAll('$', '')) || (dollars && escaped < 0)) {
        problem = `latex in prose: ${n.value.trim().slice(0, 60)}`;
        return;
      }
    }
    for (const c of n.children ?? []) walk(c, math);
  };
  walk(tree, false);
  if (problem) return problem;
  const expected = (markdown.match(/^\|(---\|)+$/gm) ?? []).length;
  if (tables !== expected) return `tables: expected ${expected}, rendered ${tables}`;
  return null;
}
