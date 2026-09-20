/**
 * Put LaTeX delimiters into the only two forms the renderer understands.
 *
 * `remark-math` knows `$…$` and `$$…$$` and nothing else. Models write
 * `\[ … \]` and `\( … \)` anyway — they are the standard LaTeX forms, the
 * system prompt asking for dollars is a request rather than a constraint, and
 * a model deriving eleven parts of a physics problem will reach for `\[` on
 * the one it cares most about.
 *
 * The failure is not local. An unrecognised `\[` is left as text, and every
 * `$` after it pairs up one step out of phase, so a correctly-written answer
 * renders beautifully to that point and then collapses into source — headings,
 * rules and all:
 *
 *     = \left(\frac{1}{C\omega}-L\omega\right)^2,$$ we get: \[ \boxed{ I_m= …
 *
 * DONE AT RENDER, like `repairSymbolFont` beside it and for the same reasons.
 * The stored text stays exactly as the model or the paper produced it, every
 * message already in the database is fixed by the next page load, and a mistake
 * here is corrected by editing one function rather than by a migration that
 * cannot be undone.
 */

/**
 * `\[ … \]` → `$$ … $$`, on its own lines.
 *
 * The negative lookbehind matters. `\\[` is a LaTeX line break with optional
 * spacing — `\\[2pt]` inside a matrix or an aligned block — and rewriting its
 * bracket would break the array it belongs to. Only a single backslash before
 * the bracket opens display math.
 */
const DISPLAY_OPEN = /(?<!\\)\\\[/g;
const DISPLAY_CLOSE = /(?<!\\)\\\]/g;

/** `\( … \)` → `$ … $`. Nothing else in LaTeX spells an escaped parenthesis. */
const INLINE_OPEN = /(?<!\\)\\\(/g;
const INLINE_CLOSE = /(?<!\\)\\\)/g;

/**
 * A `$$…$$` span with prose beside it on the same line.
 *
 * `remark-math` parses `$$` as DISPLAY math, which is a block: it wants the
 * delimiters alone on their lines. Written mid-sentence — "Since $$x = 1,$$ we
 * get…" — it is not a block, so it is not display math, and the dollars are
 * left in the text where the student reads them.
 *
 * Such a span is inline maths that was over-punctuated, so it becomes inline
 * maths. The alternative — promoting it to a real block — would break the
 * sentence it sits inside in half.
 */
const INLINE_DISPLAY = /(?<=\S[ \t]*)\$\$([^$\n]+?)\$\$|\$\$([^$\n]+?)\$\$(?=[ \t]*\S)/g;

export function normalizeMathDelimiters(text: string): string {
  if (!text) return text;

  let out = text;

  // FUNCTION REPLACEMENTS, NOT STRINGS, and that is not a style choice.
  //
  // In a replacement STRING, `$$` is the escape for a literal dollar — so
  // `.replace(open, '\n\n$$\n')` inserts ONE dollar and quietly turns every
  // display block into a broken inline one. A function replacement is handed
  // its value verbatim, with no substitution pass.
  //
  // Order matters: the bracket forms become dollars first, so the
  // inline-display rule below sees every `$$`, including the ones just made.
  out = out.replace(DISPLAY_OPEN, () => '\n\n$$\n').replace(DISPLAY_CLOSE, () => '\n$$\n\n');
  out = out.replace(INLINE_OPEN, () => '$').replace(INLINE_CLOSE, () => '$');

  out = out.replace(INLINE_DISPLAY, (_match, a: string | undefined, b: string | undefined) => {
    const body = (a ?? b ?? '').trim();
    return `$${body}$`;
  });

  return out;
}
