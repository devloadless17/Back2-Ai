/**
 * Rejoins lines a PDF broke in the middle of a sentence.
 *
 * A question's stored text came from the paper's text layer, which carries a
 * newline at every printed line-wrap. `remarkBreaks` then renders each one as a
 * hard break, so a paragraph reaches the student as a column of ragged
 * fragments — "Some of this energy must" / "come from glucose, which is needed
 * to fuel the brain."
 *
 * WHY NOT JUST TURN OFF `remarkBreaks`. Because it is there for a reason that
 * still holds: without it a question's numbered parts — "1- Determine…",
 * "2- Deduce…" — collapse into one run-on paragraph with the numbers buried
 * mid-sentence. The newlines in the database are carrying two different things
 * at once, and the fix is to tell them apart rather than to honour or discard
 * both.
 *
 * SO IT JOINS ONLY WHERE THE BREAK CANNOT BE DELIBERATE: the line before it
 * ends mid-sentence. A line ending in `.`, `?`, `!`, `:` or `;` is left alone —
 * that break may be a real one, and a paper that prints one sentence per line
 * reads perfectly well that way. This is deliberately the timid half of the
 * problem; the ambiguous half is left as it is.
 *
 * WHAT IT WILL NOT TOUCH, each because joining there changes meaning rather
 * than presentation:
 *
 *   - a line starting a numbered or lettered part, or a bullet;
 *   - a Markdown table row, a heading, a blockquote, a horizontal rule;
 *   - anything inside a fenced block or a display-maths block, where a newline
 *     is content and `$$…$$` spans lines on purpose;
 *   - a blank line, which is a paragraph break and the one break Markdown has
 *     always honoured.
 *
 * It never deletes a character and never joins without a space, so no word is
 * created or destroyed. "store d" in the 2019 LH chemistry paper stays "store
 * d": that is an OCR defect in the text layer, not a line-join artefact, and
 * repairing it is the extractor's job.
 */

/** Opens a numbered or lettered part: `1-`, `2.`, `3)`, `a-`, `II.`, `1.2.` */
const LIST_OPENER = /^\s*(\d+(\.\d+)*\s*[-.)\]]|[a-zA-Z]\s*[-.)\]]|[IVX]+\s*[-.)\]]|[-*•▪])/;

/**
 * A line whose break is structural: table, heading, quote, rule, fence, or the
 * `$$` that opens a display-maths block.
 *
 * `$$` is in here because a test caught it: a sentence running into the line
 * above a formula joined the delimiter onto the prose, which moves `$$` off the
 * start of its line and stops it opening a block at all. The formula then
 * renders as literal dollars.
 */
const STRUCTURAL = /^\s*(\||#{1,6}\s|>|-{3,}|={3,}|```|~~~|\$\$)/;

/**
 * How long a line must be before its break counts as a wrap.
 *
 * A PDF breaks a line when it reaches the margin, so a SHORT line was never
 * wrapped — it ended where the author ended it. Without this, a title joins the
 * line under it: "Parkinson Disease" + "Document 1" became one line, because a
 * title carries no full stop and so looked mid-sentence.
 *
 * 55 characters is comfortably under the ~85 a wrapped line of this corpus runs
 * to, and comfortably over a title or a label.
 */
const WRAPPED_LINE_MIN = 55;

/** Ends a sentence, so the break after it may well be the author's. */
const SENTENCE_END = /[.!?:;。！？]["'”’)\]]?\s*$/;

/** Opens or closes a display-maths block, inside which newlines are content. */
const DISPLAY_MATH = /\$\$/g;

export function unwrapSoftBreaks(text: string): string {
  if (!text.includes('\n')) return text;

  const lines = text.split('\n');
  const out: string[] = [];
  let inFence = false;
  let inDisplayMath = false;

  for (const line of lines) {
    const fenceToggle = /^\s*(```|~~~)/.test(line);
    const mathDelimiters = (line.match(DISPLAY_MATH) ?? []).length;

    const previous = out[out.length - 1];
    const joinable =
      previous !== undefined &&
      !inFence &&
      !inDisplayMath &&
      !fenceToggle &&
      previous.trim().length >= WRAPPED_LINE_MIN &&
      line.trim() !== '' &&
      !SENTENCE_END.test(previous) &&
      !LIST_OPENER.test(line) &&
      !STRUCTURAL.test(line) &&
      !STRUCTURAL.test(previous);

    if (joinable) out[out.length - 1] = `${previous.replace(/\s+$/, '')} ${line.replace(/^\s+/, '')}`;
    else out.push(line);

    if (fenceToggle) inFence = !inFence;
    // An odd number of `$$` on a line opens or closes a display block.
    if (mathDelimiters % 2 === 1) inDisplayMath = !inDisplayMath;
  }

  return out.join('\n');
}
