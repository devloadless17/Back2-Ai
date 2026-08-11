import { describe, expect, it } from 'vitest';

import {
  bandForMark,
  coverage,
  markOutOf20,
  monthlyEffort,
  overallMark,
  PASS_MARK,
} from '@/lib/standing';

describe('markOutOf20', () => {
  it('re-expresses readiness in the exam’s own unit', () => {
    expect(markOutOf20(0)).toBe(0);
    expect(markOutOf20(0.5)).toBe(10);
    expect(markOutOf20(1)).toBe(20);
  });

  it('keeps one decimal — a second would imply precision it does not have', () => {
    expect(markOutOf20(0.6712)).toBe(13.4);
  });

  it('clamps rather than producing an impossible mark', () => {
    expect(markOutOf20(1.4)).toBe(20);
    expect(markOutOf20(-2)).toBe(0);
    expect(markOutOf20(Number.NaN)).toBe(0);
  });
});

describe('bandForMark', () => {
  it('breaks at the Lebanese pass mark', () => {
    expect(bandForMark(PASS_MARK - 0.1)).toBe('failing');
    expect(bandForMark(PASS_MARK)).toBe('passing');
  });

  it('moves up through the bands', () => {
    expect(bandForMark(11.9)).toBe('passing');
    expect(bandForMark(12)).toBe('good');
    expect(bandForMark(14.9)).toBe('good');
    expect(bandForMark(15)).toBe('strong');
  });
});

describe('overallMark', () => {
  it('is the plain mean while coefficients are not encoded', () => {
    expect(overallMark([14.1, 11.8, 13.9, 13.2])).toBe(13.3);
  });

  it('is null with nothing reportable rather than zero', () => {
    // Zero would read as "you are failing everything", which is a different
    // and much worse claim than "we cannot say yet".
    expect(overallMark([])).toBeNull();
  });

  it('rounds to one decimal', () => {
    expect(overallMark([10, 11])).toBe(10.5);
  });
});

describe('coverage', () => {
  it('measures against what can actually be practised', () => {
    const c = coverage(118, 190);
    expect(c.ratio).toBeCloseTo(0.621, 3);
    expect(c.practised).toBe(118);
  });

  it('never exceeds what is available', () => {
    expect(coverage(50, 10).practised).toBe(10);
    expect(coverage(50, 10).ratio).toBe(1);
  });

  it('reads as zero covered when nothing is available, not as complete', () => {
    const c = coverage(0, 0);
    expect(c.ratio).toBe(0);
  });
});

describe('monthlyEffort', () => {
  const now = new Date('2026-08-11T12:00:00Z'); // August has 31 days

  it('counts distinct days in the current month', () => {
    const dates = [
      new Date('2026-08-01T18:00:00Z'),
      new Date('2026-08-01T21:00:00Z'), // same day, counted once
      new Date('2026-08-05T18:00:00Z'),
      new Date('2026-08-09T18:00:00Z'),
    ];
    const effort = monthlyEffort(dates, now);

    expect(effort.daysWorked).toBe(3);
    expect(effort.daysElapsed).toBe(11);
    expect(effort.daysInMonth).toBe(31);
  });

  it('ignores other months', () => {
    expect(monthlyEffort([new Date('2026-07-30T18:00:00Z')], now).daysWorked).toBe(0);
  });

  it('is measured against days so far, not the whole month', () => {
    // Eleven days in, eleven days worked, is a full ratio — not 11/31.
    const dates = Array.from({ length: 11 }, (_, i) =>
      new Date(Date.UTC(2026, 7, i + 1, 18)),
    );
    expect(monthlyEffort(dates, now).ratio).toBe(1);
  });

  it('is zero, not NaN, for a student with no activity', () => {
    expect(monthlyEffort([], now).ratio).toBe(0);
  });
});
