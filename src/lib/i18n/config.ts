/**
 * Locale configuration.
 *
 * Locale is a property of the *user*, not the URL: it is chosen at signup,
 * locked alongside track, and stored on `users.preferred_language`. That is why
 * there is no `[locale]` route segment — the exec plan's route map has none,
 * and adding one would create two URLs for every page for no benefit here.
 *
 * For signed-out pages (login/signup) the locale comes from a cookie, falling
 * back to Accept-Language and then DEFAULT_LOCALE.
 */

export const LOCALES = ['fr', 'en', 'ar'] as const;
export type Locale = (typeof LOCALES)[number];

export const LOCALE_COOKIE = 'bac2_locale';

export const LOCALE_LABELS: Record<Locale, string> = {
  fr: 'Français',
  en: 'English',
  ar: 'العربية',
};

export const RTL_LOCALES: readonly Locale[] = ['ar'];

export function dirFor(locale: Locale): 'ltr' | 'rtl' {
  return RTL_LOCALES.includes(locale) ? 'rtl' : 'ltr';
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/**
 * Picks the best supported locale from an Accept-Language header.
 * Deliberately simple: exact match, then primary subtag match.
 */
export function negotiateLocale(acceptLanguage: string | null, fallback: Locale): Locale {
  if (!acceptLanguage) return fallback;

  const ranked = acceptLanguage
    .split(',')
    .map((part) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = params.find((p) => p.trim().startsWith('q='));
      return { tag: tag.trim().toLowerCase(), q: q ? Number(q.split('=')[1]) || 0 : 1 };
    })
    .filter((entry) => entry.tag.length > 0)
    .sort((a, b) => b.q - a.q);

  for (const { tag } of ranked) {
    if (isLocale(tag)) return tag;
    const primary = tag.split('-')[0];
    if (isLocale(primary)) return primary;
  }

  return fallback;
}
