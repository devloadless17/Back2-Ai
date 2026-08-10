import { describe, expect, it } from 'vitest';

import {
  DEFAULT_EASINESS,
  MIN_EASINESS,
  gradeToQuality,
  newCard,
  reviewFlashcard,
} from '@/lib/scoring/sm2';

const TODAY = new Date('2026-06-01T00:00:00.000Z');

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

describe('reviewFlashcard', () => {
  it('resets the interval on a failure but keeps the card in the deck', () => {
    const result = reviewFlashcard(
      { easiness: 2.5, intervalDays: 30, repetitions: 5 },
      gradeToQuality('again'),
      TODAY,
    );

    expect(result.repetitions).toBe(0);
    expect(result.intervalDays).toBe(1);
    expect(result.lapsed).toBe(true);
    expect(daysBetween(TODAY, result.dueDate)).toBe(1);
  });

  it('lowers easiness on a failure — repeated lapses make a card harder', () => {
    const first = reviewFlashcard(
      { easiness: DEFAULT_EASINESS, intervalDays: 1, repetitions: 0 },
      gradeToQuality('again'),
      TODAY,
    );
    expect(first.easiness).toBeLessThan(DEFAULT_EASINESS);

    const second = reviewFlashcard(
      { easiness: first.easiness, intervalDays: 1, repetitions: 0 },
      gradeToQuality('again'),
      TODAY,
    );
    expect(second.easiness).toBeLessThan(first.easiness);
  });

  it('never lets easiness fall below the floor', () => {
    let easiness = DEFAULT_EASINESS;
    for (let i = 0; i < 50; i += 1) {
      easiness = reviewFlashcard({ easiness, intervalDays: 1, repetitions: 0 }, 0, TODAY).easiness;
    }
    expect(easiness).toBe(MIN_EASINESS);
  });

  it('follows the 1 → 6 → interval×easiness progression', () => {
    const first = reviewFlashcard({ easiness: 2.5, intervalDays: 0, repetitions: 0 }, 4, TODAY);
    expect(first.intervalDays).toBe(1);

    const second = reviewFlashcard(
      { easiness: first.easiness, intervalDays: first.intervalDays, repetitions: first.repetitions },
      4,
      TODAY,
    );
    expect(second.intervalDays).toBe(6);

    const third = reviewFlashcard(
      { easiness: 2.5, intervalDays: 6, repetitions: 2 },
      4,
      TODAY,
    );
    expect(third.intervalDays).toBe(15); // round(6 × 2.5)
  });

  it('computes the new interval from the PREVIOUS easiness, not the updated one', () => {
    // quality 5 raises easiness to 2.6; the interval must still use 2.5.
    const result = reviewFlashcard({ easiness: 2.5, intervalDays: 10, repetitions: 3 }, 5, TODAY);
    expect(result.intervalDays).toBe(25);
    expect(result.easiness).toBeGreaterThan(2.5);
  });

  it('treats "hard" as a pass, not a lapse', () => {
    const result = reviewFlashcard({ easiness: 2.5, intervalDays: 6, repetitions: 2 }, gradeToQuality('hard'), TODAY);
    expect(result.lapsed).toBe(false);
    expect(result.repetitions).toBe(3);
  });

  it('starts a new card due today', () => {
    const card = newCard(TODAY);
    expect(daysBetween(TODAY, card.dueDate)).toBe(0);
    expect(card.easiness).toBe(DEFAULT_EASINESS);
  });
});
