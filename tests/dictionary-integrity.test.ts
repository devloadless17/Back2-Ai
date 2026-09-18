import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Launch guards on the copy a student actually reads.
 *
 * Two things this catches, both of which were live in the English dictionary
 * on the eve of launch.
 *
 * ENCODING. `Taking you in…` had been written, read back as latin-1 and
 * re-encoded, so the ellipsis became three characters. It sat in the password
 * reset flow — one of the first screens a real student would meet. French and
 * Arabic were clean, and the French "â" in words like "bâtiment" is a single
 * legitimate codepoint, which is why the signatures below are pairs rather
 * than single letters.
 *
 * TRUTHFULNESS. Readiness is an estimate from marked work. It is not a
 * forecast of a Bac result, `docs/readiness-model.md` forbids saying otherwise,
 * and the English copy was promising a student that "a prediction will appear".
 */

const LOCALES = ['en', 'fr', 'ar'] as const;

const read = (locale: string) =>
  readFileSync(join(process.cwd(), 'src', 'lib', 'i18n', 'dictionaries', `${locale}.ts`), 'utf8');

/** UTF-8 read as latin-1: one character became two or three. */
const MOJIBAKE = [
  'Ã©', // é
  'Ã¨', // è
  'Ã ', // à
  'Ã¢', // â
  'Ã´', // ô
  'Ã§', // ç
  'Â°', // °
  'â', // the curly quotes, dashes and ellipsis
  'ï¿½',
  '�', // replacement character
  'Ø§', // Arabic alef
  'Ù', // Arabic meem
];

describe('dictionary encoding', () => {
  for (const locale of LOCALES) {
    it(`${locale} is free of mojibake`, () => {
      const text = read(locale);
      for (const signature of MOJIBAKE) {
        expect(
          text.includes(signature),
          `${locale}.ts contains ${JSON.stringify(signature)} — a character that was read as latin-1`,
        ).toBe(false);
      }
    });
  }

  it('still contains real accents and real Arabic, so the guard is not vacuous', () => {
    expect(read('fr')).toContain('é');
    expect(read('ar')).toMatch(/[؀-ۿ]/);
  });
});

describe('no student-facing copy forecasts a Bac result', () => {
  /*
   * Deliberately narrow. "Estimated from your marked work" is honest and must
   * keep working; "a prediction will appear" is not. So this matches the claim
   * rather than the stem, and each locale is checked in its own language.
   */
  const FORBIDDEN: Record<string, RegExp[]> = {
    en: [/a prediction will appear/i, /to predict readiness/i, /you will score/i, /on track to pass/i],
    fr: [/une prédiction/i, /vous obtiendrez/i],
    ar: [/سوف تحصل/],
  };

  for (const locale of LOCALES) {
    it(`${locale} makes no predictive claim`, () => {
      const text = read(locale);
      for (const pattern of FORBIDDEN[locale] ?? []) {
        expect(pattern.test(text), `${locale}.ts matches ${pattern}`).toBe(false);
      }
    });
  }

  it('keeps the honest estimate wording that replaced it', () => {
    // The guard must not be satisfiable by deleting the strings entirely.
    expect(read('en')).toContain('an estimate will appear');
    expect(read('en')).toContain('to estimate readiness');
  });
});
