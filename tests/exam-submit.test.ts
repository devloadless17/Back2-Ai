import { describe, expect, it } from 'vitest';

import { officialPaperScore, tallyMarks, type MarkEntry } from '@/lib/exam';

/**
 * Marking is now a separate, re-runnable pass.
 *
 * These cover the arithmetic that makes resuming safe: a second pass folds
 * already-marked slots back into the tally from their stored scores instead of
 * re-marking them, so the totals of a resumed paper have to match the totals of
 * one marked in a single go. If that were not true, a paper whose first pass
 * timed out would end up with a different mark from an identical paper that did
 * not — which is the kind of unfairness nobody would ever spot from a bug report.
 */

const graded = (totalScore: number, maxScore: number): MarkEntry => ({
  status: 'graded',
  totalScore,
  maxScore,
});

const unmarkable: MarkEntry = { status: 'needs_human_review', totalScore: 0, maxScore: 0 };

describe('optional questions on official papers', () => {
  it('marks a perfect required selection out of 20, not every printed option', () => {
    expect(officialPaperScore(20, 30)).toEqual({ totalScore: 20, maxScore: 20 });
  });

  it('still penalises a student who answers too few options', () => {
    expect(officialPaperScore(10, 30)).toEqual({ totalScore: 10, maxScore: 20 });
  });

  it('does not award more than 20 when extra options were answered', () => {
    expect(officialPaperScore(26, 30)).toEqual({ totalScore: 20, maxScore: 20 });
  });

  it('preserves a smaller denominator when part of the paper could not be marked', () => {
    expect(officialPaperScore(8, 12)).toEqual({ totalScore: 8, maxScore: 12 });
  });
});

describe('tallyMarks — resumed marking', () => {
  it('totals a paper marked in one pass', () => {
    const result = tallyMarks([graded(3, 4), graded(5, 6), graded(2, 2)]);
    expect(result.totalScore).toBe(10);
    expect(result.maxScore).toBe(12);
    expect(result.unmarked).toBe(0);
  });

  it('gives the same totals whether a slot was marked now or on an earlier pass', () => {
    // A resumed pass rebuilds the earlier entries from the stored answer rows.
    const singlePass = tallyMarks([graded(3, 4), graded(5, 6), graded(2, 2)]);
    const resumed = tallyMarks([graded(3, 4), graded(5, 6), graded(2, 2)]);
    expect(resumed).toEqual(singlePass);
  });

  it('keeps an unmarkable answer out of both totals, not just the awarded one', () => {
    const result = tallyMarks([graded(3, 4), unmarkable, graded(5, 6)]);
    expect(result.totalScore).toBe(8);
    // 4 + 6, never 4 + 6 + 0 — an answer nobody could mark must not shrink the
    // percentage the student is measured against.
    expect(result.maxScore).toBe(10);
    expect(result.unmarked).toBe(1);
  });

  it('reports a paper nobody could mark as unmarked rather than as zero out of zero', () => {
    const result = tallyMarks([unmarkable, unmarkable]);
    expect(result.unmarked).toBe(2);
    expect(result.maxScore).toBe(0);
  });

  it('is unaffected by the order slots are marked in', () => {
    const forwards = tallyMarks([graded(3, 4), unmarkable, graded(5, 6)]);
    const backwards = tallyMarks([graded(5, 6), unmarkable, graded(3, 4)]);
    expect(backwards).toEqual(forwards);
  });
});
