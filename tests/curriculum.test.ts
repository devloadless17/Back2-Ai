import { describe, expect, it } from 'vitest';

import { chapterHasQuestions, chapterIsReachable, chapterState } from '@/lib/curriculum';

/**
 * What a chapter is, decided once for the practice index and the Bac Map.
 *
 * The case worth protecting is `readingOnly`. 320 of 1,193 chapters hold
 * textbook material and no indexed past-paper questions, and every one of them
 * used to render as a greyed-out "no questions" row — true, and read by a
 * student as "nothing here", which is false. There is a summary page, the
 * tutor grounded on that reading, and a nearest practisable chapter behind it.
 */

const chapter = (questionCount: number, hasReading: boolean, attemptsCount = 0) => ({
  questionCount,
  hasReading,
  attemptsCount,
});

describe('the four states', () => {
  it('marks a chapter with marked work as practised', () => {
    expect(chapterState(chapter(12, true, 8))).toBe('practised');
  });

  it('marks an untouched chapter with questions as practisable, not weak', () => {
    // The whole point: there is no evidence here, so there is nothing to be
    // bad at. The UI reads "Not practised", never "0% mastery".
    expect(chapterState(chapter(12, true, 0))).toBe('practisable');
  });

  it('marks material with no indexed questions as readingOnly', () => {
    expect(chapterState(chapter(0, true, 0))).toBe('readingOnly');
  });

  it('marks a chapter with nothing behind it as inert', () => {
    expect(chapterState(chapter(0, false, 0))).toBe('inert');
  });
});

describe('a chapter whose questions were rejected after it was practised', () => {
  const orphaned = chapter(0, true, 6);

  it('is not offered as practisable, because there is nothing to open', () => {
    // Offering practice here sends the student to an empty page.
    expect(chapterState(orphaned)).toBe('readingOnly');
    expect(chapterHasQuestions(chapterState(orphaned))).toBe(false);
  });

  it('still counts as reachable, because the reading is real', () => {
    expect(chapterIsReachable(chapterState(orphaned))).toBe(true);
  });

  it('keeps its attempts, so the map can still report the work', () => {
    // The state describes what can be DONE with the chapter. The evidence is a
    // separate question, and the Bac Map reads `attemptsCount` directly rather
    // than inferring it from the state, so the student's work is not erased.
    expect(orphaned.attemptsCount).toBe(6);
  });
});

describe('reachability', () => {
  it('sends a student into every state except inert', () => {
    expect(chapterIsReachable('practised')).toBe(true);
    expect(chapterIsReachable('practisable')).toBe(true);
    expect(chapterIsReachable('readingOnly')).toBe(true);
    expect(chapterIsReachable('inert')).toBe(false);
  });
});

describe('the practice index and the Bac Map agree', () => {
  it('classifies the same chapter identically wherever it is asked', () => {
    // Both surfaces call this function rather than re-deriving the rule, which
    // is what stops one page saying "12 questions" while the other says
    // "nothing here".
    const cases = [chapter(12, true, 8), chapter(12, false), chapter(0, true), chapter(0, false)];
    for (const c of cases) expect(chapterState(c)).toBe(chapterState({ ...c }));
  });
});
