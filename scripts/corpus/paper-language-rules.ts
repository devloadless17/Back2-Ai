/**
 * Reading what language a paper is printed in, from the paper.
 *
 * Split out of `refile-wrong-edition-exams.ts` so it can be tested without a
 * database, the same way `visual-backfill-rules.ts` is. This module is pure and
 * runs nothing on import.
 *
 * NEITHER `exam_cycles.language` NOR `subjects.language` IS EVIDENCE HERE. Both
 * are the columns being repaired: 44 cycles disagree with their own subject,
 * and for most of them it is the cycle stamp that is wrong, not the subject.
 */
export type Language = 'en' | 'fr' | 'ar';

// ---------------------------------------------------------------------------
// Reading the script
// ---------------------------------------------------------------------------
const ARABIC = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/g;
const LETTER = /\p{Letter}/gu;
const FRENCH_WORDS = /\b(le|la|les|des|une|dans|vous|soit|est|sont|pour|avec|du|au|aux|que|qui|par|sur)\b/gi;
const ENGLISH_WORDS = /\b(the|and|of|to|is|are|that|which|with|in|for|by|on|this|be)\b/gi;

/**
 * How lopsided the count has to be, and how much of it there has to be.
 *
 * COUNTED, NOT MERELY PRESENT — and that is the whole of it. "French words and
 * no English ones" reads an English chemistry paper that says "la" once, in a
 * citation, as unreadable; measured across these 61 questions the split is
 * nowhere near close. A real paper is 95-100% one language, a stray word is one
 * occurrence against a hundred, and the handful that land in the middle are
 * there for a reason worth seeing rather than voting on.
 *
 * MIN_EVIDENCE stops a correction sheet of nothing but numbers, or a title line
 * over an Arabic letterhead, deciding where a paper goes on one word.
 */
const CLEAR = 0.9;
const MIN_EVIDENCE = 5;

/**
 * Arabic enough to be an Arabic paper.
 *
 * 0.85, not the 0.60 the other scripts use. Those look at questions inside a
 * cycle already known to be Arabic; this looks at papers that carry an Arabic
 * letterhead over a Latin exercise, and 0.60 calls those Arabic.
 */
const MOSTLY_ARABIC = 0.85;

/**
 * Enough Arabic to be a printing of the paper rather than a word quoted in one.
 *
 * Paired with `MIN_EVIDENCE` of Latin prose, this is what "two printings in one
 * row" looks like when the second printing is Arabic instead of French.
 */
const SOME_ARABIC = 0.2;

export function arabicShare(text: string): number {
  const letters = text.match(LETTER)?.length ?? 0;
  if (letters === 0) return 0;
  return (text.match(ARABIC)?.length ?? 0) / letters;
}

/**
 * The language a question is written in.
 *
 * `'mixed'` is not a failure to decide. It means the row holds both printings
 * of the paper at once — a real and separate defect, found here rather than
 * looked for — and such a row cannot be filed under either edition. It is
 * reported, and nothing is moved.
 */
export function languageOfText(text: string): Language | 'mixed' | null {
  const arabic = arabicShare(text);
  const english = (text.match(ENGLISH_WORDS) ?? []).length;
  const french = (text.match(FRENCH_WORDS) ?? []).length;
  const latin = english + french;

  /*
   * A real Arabic block AND real Latin prose in one row: the 2015 LS maths
   * paper is the English exercise followed by the Arabic one, 88% Arabic
   * letters over 37 English function words. Read by share alone it is an Arabic
   * maths paper, and there is no Arabic maths course to send it to — which is
   * a true statement about a false premise.
   */
  if (arabic > SOME_ARABIC && latin >= MIN_EVIDENCE) return 'mixed';
  if (arabic > MOSTLY_ARABIC) return 'ar';
  if (latin < MIN_EVIDENCE) return null;

  const share = english / latin;
  if (share >= CLEAR) return 'en';
  if (share <= 1 - CLEAR) return 'fr';
  return 'mixed';
}
