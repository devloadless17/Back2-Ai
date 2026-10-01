import { unwrapSoftBreaks } from '@/lib/soft-wrap';

// Plain module, not beside MathText: a server page calls this, and a function
// exported from a 'use client' file cannot be called on the server — the
// summaries chapter page crashed on every request until it moved here.
/**
 * Which of the two stored bodies to show.
 *
 * `content_latex` is preferred because it is the same question with its
 * notation intact — EXCEPT when it is damaged, and 122 rows in this corpus are.
 * They carry U+FFFD, the replacement character, meaning bytes that could not be
 * decoded when the paper was read. Unlike the Adobe Symbol codepoints that
 * `repairSymbolFont` puts back, this damage is not recoverable: the original
 * bytes are gone, and a student is shown `f '(x) = –������–������` where the
 * derivative should be.
 *
 * 119 of those 122 have a clean `content_text` beside them. Preferring the
 * LaTeX unconditionally showed the broken copy to a student while the readable
 * one sat in the next column — so the rule is "prefer the LaTeX, unless it is
 * rubble".
 *
 * This is a display fallback, not a repair. The rows are still damaged and
 * re-extracting those papers is the actual fix; this stops a student meeting
 * the damage in the meantime.
 */
// Written as an escape, not as the character itself: a literal U+FFFD in
// source is exactly the thing that survives one bad encoding round-trip and
// silently stops matching.
const UNDECODABLE = /�/;

// A few multilingual ministry PDFs continue from the French exercise into the
// Arabic cover on the same extracted page. The full ministry heading is a safe
// boundary; an Arabic word quoted by the French text remains untouched.
const ARABIC_MINISTRY_COVER = /وزارة\s+التربية\s+والتعليم\s+العالي/u;

export function withoutAppendedArabicCover(text: string): string {
  const boundary = text.search(ARABIC_MINISTRY_COVER);
  return boundary < 0 ? text : text.slice(0, boundary).trimEnd();
}

export function bodyToRender(contentLatex: string | null | undefined, contentText: string): string {
  /*
   * `unwrapSoftBreaks` on the way out, whichever column won.
   *
   * The stored text carries a newline at every printed line-wrap, and
   * `remarkBreaks` below renders each one as a hard break — so a paragraph
   * arrives as a column of ragged fragments. It rejoins only the breaks that
   * cannot be deliberate, which leaves the numbered parts `remarkBreaks` exists
   * to protect exactly where they were.
   */
  if (!contentLatex) return unwrapSoftBreaks(withoutAppendedArabicCover(contentText));
  if (UNDECODABLE.test(contentLatex) && contentText && !UNDECODABLE.test(contentText)) {
    return unwrapSoftBreaks(withoutAppendedArabicCover(contentText));
  }
  return unwrapSoftBreaks(withoutAppendedArabicCover(contentLatex));
}
