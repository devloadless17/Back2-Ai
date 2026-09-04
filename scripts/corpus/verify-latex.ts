import katex from 'katex';

import { db } from '../../src/lib/db';

/**
 * Renders every stored formula and takes out the ones that do not compile.
 *
 *   npm run corpus:verify-latex -- --dry
 *   npm run corpus:verify-latex
 *
 * `fraction-bars.py` reconstructs a fraction from the geometry of the page, and
 * geometry does not know what a formula is. It reads the operands either side of
 * a rule, and when the page put something unexpected there — a stray glyph, a
 * table header, half of a term that wrapped — the result is `$\frac{a}{b}$` that
 * KaTeX refuses.
 *
 * A refused formula is not a smaller fault than the flattening it replaced. It
 * is a larger one: the student sees a raw backslash and braces where a fraction
 * should be, and nothing on the page says the text was ever different. Flat text
 * at least reads as text.
 *
 * So every emitted fraction is compiled here, and any that throws is rewritten
 * as `(a)/(b)` — still not the printed layout, but plain, readable, and honest
 * about what is known. The surrounding text is untouched.
 *
 * This runs after extraction rather than inside it because KaTeX is the thing
 * that will actually render these, and the only check worth trusting is the one
 * the renderer itself performs.
 */
const FRACTION = /\$(\\frac\{[^{}]*\}\{[^{}]*\})\$/g;

function parseArgs(argv: string[]): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const token of argv) if (token.startsWith('--')) out[token.slice(2)] = true;
  return out;
}

function compiles(formula: string): boolean {
  try {
    katex.renderToString(formula, { throwOnError: true });
    return true;
  } catch {
    return false;
  }
}

/** `\frac{a}{b}` as plain text, for a formula KaTeX will not take. */
function flatten(formula: string): string {
  const m = /^\\frac\{([^{}]*)\}\{([^{}]*)\}$/.exec(formula);
  if (!m) return formula;
  const [, num, den] = m;
  return `(${(num ?? '').trim()})/(${(den ?? '').trim()})`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const rows = await db.$queryRaw<{ id: string; content_latex: string }[]>`
    SELECT id, content_latex FROM questions
     WHERE content_latex IS NOT NULL AND content_latex LIKE '%frac%'`;

  console.log(`  rows carrying a fraction: ${rows.length}`);

  let checked = 0;
  let broken = 0;
  let rowsFixed = 0;
  const examples: string[] = [];

  for (const row of rows) {
    let changed = false;
    const next = row.content_latex.replace(FRACTION, (whole, formula: string) => {
      checked += 1;
      if (compiles(formula)) return whole;
      broken += 1;
      changed = true;
      if (examples.length < 6) examples.push(formula.slice(0, 60));
      return flatten(formula);
    });

    if (changed && !args.dry) {
      await db.$executeRaw`
        UPDATE questions SET content_latex = ${next}, embedding = NULL WHERE id = ${row.id}::uuid`;
    }
    if (changed) rowsFixed += 1;
  }

  console.log(`  fractions checked   ${checked}`);
  console.log(`  would not compile   ${broken}`);
  console.log(`  rows rewritten      ${rowsFixed}`);
  if (examples.length > 0) {
    console.log('  examples of what was taken out:');
    for (const e of examples) console.log(`    ${e}`);
  }
  if (args.dry) console.log('\n  --dry: nothing written.');

  await db.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
