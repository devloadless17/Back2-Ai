/**
 * Cleaning the reading passages the exam papers were read into.
 *
 * Kept apart from `clean-exam-passages.ts` so it can be tested without a
 * database, the same way `book-exercise-guards.ts` is.
 *
 * WHAT IS WRONG WITH THEM. A French comprehension passage arrives carrying three
 * things that were never part of the text: the ministry's Arabic cover line
 * ("المدّة : ساعتان" — the duration), the line-number gutter the paper prints
 * down the margin, which the reader returns as a column of bare numbers stacked
 * before the prose, and long runs of blank lines where the layout used to be.
 * 177 of 210 passages on the non-Arabic subjects carry at least one.
 *
 * EACH RULE REFUSES RATHER THAN GUESSES. A bare number is only a gutter mark
 * when it belongs to a rising run of them, so a passage that simply mentions a
 * number on its own line keeps it. Arabic is only stripped from the head of a
 * passage whose body is Latin, so an Arabic passage is never touched. And if a
 * rule would empty a passage, the original is kept: a damaged passage is worth
 * more to a student than none.
 *
 * WHAT IS DELIBERATELY NOT FIXED. The same reader also breaks words apart —
 * "a ncien", "questi on", "do nné" — and glues footnote markers to the words
 * they follow ("occultée1"). Repairing those needs a dictionary and would be
 * guessing at the author's text; a wrong repair is invisible to a reader, which
 * makes it worse than the visible damage.
 */

const ARABIC = /[؀-ۿ]/;
const LATIN = /[A-Za-zÀ-ÿ]/;

/** A line holding nothing but a number: what the margin gutter looks like. */
const BARE_NUMBER = /^[\s ]*(\d{1,3})[\s ]*$/;

/** Three rising marks is already a gutter; two could be a coincidence. */
const MIN_GUTTER_RUN = 3;

/** Beyond this the passage is Arabic, not a Latin passage with an Arabic header. */
const ARABIC_HEAD_LINES = 6;

/**
 * The indices of lines that belong to the printed line-number gutter.
 *
 * The gutter counts upward down the margin — 1, 5, 10, 15 — and the reader
 * returns it as bare numbers, usually stacked together before the prose. Only
 * numbers that rise in a run of at least three are taken, so a passage that
 * prints a lone number on its own line keeps it.
 */
export function gutterLines(text: string): Set<number> {
  const marks: Array<{ value: number; index: number }> = [];
  text.split(/\r?\n/).forEach((line, index) => {
    const m = BARE_NUMBER.exec(line);
    if (m) marks.push({ value: Number(m[1]), index });
  });

  const out = new Set<number>();
  let run: typeof marks = [];
  const flush = () => {
    if (run.length >= MIN_GUTTER_RUN) for (const m of run) out.add(m.index);
    run = [];
  };
  for (const mark of marks) {
    if (run.length && mark.value <= run[run.length - 1]!.value) flush();
    run.push(mark);
  }
  flush();
  return out;
}

/**
 * How many leading lines are the ministry's Arabic cover text.
 *
 * Only the head is considered, and only when what follows is Latin: that is
 * what makes this a header on someone else's passage rather than the passage
 * itself. An Arabic passage returns 0 and is left exactly as it was.
 */
export function arabicHeaderLines(text: string): number {
  const lines = text.split(/\r?\n/);
  const body = lines.join('\n');
  if (!LATIN.test(body)) return 0; // an Arabic passage, not an Arabic header

  let taken = 0;
  for (let i = 0; i < Math.min(lines.length, ARABIC_HEAD_LINES); i++) {
    const line = lines[i]!;
    if (!line.trim()) {
      continue; // blank lines between header lines do not end the header
    }
    if (ARABIC.test(line) && !LATIN.test(line)) {
      taken = i + 1;
      continue;
    }
    break; // the first real line of the passage
  }
  return taken;
}

/** No more than one blank line in a row, and no trailing spaces. */
export function collapseBlankRuns(text: string): string {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/[ \t ]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * The passage as it should have been read, or the original if cleaning it would
 * leave nothing behind.
 */
export function cleanPassage(text: string): string {
  if (!text.trim()) return text;

  const header = arabicHeaderLines(text);
  const gutter = gutterLines(text);
  const kept = text
    .split(/\r?\n/)
    .filter((_, i) => i >= header && !gutter.has(i))
    .join('\n');

  const cleaned = collapseBlankRuns(kept);
  // A passage with no letters left is not a passage. Keep what we had.
  return LATIN.test(cleaned) || ARABIC.test(cleaned) ? cleaned : text;
}
