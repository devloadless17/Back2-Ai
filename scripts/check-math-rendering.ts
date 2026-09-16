import katex from 'katex';

import { db } from '@/lib/db';
import { repairSymbolFont } from '@/lib/symbol-font';

/**
 * Does the mathematics in this corpus actually render?
 *
 *   npm run check:math-rendering
 *   npm run check:math-rendering -- --show 20
 *
 * `rehype-katex` is configured and the stylesheet is loaded, which says the
 * PIPELINE is right and nothing at all about the CONTENT. KaTeX implements a
 * large subset of LaTeX, not all of it, and this corpus was not authored by
 * hand — it came out of OCR and out of models, either of which can emit a macro
 * KaTeX has never heard of or a brace that never closes.
 *
 * A formula KaTeX cannot parse does not throw in the browser. `rehype-katex`
 * renders it in red, inline, in the middle of the question — so a student sees
 * the raw source of a formula where the formula should be. That is invisible
 * from the server and invisible in any test that does not actually parse.
 *
 * So this parses every `$…$` and `$$…$$` span in the questions and passages the
 * students read, with the same settings the page uses, and reports what breaks.
 * Costs nothing: no model, no embedding, no network.
 */

const SHOW = (() => {
  const i = process.argv.indexOf('--show');
  return i >= 0 ? Number(process.argv[i + 1]) : 8;
})();

/** Every maths span in a body, display and inline. */
function spans(text: string): string[] {
  const found: string[] = [];
  // Display first, so its delimiters are consumed before the inline pass.
  const display = text.replace(/\$\$([\s\S]+?)\$\$/g, (_m, body: string) => {
    found.push(body);
    return ' ';
  });
  /*
   * Newlines are ALLOWED inside inline maths.
   *
   * The first version excluded them — `[^$\n]` — and split every formula that
   * wrapped a line into two halves, reporting `\frac{2` and `}{56}` as two
   * broken spans. 748 of 1,158 bodies wrap a formula that way, so nearly every
   * "failure" was this regex rather than the corpus. The parser on the page
   * does not split them, so neither may this.
   */
  const inline = display.matchAll(/(?<!\\)\$([^$]+?)(?<!\\)\$/g);
  for (const match of inline) found.push(match[1]!);
  return found;
}

async function main() {
  const rows = await db.$queryRaw<{ kind: string; subject: string; body: string }[]>`
    SELECT 'question' AS kind, s.name AS subject, q.content_latex AS body
      FROM questions q
      JOIN chapters c ON c.id = q.chapter_id
      JOIN subjects s ON s.id = c.subject_id
     WHERE q.verified_status <> 'rejected'
       AND q.content_latex IS NOT NULL AND q.content_latex LIKE '%$%'

    UNION ALL

    SELECT 'passage', s.name, cc.content_latex
      FROM content_chunks cc
      JOIN chapter_content_chunks x ON x.chunk_id = cc.id
      JOIN chapters c ON c.id = x.chapter_id
      JOIN subjects s ON s.id = c.subject_id
     WHERE cc.content_latex IS NOT NULL AND cc.content_latex LIKE '%$%'`;

  let total = 0;
  let broken = 0;
  const bySubject = new Map<string, { total: number; broken: number }>();
  const examples: { subject: string; span: string; error: string }[] = [];

  // Through the same repair MathText applies before rendering, so this
  // measures what a student is actually shown rather than what is stored.
  const RAW = process.argv.includes('--raw');

  for (const row of rows) {
    for (const span of spans(RAW ? row.body : repairSymbolFont(row.body))) {
      total += 1;
      const tally = bySubject.get(row.subject) ?? { total: 0, broken: 0 };
      tally.total += 1;

      try {
        // `throwOnError` so a failure is counted rather than silently rendered
        // in red, which is what the browser does and what hides this.
        katex.renderToString(span, { throwOnError: true, displayMode: false });
      } catch (err) {
        broken += 1;
        tally.broken += 1;
        if (examples.length < SHOW) {
          examples.push({
            subject: row.subject,
            span: span.replace(/\s+/g, ' ').slice(0, 90),
            error: String(err).replace(/^ParseError: /, '').replace(/\s+/g, ' ').slice(0, 110),
          });
        }
      }
      bySubject.set(row.subject, tally);
    }
  }

  console.log(`\n  ${total} maths spans parsed with the page's own renderer\n`);
  console.log(
    `  ${broken} fail (${total === 0 ? 0 : ((100 * broken) / total).toFixed(1)}%) — ` +
      'each one shows a student raw LaTeX in red where a formula should be\n',
  );

  const ranked = [...bySubject.entries()]
    .filter(([, v]) => v.broken > 0)
    .sort((a, b) => b[1].broken - a[1].broken);

  if (ranked.length > 0) {
    console.log('  ' + 'subject'.padEnd(26) + 'spans'.padStart(7) + 'broken'.padStart(8));
    for (const [subject, v] of ranked.slice(0, 12)) {
      console.log(
        '  ' + subject.padEnd(26) + String(v.total).padStart(7) +
          `${v.broken} (${Math.round((100 * v.broken) / v.total)}%)`.padStart(12),
      );
    }
  }

  if (examples.length > 0) {
    console.log('\n  what is failing:\n');
    for (const e of examples) {
      console.log(`    ${e.subject}`);
      console.log(`      ${e.span}`);
      console.log(`      → ${e.error}\n`);
    }
  }

  await db.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
