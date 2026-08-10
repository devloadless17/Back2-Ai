/**
 * Countries offered at signup.
 *
 * The product is grounded in one national curriculum at a time — every question,
 * barème and chapter in the database belongs to the Lebanese programme. So the
 * country field is not decoration: selecting a country the corpus does not cover
 * would produce an account with nothing to study.
 *
 * Rather than hide the field until a second country exists, the unavailable ones
 * are listed and disabled. A Jordanian student who opens the form learns that
 * they are not forgotten and that the answer is "not yet", which is the true
 * answer; an empty dropdown with one entry reads as a bug.
 *
 * Opening a country is then a two-line change here plus the corpus behind it.
 */

export const AVAILABLE_COUNTRIES = ['LB'] as const;

/** Listed on the form, disabled, in the order they are planned. */
export const PLANNED_COUNTRIES = ['SY', 'JO', 'PS', 'IQ', 'EG', 'AE', 'SA', 'QA', 'KW', 'FR'] as const;

export type CountryCode = (typeof AVAILABLE_COUNTRIES)[number];

export const DEFAULT_COUNTRY: CountryCode = 'LB';

export function isAvailableCountry(code: string): code is CountryCode {
  return (AVAILABLE_COUNTRIES as readonly string[]).includes(code);
}

/**
 * Fallback names, used when `Intl.DisplayNames` is unavailable or has no entry
 * for the locale. English rather than a code: "LB" in a dropdown is not a name.
 */
const FALLBACK_NAMES: Record<string, string> = {
  LB: 'Lebanon',
  SY: 'Syria',
  JO: 'Jordan',
  PS: 'Palestine',
  IQ: 'Iraq',
  EG: 'Egypt',
  AE: 'United Arab Emirates',
  SA: 'Saudi Arabia',
  QA: 'Qatar',
  KW: 'Kuwait',
  FR: 'France',
};

/**
 * The country's name in the reader's language.
 *
 * Uses the platform's own region names so that the Arabic and French forms are
 * the ones a native reader expects, rather than three hand-maintained lists that
 * drift. Wrapped in a try/catch because `Intl.DisplayNames` throws on unknown
 * locales rather than falling back.
 */
export function countryName(locale: string, code: string): string {
  try {
    const display = new Intl.DisplayNames([locale], { type: 'region' });
    return display.of(code) ?? FALLBACK_NAMES[code] ?? code;
  } catch {
    return FALLBACK_NAMES[code] ?? code;
  }
}

export type CountryOption = { code: string; name: string; available: boolean };

/** Every country the form shows: available first, then planned, each named. */
export function countryOptions(locale: string): CountryOption[] {
  return [
    ...AVAILABLE_COUNTRIES.map((code) => ({ code, name: countryName(locale, code), available: true })),
    ...PLANNED_COUNTRIES.map((code) => ({ code, name: countryName(locale, code), available: false })),
  ];
}
