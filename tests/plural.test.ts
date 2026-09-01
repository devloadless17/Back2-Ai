import { describe, expect, it } from 'vitest';

import { formatPlural, plural } from '../src/lib/i18n/format';
import { en } from '../src/lib/i18n/dictionaries/en';
import { fr } from '../src/lib/i18n/dictionaries/fr';
import { ar } from '../src/lib/i18n/dictionaries/ar';

/**
 * The exam countdown is the most-read number in this product, and it was
 * ungrammatical in all three languages during the week it matters most.
 */
describe('the exam countdown', () => {
  it('does not say "1 days" in English', () => {
    expect(formatPlural('en', 1, en.dashboard.heroExamIn)).toBe('exam tomorrow');
    expect(formatPlural('en', 5, en.dashboard.heroExamIn)).toBe('exam in 5 days');
  });

  it('does not say "1 jours" in French', () => {
    expect(formatPlural('fr', 1, fr.dashboard.heroExamIn)).toBe('examen demain');
    expect(formatPlural('fr', 5, fr.dashboard.heroExamIn)).toBe('examen dans 5 jours');
  });

  it('uses the right Arabic form for one, two, few and many', () => {
    // The string that shipped used `يومًا` — the 11-99 form — for every count.
    expect(formatPlural('ar', 1, ar.dashboard.heroExamIn)).toBe('الامتحان غدًا');
    expect(formatPlural('ar', 2, ar.dashboard.heroExamIn)).toBe('الامتحان بعد يومين');
    expect(formatPlural('ar', 5, ar.dashboard.heroExamIn)).toBe('الامتحان بعد 5 أيام');
    expect(formatPlural('ar', 15, ar.dashboard.heroExamIn)).toBe('الامتحان بعد 15 يومًا');
  });

  it('never leaves a raw placeholder on screen', () => {
    for (const [locale, dict] of [['en', en], ['fr', fr], ['ar', ar]] as const) {
      for (const n of [0, 1, 2, 3, 11, 100]) {
        const out = formatPlural(locale, n, dict.dashboard.heroExamIn);
        expect(out).not.toMatch(/\{count\}/);
        expect(out.trim().length).toBeGreaterThan(0);
      }
    }
  });
});

describe('the badge on the day panel', () => {
  it('agrees with its count and keeps the exam label', () => {
    expect(formatPlural('en', 1, en.dashboard.daysToExamLabel, { label: 'Maths' })).toBe('1 day to Maths');
    expect(formatPlural('en', 9, en.dashboard.daysToExamLabel, { label: 'Maths' })).toBe('9 days to Maths');
    expect(formatPlural('ar', 2, ar.dashboard.daysToExamLabel, { label: 'رياضيات' })).toContain('يومان');
    expect(formatPlural('fr', 1, fr.dashboard.daysToExamLabel, { label: 'Maths' })).toBe('1 jour avant Maths');
  });
});

describe('plural()', () => {
  it('falls back to other for a category a language does not define', () => {
    // English has no dual. Asking for 2 must not return undefined.
    expect(plural('en', 2, { other: '{count} days' })).toBe('{count} days');
  });
});
