import { describe, expect, it } from 'vitest';

import { computeReadiness } from '@/lib/scoring/readiness';
import { evidenceReading } from '@/lib/standing';

/**
 * The sentence a student reads above their mark.
 *
 * Readiness is `mastery x coverage`, so the same low figure is produced by two
 * completely different situations: someone weak across the whole programme, and
 * someone strong on a quarter of it. Those need opposite advice — more accuracy
 * versus more ground — and the score alone cannot tell them apart. This is the
 * layer that does, so it is worth pinning down.
 */

describe('reading mastery and coverage together', () => {
  it('calls a strong quarter of the programme narrow, not weak', () => {
    expect(evidenceReading(0.95, 0.25)).toBe('strongNarrow');
  });

  it('calls a weak sweep of the whole programme broad, not narrow', () => {
    expect(evidenceReading(0.3, 0.95)).toBe('weakBroad');
  });

  it('separates the two readings that produce a similar score', () => {
    // 0.5(0.95 x 0.25) = 0.119 and 0.5(0.3 x 0.4) = 0.06 — both look poor, and
    // the student is told two different things because two different things
    // are true.
    expect(evidenceReading(0.95, 0.25)).not.toBe(evidenceReading(0.3, 0.4));
  });

  it('says nothing has been practised rather than guessing at a level', () => {
    expect(evidenceReading(0, 0)).toBe('none');
  });

  it('does not call an untouched subject early-but-weak', () => {
    // Coverage of zero takes precedence: with no evidence there is no level to
    // describe, and `early` would imply work has begun.
    expect(evidenceReading(0, 0)).not.toBe('early');
  });
});

describe('the evidence the UI is given', () => {
  it('lets a perfect-but-narrow subject show a high strength and a low breadth', () => {
    const chapters = [
      ...Array.from({ length: 5 }, (_, i) => ({ chapterId: `a${i}`, masteryScore: 1, attemptsCount: 8 })),
      ...Array.from({ length: 15 }, (_, i) => ({ chapterId: `b${i}`, masteryScore: 0, attemptsCount: 0 })),
    ];
    const r = computeReadiness({ chapters, masteryFourWeeksAgo: null });

    // What the student sees: 20/20 on what they practised, 5 of 20 chapters.
    expect(r.mastery).toBeCloseTo(1, 3);
    expect(r.chaptersAttempted).toBe(5);
    expect(r.chaptersTotal).toBe(20);
    // And the overall mark stays honestly low.
    expect(r.score).toBeLessThan(0.5);
    expect(evidenceReading(r.mastery, r.coverage)).toBe('strongNarrow');
  });

  it('reports zero chapters attempted for a subject nobody has opened', () => {
    const r = computeReadiness({
      chapters: Array.from({ length: 12 }, (_, i) => ({
        chapterId: `c${i}`,
        masteryScore: 0,
        attemptsCount: 0,
      })),
      masteryFourWeeksAgo: null,
    });
    expect(r.chaptersAttempted).toBe(0);
    expect(r.reportable).toBe(false);
  });
});
