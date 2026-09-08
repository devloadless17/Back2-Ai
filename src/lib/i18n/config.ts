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

/**
 * Supported locales, English first.
 *
 * The order is the order they are offered in — on the signup form and in the
 * admin's language selector — so the first entry is the one a student sees
 * preselected. It carries no other meaning; validation and storage treat the
 * three as equals.
 */
export const LOCALES = ['en', 'fr', 'ar'] as const;

/**
 * The languages a student can sit the Baccalaureate in.
 *
 * Not the same list as LOCALES, and the difference is the whole point. The
 * interface speaks three languages; the exam is sat in two. A Lebanese
 * candidate takes their sciences in French or in English and their humanities
 * in Arabic either way — there is no all-Arabic programme, which is exactly what
 * `subjectLanguagesFor` says: 'en' and 'fr' each return themselves plus 'ar',
 * while 'ar' returns only itself. So a student who chose Arabic here was given
 * the Arabic humanities and no mathematics, physics, chemistry or biology at
 * all, and the choice is locked at signup, so nothing would have corrected it.
 *
 * Arabic remains a full interface language. A student reading their French
 * chemistry through Arabic menus loses nothing.
 */
export const STUDY_LANGUAGES = ['en', 'fr'] as const;
export type StudyLanguage = (typeof STUDY_LANGUAGES)[number];

export function isStudyLanguage(value: unknown): value is StudyLanguage {
  return typeof value === 'string' && (STUDY_LANGUAGES as readonly string[]).includes(value);
}
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
