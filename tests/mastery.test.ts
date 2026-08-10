import { describe, expect, it } from 'vitest';

import {
  attemptCredit,
  computeMastery,
  MIN_ATTEMPTS_FOR_WEAKNESS,
  recencyWeight,
  weakestChapter,
} from '@/lib/scoring/mastery';

const NOW = new Date('2026-06-01T12:00:00.000Z');

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 86_400_000);
}

describe('attemptCredit', () => {
  it('is binary for right/wrong attempts', () => {
    expect(attemptCredit({ attemptedAt: NOW, isCorrect: true })).toBe(1);
    expect(attemptCredit({ attemptedAt: NOW, isCorrect: false })).toBe(0);
  });

  it('gives partial credit for barème-marked answers', () => {
    expect(attemptCredit({ attemptedAt: NOW, isCorrect: null, score: 8, maxScore: 10 })).toBe(0.8);
  });

  it('is NaN when an attempt is neither marked nor scored, so it can be filtered out', () => {
    expect(attemptCredit({ attemptedAt: NOW, isCorrect: null })).toBeNaN();
  });

  it('does not let a score above the maximum push credit past 1', () => {
    expect(attemptCredit({ attemptedAt: NOW, isCorrect: null, score: 12, maxScore: 10 })).toBe(1);
  });
});

describe('recencyWeight', () => {
  it('is 1 for an attempt made now', () => {
    expect(recencyWeight(NOW, NOW)).toBeCloseTo(1, 10);
  });

  it('decays with a 14-day half-life constant', () => {
    expect(recencyWeight(daysAgo(14), NOW)).toBeCloseTo(Math.exp(-1), 10);
  });

  it('does not exceed 1 for a future-dated attempt', () => {
    expect(recencyWeight(new Date(NOW.getTime() + 86_400_000), NOW)).toBe(1);
  });
});

describe('computeMastery', () => {
  it('returns zero with no attempts, and reports the count', () => {
    expect(computeMastery([], NOW)).toEqual({ masteryScore: 0, attemptsCount: 0 });
  });

  it('is 1 when everything was correct', () => {
    const result = computeMastery(
      [
        { attemptedAt: daysAgo(1), isCorrect: true },
        { attemptedAt: daysAgo(10), isCorrect: true },
      ],
      NOW,
    );
    expect(result.masteryScore).toBe(1);
  });

  it('weights recent attempts more heavily than old ones', () => {
    const improving = computeMastery(
      [
        { attemptedAt: daysAgo(60), isCorrect: false },
        { attemptedAt: daysAgo(1), isCorrect: true },
      ],
      NOW,
    );
    const declining = computeMastery(
      [
        { attemptedAt: daysAgo(60), isCorrect: true },
        { attemptedAt: daysAgo(1), isCorrect: false },
      ],
      NOW,
    );

    expect(improving.masteryScore).toBeGreaterThan(0.9);
    expect(declining.masteryScore).toBeLessThan(0.1);
  });

  it('weights harder questions more heavily', () => {
    const hardCorrect = computeMastery(
      [
        { attemptedAt: NOW, isCorrect: true, difficulty: 0.9 },
        { attemptedAt: NOW, isCorrect: false, difficulty: 0.1 },
      ],
      NOW,
    );
    expect(hardCorrect.masteryScore).toBeGreaterThan(0.5);
  });

  it('counts unscorable attempts towards the sample size but not the score', () => {
    const result = computeMastery(
      [
        { attemptedAt: NOW, isCorrect: true },
        { attemptedAt: NOW, isCorrect: null },
      ],
      NOW,
    );
    expect(result.masteryScore).toBe(1);
    expect(result.attemptsCount).toBe(2);
  });

  /*
   * Load-bearing for lib/queries/progress.ts, which reads stored mastery from
   * `chapter_mastery` rather than recomputing it on every page load. That is
   * only sound because waiting scales every recency weight by the same factor,
   * and a constant factor cancels in a weighted mean. If this ever fails,
   * stored mastery starts drifting while a student is inactive and the
   * dashboard quietly lies.
   */
  it('is invariant under elapsed time — a stored score does not drift', () => {
    const attempts = [
      { attemptedAt: daysAgo(1), isCorrect: true, difficulty: 0.8 },
      { attemptedAt: daysAgo(5), isCorrect: false, difficulty: 0.3 },
      { attemptedAt: daysAgo(20), isCorrect: true, difficulty: 0.5 },
    ];

    const atWriteTime = computeMastery(attempts, NOW);
    const threeWeeksLater = computeMastery(attempts, new Date(NOW.getTime() + 21 * 86_400_000));
    const threeMonthsLater = computeMastery(attempts, new Date(NOW.getTime() + 90 * 86_400_000));

    expect(threeWeeksLater.masteryScore).toBeCloseTo(atWriteTime.masteryScore, 6);
    expect(threeMonthsLater.masteryScore).toBeCloseTo(atWriteTime.masteryScore, 6);
  });

  it('ignores attempts beyond the recency horizon to within rounding', () => {
    const recent = [{ attemptedAt: daysAgo(1), isCorrect: true }];
    const withAncient = [...recent, { attemptedAt: daysAgo(150), isCorrect: false }];

    // 150 days out weighs exp(-150/14) ≈ 2e-5; bounding the query at 120 days
    // cannot move the stored 3-decimal score.
    expect(computeMastery(withAncient, NOW).masteryScore).toBeCloseTo(
      computeMastery(recent, NOW).masteryScore,
      3,
    );
  });

  it('never divides by zero when every question has difficulty 0', () => {
    const result = computeMastery(
      [{ attemptedAt: NOW, isCorrect: true, difficulty: 0 }],
      NOW,
    );
    expect(result.masteryScore).toBe(1);
    expect(Number.isFinite(result.masteryScore)).toBe(true);
  });
});

describe('weakestChapter', () => {
  it('returns null until a chapter clears the minimum sample size', () => {
    expect(
      weakestChapter([{ chapterId: 'a', masteryScore: 0.1, attemptsCount: MIN_ATTEMPTS_FOR_WEAKNESS - 1 }]),
    ).toBeNull();
  });

  it('ignores under-sampled chapters even when they look worse', () => {
    const result = weakestChapter([
      { chapterId: 'noisy', masteryScore: 0.0, attemptsCount: 1 },
      { chapterId: 'real', masteryScore: 0.4, attemptsCount: 10 },
    ]);
    expect(result?.chapterId).toBe('real');
  });

  it('picks the lowest mastery among eligible chapters', () => {
    const result = weakestChapter([
      { chapterId: 'a', masteryScore: 0.8, attemptsCount: 10 },
      { chapterId: 'b', masteryScore: 0.3, attemptsCount: 10 },
      { chapterId: 'c', masteryScore: 0.5, attemptsCount: 10 },
    ]);
    expect(result?.chapterId).toBe('b');
  });
});
