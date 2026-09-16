import { describe, expect, it } from 'vitest';

import { examFrequencyOf } from '@/components/practice/exam-frequency';

/**
 * What the exam-frequency badge tells a student to do with their Sunday.
 *
 * Getting this wrong does not throw — it quietly points revision at the wrong
 * chapter, which is the most expensive kind of wrong this product can be. The
 * year is pinned in every case so the tests do not change meaning in January.
 */

const NOW = 2026;

describe('a chapter the examiners keep setting', () => {
  it('is core when it appears in most of the recent window', () => {
    const f = examFrequencyOf([2025, 2024, 2023, 2021, 2020, 2019], NOW)!;
    expect(f.tone).toBe('core');
    expect(f.recent).toBe(6);
    expect(f.last).toBe(2025);
  });

  it('is regular on three recent appearances', () => {
    expect(examFrequencyOf([2025, 2023, 2020], NOW)!.tone).toBe('regular');
  });

  it('is occasional on one or two', () => {
    expect(examFrequencyOf([2024, 2022], NOW)!.tone).toBe('occasional');
    expect(examFrequencyOf([2024], NOW)!.tone).toBe('occasional');
  });
});

describe('the trap this exists to flag', () => {
  /*
   * A chapter set every year until the syllabus moved looks important by every
   * other measure on the page — many questions, plenty of material — and a
   * student can lose a weekend to a topic the examiners have abandoned.
   */
  it('calls a long-abandoned chapter dormant however many times it was set', () => {
    const f = examFrequencyOf([2014, 2013, 2012, 2011, 2010, 2009, 2008, 2007], NOW)!;
    expect(f.tone).toBe('dormant');
    expect(f.total).toBe(8);
    expect(f.recent).toBe(0);
    expect(f.last).toBe(2014);
  });

  it('does not let a large total outrank recency', () => {
    const abandoned = examFrequencyOf([2015, 2014, 2013, 2012, 2011, 2010], NOW)!;
    const current = examFrequencyOf([2025], NOW)!;
    expect(abandoned.tone).toBe('dormant');
    expect(current.tone).toBe('occasional');
    // Fewer appearances, but it is the one still being set.
    expect(current.total).toBeLessThan(abandoned.total);
  });
});

describe('edges', () => {
  it('returns null when the chapter has never been set, so nothing renders', () => {
    // Distinct from "set long ago": there is no claim to make at all.
    expect(examFrequencyOf([], NOW)).toBeNull();
  });

  it('counts the window exclusively, so the boundary year is not recent', () => {
    // Window is the last 8 years: 2018 is exactly on the cutoff for 2026.
    expect(examFrequencyOf([2018], NOW)!.tone).toBe('dormant');
    expect(examFrequencyOf([2019], NOW)!.tone).toBe('occasional');
  });

  it('reads the most recent year off the front, as the query orders it', () => {
    expect(examFrequencyOf([2024, 2020, 2011], NOW)!.last).toBe(2024);
  });
});
