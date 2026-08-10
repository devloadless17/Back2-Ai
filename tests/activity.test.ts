import { describe, expect, it } from 'vitest';

import { streakFrom, type ActivityDay } from '@/lib/queries/activity';

/** Builds a run of days ending today, oldest first, from a list of counts. */
function days(counts: number[]): ActivityDay[] {
  const today = new Date();
  const base = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());

  return counts.map((count, index) => ({
    date: new Date(base - (counts.length - 1 - index) * 86_400_000),
    count,
  }));
}

describe('streakFrom', () => {
  it('counts consecutive days ending today', () => {
    expect(streakFrom(days([0, 1, 3, 2, 5]))).toBe(4);
  });

  it('does not break the run just because today is still empty', () => {
    // 9am, nothing done yet. Yesterday and the two days before were worked.
    expect(streakFrom(days([1, 2, 3, 0]))).toBe(3);
  });

  it('breaks on any earlier empty day', () => {
    expect(streakFrom(days([5, 5, 0, 2, 1]))).toBe(2);
  });

  it('is zero when nothing has been done at all', () => {
    expect(streakFrom(days([0, 0, 0]))).toBe(0);
  });

  it('is zero for no data rather than throwing', () => {
    expect(streakFrom([])).toBe(0);
  });

  it('does not depend on the order it is given', () => {
    const ordered = days([1, 1, 1, 0]);
    const shuffled = [ordered[1]!, ordered[3]!, ordered[0]!, ordered[2]!];
    expect(streakFrom(shuffled)).toBe(3);
  });
});
