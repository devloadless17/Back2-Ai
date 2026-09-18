import { describe, expect, it } from 'vitest';

import { dirForLanguage, dirForText } from '@/lib/i18n/config';

/**
 * Which way a piece of CONTENT reads.
 *
 * The interface has one language and the content has three, mixing on one
 * screen, so this cannot be answered from the student's locale. These cases are
 * taken from real papers in the corpus, because the failure that prompted them
 * was a rule that looked obviously correct: `dir="auto"` takes the first strong
 * character and stops, and a Lebanese paper almost always opens with a number.
 */

describe('Arabic content', () => {
  it('reads right to left', () => {
    expect(dirForText('ما معنى الاستعارة وكيف أفرّق بينها وبين التشبيه؟')).toBe('rtl');
  });

  it('still reads right to left when the line opens with a question number', () => {
    // This is the case `dir="auto"` gets wrong: the first strong character is
    // the Latin "I", so the browser would set the whole exercise left to right.
    expect(dirForText('I- عرّف الاستعارة ثم بيّن الفرق بينها وبين التشبيه.')).toBe('rtl');
  });

  it('survives a Latin term quoted inside an Arabic question', () => {
    expect(dirForText('اشرح مفهوم the welfare state في النص السابق.')).toBe('rtl');
  });

  it('reads the real paper header right to left', () => {
    expect(
      dirForText('وزارة التربية والتعليم العالي\nالمديرية العامة للتربية\nدائرة الامتحانات'),
    ).toBe('rtl');
  });
});

describe('Latin content', () => {
  it('reads left to right', () => {
    expect(dirForText('Calculer la dérivée de f sur ]0 ; +∞[.')).toBe('ltr');
  });

  it('is unaffected by digits and notation', () => {
    expect(dirForText('$f(x) = x^2 - 2\\ln(x)$, 1) 2) 3)')).toBe('ltr');
  });

  it('treats an empty or missing body as left to right rather than throwing', () => {
    expect(dirForText('')).toBe('ltr');
    expect(dirForText(null)).toBe('ltr');
    expect(dirForText(undefined)).toBe('ltr');
  });

  it('does not flip on a stray Arabic word in an English question', () => {
    expect(dirForText('Explain what the term "الشورى" means in this passage about governance.')).toBe(
      'ltr',
    );
  });
});

describe('the subject language wins where it is known', () => {
  /*
   * A maths paper set in Arabic is mostly symbols, and counting characters
   * would call it Latin. That is why the reading surfaces pass the subject's
   * own language instead of relying on detection — this pins the difference so
   * nobody "simplifies" the two into one.
   */
  const arabicMathsPaper = 'f(x) = x² - 2ln(x) ; 1) 2) 3) ; احسب';

  it('detection alone would get an Arabic maths paper wrong', () => {
    expect(dirForText(arabicMathsPaper)).toBe('ltr');
  });

  it('the declared language gets it right', () => {
    expect(dirForLanguage('ar')).toBe('rtl');
  });

  it('every other language is left to right', () => {
    expect(dirForLanguage('fr')).toBe('ltr');
    expect(dirForLanguage('en')).toBe('ltr');
    expect(dirForLanguage(null)).toBe('ltr');
    expect(dirForLanguage(undefined)).toBe('ltr');
  });
});
