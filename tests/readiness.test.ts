import { describe, expect, it } from 'vitest';

import { MIN_ATTEMPTS_FOR_READINESS, computeReadiness } from '@/lib/scoring/readiness';

function chapters(count: number, mastery: number, attempts: number) {
  return Array.from({ length: count }, (_, i) => ({
    chapterId: `c${i}`,
    masteryScore: mastery,
    attemptsCount: attempts,
  }));
}

describe('computeReadiness', () => {
  it('is not reportable below the minimum evidence threshold', () => {
    const result = computeReadiness({
      chapters: chapters(4, 1, 1),
      masteryFourWeeksAgo: null,
    });
    expect(result.totalAttempts).toBeLessThan(MIN_ATTEMPTS_FOR_READINESS);
    expect(result.reportable).toBe(false);
  });

  it('counts untouched chapters as a real gap, not as missing data', () => {
    const withGaps = computeReadiness({
      chapters: [
        { chapterId: 'a', masteryScore: 1, attemptsCount: 20 },
        { chapterId: 'b', masteryScore: 0, attemptsCount: 0 },
      ],
      masteryFourWeeksAgo: null,
    });

    const complete = computeReadiness({
      chapters: [
        { chapterId: 'a', masteryScore: 1, attemptsCount: 20 },
        { chapterId: 'b', masteryScore: 1, attemptsCount: 20 },
      ],
      masteryFourWeeksAgo: null,
    });

    expect(withGaps.score).toBeLessThan(complete.score);
    expect(withGaps.coverageComponent).toBe(0.5);
  });

  it('reads a missing history as flat rather than as decline', () => {
    const result = computeReadiness({
      chapters: chapters(3, 0.6, 10),
      masteryFourWeeksAgo: null,
    });
    expect(result.trend).toBe('flat');
    expect(result.trendComponent).toBe(0.5);
  });

  it('detects improvement and decline against the four-week baseline', () => {
    const improving = computeReadiness({
      chapters: chapters(3, 0.8, 10),
      masteryFourWeeksAgo: 0.5,
    });
    const declining = computeReadiness({
      chapters: chapters(3, 0.4, 10),
      masteryFourWeeksAgo: 0.7,
    });

    expect(improving.trend).toBe('up');
    expect(declining.trend).toBe('down');
    expect(improving.trendComponent).toBeGreaterThan(declining.trendComponent);
  });

  it('weights the three components 50 / 30 / 20', () => {
    const result = computeReadiness({
      chapters: chapters(2, 1, 20),
      masteryFourWeeksAgo: 1,
    });
    // mastery 1 × 0.5 + coverage 1 × 0.3 + trend 0.5 × 0.2
    expect(result.score).toBeCloseTo(0.9, 5);
  });

  it('is bounded to 0..1 in every component', () => {
    const result = computeReadiness({
      chapters: chapters(3, 5, 100),
      masteryFourWeeksAgo: -10,
    });
    expect(result.score).toBeLessThanOrEqual(1);
    expect(result.masteryComponent).toBeLessThanOrEqual(1);
    expect(result.trendComponent).toBeLessThanOrEqual(1);
  });

  it('handles a subject with no chapters without dividing by zero', () => {
    const result = computeReadiness({ chapters: [], masteryFourWeeksAgo: null });
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.reportable).toBe(false);
  });
});
