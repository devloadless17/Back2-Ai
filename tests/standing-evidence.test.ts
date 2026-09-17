import { describe, expect, it } from 'vitest';

import { computeReadiness } from '@/lib/scoring/readiness';
import { coverage } from '@/lib/standing';

/**
 * What a student is shown above their mark.
 *
 * Readiness is `mastery x coverage`, so the same low figure is produced by two
 * completely different situations: someone weak across the whole programme, and
 * someone strong on a quarter of it. Those need opposite advice — more accuracy
 * versus more ground.
 *
 * An earlier version of this file tested a function that sorted the pair into
 * "strong but narrow", "broad but weak" and so on. It was deleted. Those
 * categories rested on cutoffs at 0.65 and 0.60 that were invented while
 * writing the UI and correspond to nothing in the product or in any data we
 * hold. The figures themselves separate the two cases without anyone having to
 * claim where "strong" begins, and that is what these tests pin down.
 */

const chapters = (spec: [score: number, attempts: number][]) =>
  spec.map(([masteryScore, attemptsCount], i) => ({
    chapterId: `c${i}`,
    masteryScore,
    attemptsCount,
  }));

describe('the figures separate the two cases a single score cannot', () => {
  const narrow = computeReadiness({
    chapters: chapters([
      ...(Array.from({ length: 5 }, () => [1, 8]) as [number, number][]),
      ...(Array.from({ length: 15 }, () => [0, 0]) as [number, number][]),
    ]),
    masteryFourWeeksAgo: null,
  });

  const broad = computeReadiness({
    chapters: chapters(Array.from({ length: 20 }, () => [0.25, 8]) as [number, number][]),
    masteryFourWeeksAgo: null,
  });

  it('gives the narrow student a high mastery and a low practised share', () => {
    expect(narrow.mastery).toBeCloseTo(1, 3);
    expect(narrow.coverage).toBeCloseTo(0.25, 3);
    expect(narrow.chaptersAttempted).toBe(5);
    expect(narrow.chaptersTotal).toBe(20);
  });

  it('gives the broad student the opposite pair', () => {
    expect(broad.mastery).toBeCloseTo(0.25, 3);
    expect(broad.coverage).toBeCloseTo(1, 3);
  });

  it('tells them apart on the numbers alone, with no label in between', () => {
    // Both are in trouble, and the overall mark says so for both. What the
    // student needs to know is WHICH half is short, and the two figures say it.
    expect(narrow.mastery).toBeGreaterThan(broad.mastery);
    expect(narrow.coverage).toBeLessThan(broad.coverage);
  });

  it('reports zero chapters attempted for a subject nobody has opened', () => {
    const untouched = computeReadiness({
      chapters: chapters(Array.from({ length: 12 }, () => [0, 0]) as [number, number][]),
      masteryFourWeeksAgo: null,
    });
    expect(untouched.chaptersAttempted).toBe(0);
    expect(untouched.reportable).toBe(false);
    // Untouched is not weak. The UI must have something other than a zero
    // mastery to render, and this is it.
    expect(untouched.chaptersTotal).toBe(12);
  });
});

describe('there is one definition of coverage', () => {
  /*
   * Progress used to carry two percentages, both called some form of
   * "coverage". One was chapters attempted over chapters in the programme; the
   * other divided by "chapters that hold questions", which is a fact about our
   * corpus that moves when ingestion runs. They disagreed, and the second one
   * disagreed with the readiness model as well.
   */
  it('divides by the chapters in the programme, as the readiness model does', () => {
    const r = computeReadiness({
      chapters: chapters([
        [1, 8],
        [1, 8],
        [0, 0],
        [0, 0],
      ]),
      masteryFourWeeksAgo: null,
    });
    const shown = coverage(r.chaptersAttempted, r.chaptersTotal);

    expect(shown.practised).toBe(2);
    expect(shown.available).toBe(4);
    expect(shown.ratio).toBeCloseTo(r.coverage, 6);
  });

  it('reads zero, never complete, when there are no chapters at all', () => {
    expect(coverage(0, 0).ratio).toBe(0);
  });

  it('cannot report more practised than exist', () => {
    expect(coverage(9, 4).practised).toBe(4);
    expect(coverage(9, 4).ratio).toBe(1);
  });
});
