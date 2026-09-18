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

/**
 * The direction a piece of CONTENT reads in, which is not the interface's.
 *
 * This product's central fact: a student picks one interface language and then
 * sits Arabic history, French maths and English biology off one timetable. So
 * the page can be `ltr` while the paper on it is Arabic, and an Arabic paper
 * rendered left-to-right puts its numbering, its brackets and its full stops on
 * the wrong side of every line.
 *
 * WHY NOT `dir="auto"`. The browser's own rule takes the FIRST strong character
 * and stops. Lebanese papers open with "I-", "1)" or a formula more often than
 * not, so `auto` reads an entire Arabic exercise as left-to-right on the
 * strength of its question number. Counting is what survives that.
 *
 * Latin letters are counted rather than "not Arabic" because digits, LaTeX and
 * punctuation are directionally neutral and dominate a maths paper in any
 * language — a page of equations with six Arabic words in it is still Arabic.
 */
const ARABIC_LETTER = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/gu;
const LATIN_LETTER = /[A-Za-zÀ-ɏ]/gu;

export function dirForText(text: string | null | undefined): 'ltr' | 'rtl' {
  if (!text) return 'ltr';
  const arabic = text.match(ARABIC_LETTER)?.length ?? 0;
  if (arabic === 0) return 'ltr';
  const latin = text.match(LATIN_LETTER)?.length ?? 0;
  return arabic > latin ? 'rtl' : 'ltr';
}

/** The content direction for a subject whose language is known. */
export function dirForLanguage(language: string | null | undefined): 'ltr' | 'rtl' {
  return language === 'ar' ? 'rtl' : 'ltr';
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
