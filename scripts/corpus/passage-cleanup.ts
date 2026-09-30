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

/*
 * THE ARABIC BLOCK ALONE IS NOT ENOUGH. These papers were read into Arabic
 * PRESENTATION FORMS — ﻣﺴﺎﺑﻘﺔ, ﺳﻨﺔ, ﻟﻠﺘﺮﺑﯿﺔ live at U+FB50 and above, not at
 * U+0600 — so a range check on the base block called half a cover line "not
 * Arabic" and left it in. The script property covers every form of the script,
 * which is the property actually meant here.
 */
const ARABIC = /\p{Script=Arabic}/u;
const LATIN = /[A-Za-zÀ-ÿ]/;
/* Bidi marks carry no text and must not make a line look like content. */
const BIDI = /[‎‏‪-‮⁦-⁩﻿]/g;

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
 * The lines that are the ministry's Arabic cover text rather than the paper.
 *
 * WHY EVERY LINE AND NOT JUST THE TOP. The header was first seen above a French
 * passage, so this only stripped a leading run — and the same furniture turned
 * out to sit in the MIDDLE of the question text, between the passage's
 * footnotes and "I- Questions (13 pts)", because the reader met the cover page
 * partway through. 260 questions carry it there.
 *
 * WHAT MAKES IT SAFE. Only a line with Arabic and no Latin letters is taken, and
 * only from a text whose body is Latin. Every one of the 926 distinct lines this
 * matches is cover furniture — the ministry, the examinations department, the
 * certificate, the branch, the session, the duration, the candidate's name and
 * number, the marking-criteria heading, and Arabic-Indic page numbers. A French
 * or English paper has no Arabic prose of its own to lose.
 *
 * AN ARABIC PAPER RETURNS NOTHING AND IS NEVER TOUCHED. Its whole text is
 * Arabic, so `LATIN.test` fails and the rule declines. The callers filter by
 * subject language as well: one guard would have been enough, and two are
 * cheap, because getting this wrong deletes an Arabic question outright.
 */
export function arabicFurnitureLines(text: string): Set<number> {
  const lines = text.split(/\r?\n/);
  const out = new Set<number>();
  if (!LATIN.test(lines.join('\n'))) return out; // an Arabic paper, not a header

  lines.forEach((line, i) => {
    const bare = line.replace(BIDI, '');
    if (ARABIC.test(bare) && !LATIN.test(bare)) out.add(i);
  });
  return out;
}

/** How many leading lines are the ministry's Arabic cover text. */
export function arabicHeaderLines(text: string): number {
  const furniture = arabicFurnitureLines(text);
  const lines = text.split(/\r?\n/);
  let taken = 0;
  for (let i = 0; i < Math.min(lines.length, ARABIC_HEAD_LINES); i++) {
    if (!lines[i]!.trim()) continue; // blank lines between header lines do not end it
    if (!furniture.has(i)) break; // the first real line of the passage
    taken = i + 1;
  }
  return taken;
}

/**
 * A line holding only punctuation — what a footnote marker leaves behind.
 *
 * A superscript sits on its own baseline, so the reader ends the line at it and
 * the sentence's full stop begins the next one: "…amoindrissante1" then a line
 * containing just ".". Putting it back where it belongs costs nothing and is
 * the difference between prose and debris.
 */
const ORPHAN_PUNCTUATION = /^[\s ]*[.,;:!?»)\]…]+[\s ]*$/;

/** No more than one blank line in a row, and no trailing spaces. */
export function collapseBlankRuns(text: string): string {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/[ \t ]+$/, ''));

  const joined: string[] = [];
  for (const line of lines) {
    const previous = joined[joined.length - 1];
    if (ORPHAN_PUNCTUATION.test(line) && previous && previous.trim()) {
      joined[joined.length - 1] = previous + line.trim();
      continue;
    }
    joined.push(line);
  }

  return joined
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

  const furniture = arabicFurnitureLines(text);
  const gutter = gutterLines(text);
  const kept = text
    .split(/\r?\n/)
    .filter((_, i) => !furniture.has(i) && !gutter.has(i))
    .join('\n');

  const cleaned = collapseBlankRuns(kept);
  // A passage with no letters left is not a passage. Keep what we had.
  return LATIN.test(cleaned) || ARABIC.test(cleaned) ? cleaned : text;
}

/**
 * The question's own text, with the cover page taken out of it.
 *
 * The gutter is NOT removed here. It belongs to a printed passage, and a bare
 * number on its own line inside a question is far more likely to be part of the
 * question — a mark, an answer, a row of a table — than a margin mark.
 */
export function cleanQuestionText(text: string): string {
  if (!text.trim()) return text;

  const furniture = arabicFurnitureLines(text);
  if (!furniture.size) return text;

  const kept = text
    .split(/\r?\n/)
    .filter((_, i) => !furniture.has(i))
    .join('\n');
  const cleaned = collapseBlankRuns(kept);
  return LATIN.test(cleaned) ? cleaned : text;
}
