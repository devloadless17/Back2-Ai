import { describe, expect, it } from 'vitest';

import {
  computeReadiness,
  READINESS_MODEL_VERSION,
  READINESS_WEIGHTS,
  MIN_ATTEMPTS_FOR_READINESS,
  type ChapterMasterySnapshot,
} from '@/lib/scoring/readiness';

/**
 * Readiness v2 — mastery and coverage as separate ideas.
 *
 * v1 reported one term it called "mastery" that was the mean over EVERY chapter
 * in the subject, so an untouched chapter entered as a zero. A student who had
 * answered five chapters perfectly out of twenty read 0.25, and coverage was
 * then added again beside it — breadth counted twice, depth mislabelled.
 *
 * The central claim of v2 is that this was already `mastery x coverage`, and
 * that stating it that way changes nothing about the score. The first test
 * proves that, because every other guarantee depends on it.
 */

const chapters = (spec: [score: number, attempts: number][]): ChapterMasterySnapshot[] =>
  spec.map(([masteryScore, attemptsCount], i) => ({
    chapterId: `c${i}`,
    masteryScore,
    attemptsCount,
  }));

/** The v1 formula, reconstructed, to prove v2 did not move the scale. */
function v1Score(spec: [number, number][], covered: number, trend = 0.5): number {
  const meanOverAll = spec.reduce((sum, [s]) => sum + s, 0) / spec.length;
  return (
    READINESS_WEIGHTS.mastery * meanOverAll +
    READINESS_WEIGHTS.coverage * (covered / spec.length) +
    READINESS_WEIGHTS.trend * trend
  );
}

describe('v2 is an algebraic restatement, not a recalibration', () => {
  it('produces exactly the v1 score, so old and new snapshots stay comparable', () => {
    // Five chapters attempted of twenty; enough attempts each to count as covered.
    const spec: [number, number][] = [
      ...(Array.from({ length: 5 }, () => [1, 8]) as [number, number][]),
      ...(Array.from({ length: 15 }, () => [0, 0]) as [number, number][]),
    ];
    const result = computeReadiness({ chapters: chapters(spec), masteryFourWeeksAgo: null });
    expect(result.score).toBeCloseTo(v1Score(spec, 5), 3);
  });

  it('keeps masteryComponent equal to mastery x coverage', () => {
    const result = computeReadiness({
      chapters: chapters([[1, 8], [1, 8], [0, 0], [0, 0]]),
      masteryFourWeeksAgo: null,
    });
    expect(result.masteryComponent).toBeCloseTo(result.mastery * result.coverage, 3);
  });

  it('stamps the model version so a snapshot says which formula made it', () => {
    const result = computeReadiness({ chapters: chapters([[1, 8]]), masteryFourWeeksAgo: null });
    expect(result.modelVersion).toBe(READINESS_MODEL_VERSION);
    expect(READINESS_MODEL_VERSION).toBe(2);
  });
});

describe('mastery and coverage now mean different things', () => {
  it('high mastery, low coverage — strong on what was attempted', () => {
    const result = computeReadiness({
      chapters: chapters([
        [1, 8], [1, 8], [1, 8], [1, 8], [1, 8],
        ...(Array.from({ length: 15 }, () => [0, 0]) as [number, number][]),
      ]),
      masteryFourWeeksAgo: null,
    });
    // The whole point: this reads 1.0, not 0.25.
    expect(result.mastery).toBeCloseTo(1, 3);
    expect(result.coverage).toBeCloseTo(0.25, 3);
    expect(result.chaptersAttempted).toBe(5);
    expect(result.chaptersTotal).toBe(20);
  });

  it('low mastery, high coverage — broad but weak', () => {
    const result = computeReadiness({
      chapters: chapters(Array.from({ length: 20 }, () => [0.3, 8]) as [number, number][]),
      masteryFourWeeksAgo: null,
    });
    expect(result.mastery).toBeCloseTo(0.3, 3);
    expect(result.coverage).toBeCloseTo(1, 3);
  });

  it('does not let high mastery on a sliver of the programme look exam ready', () => {
    // Two chapters of twenty, both perfect. Coverage must hold the score down.
    const result = computeReadiness({
      chapters: chapters([
        [1, 8], [1, 8],
        ...(Array.from({ length: 18 }, () => [0, 0]) as [number, number][]),
      ]),
      masteryFourWeeksAgo: null,
    });
    expect(result.mastery).toBeCloseTo(1, 3);
    // 0.5(1 x 0.1) + 0.3(0.1) + 0.2(0.5) = 0.18
    expect(result.score).toBeLessThan(0.25);
  });
});

describe('an account with no evidence', () => {
  it('scores zero rather than inheriting the neutral trend', () => {
    /*
     * v1 gave an empty account 0.1 — the trend term's neutral 0.5 at weight
     * 0.2. `reportable` hid it, but hiding a wrong number is not the same as
     * it being right, and any caller reading `score` directly would have
     * printed a mark for a student who had done nothing.
     */
    const result = computeReadiness({
      chapters: chapters(Array.from({ length: 12 }, () => [0, 0]) as [number, number][]),
      masteryFourWeeksAgo: null,
    });
    expect(result.score).toBe(0);
    expect(result.trendComponent).toBe(0);
    expect(result.mastery).toBe(0);
    expect(result.coverage).toBe(0);
  });

  it('is not reportable', () => {
    const result = computeReadiness({ chapters: chapters([[0, 0]]), masteryFourWeeksAgo: null });
    expect(result.reportable).toBe(false);
  });

  it('survives a subject with no chapters at all', () => {
    const result = computeReadiness({ chapters: [], masteryFourWeeksAgo: null });
    expect(result.score).toBe(0);
    expect(result.reportable).toBe(false);
    expect(result.chaptersTotal).toBe(0);
  });
});

describe('the reporting threshold, unchanged from v1', () => {
  it('withholds below ten attempts', () => {
    const result = computeReadiness({
      chapters: chapters([[0.8, MIN_ATTEMPTS_FOR_READINESS - 1]]),
      masteryFourWeeksAgo: null,
    });
    expect(result.totalAttempts).toBe(9);
    expect(result.reportable).toBe(false);
  });

  it('reports at exactly ten', () => {
    const result = computeReadiness({
      chapters: chapters([[0.8, MIN_ATTEMPTS_FOR_READINESS]]),
      masteryFourWeeksAgo: null,
    });
    expect(result.totalAttempts).toBe(10);
    expect(result.reportable).toBe(true);
  });
});

describe('trend still needs real history', () => {
  it('reads flat with none, rather than as a decline', () => {
    const result = computeReadiness({
      chapters: chapters([[0.6, 12]]),
      masteryFourWeeksAgo: null,
    });
    expect(result.trend).toBe('flat');
  });

  it('reads up only against a genuinely lower past mean', () => {
    const result = computeReadiness({
      chapters: chapters([[0.8, 12], [0.8, 12]]),
      // v1's mean-over-all, which is what the stored history holds.
      masteryFourWeeksAgo: 0.4,
    });
    expect(result.trend).toBe('up');
  });
});
