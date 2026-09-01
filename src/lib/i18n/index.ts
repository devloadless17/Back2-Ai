import 'server-only';

import { cookies, headers } from 'next/headers';
import { cache } from 'react';

import { getSession } from '@/lib/auth/session';
import { env } from '@/lib/env';

import { LOCALE_COOKIE, isLocale, negotiateLocale, type Locale } from './config';
import { en, type Dictionary } from './dictionaries/en';
import { fr } from './dictionaries/fr';
import { ar } from './dictionaries/ar';

const DICTIONARIES: Record<Locale, Dictionary> = { en, fr, ar };

export function getDictionary(locale: Locale): Dictionary {
  return DICTIONARIES[locale];
}

/**
 * Resolves the locale the *interface* is drawn in, in priority order:
 *   1. An explicit cookie — what the language switcher writes.
 *   2. The signed-in user's `preferred_language`.
 *   3. Accept-Language negotiation.
 *   4. DEFAULT_LOCALE.
 *
 * The cookie now outranks the account, which reverses what this used to do, and
 * the distinction it rests on is worth stating plainly because getting it wrong
 * would be expensive.
 *
 * There are two different "languages" in this product and they were only ever
 * conflated here, never in the queries:
 *
 *   The **study language** is `users.preferred_language`. It decides which
 *   subjects exist for a student, which questions they are shown, and which
 *   corpus their mastery was computed against. It is locked at signup and it
 *   stays locked — every content query reads `user.preferredLanguage` directly
 *   (`subjectLanguagesFor`, `getProgressForUser`, `getStanding`), and none of
 *   them has ever read this function.
 *
 *   The **interface language** is the labels: nav items, buttons, the words
 *   around the numbers. Nothing is computed from it and nothing is stored
 *   against it, so a student reading their French-section chemistry in Arabic
 *   menus loses nothing at all.
 *
 * Only the second is switchable, and this is the only place that changes.
 */
export const getLocale = cache(async (): Promise<Locale> => {
  const jar = await cookies();
  const fromCookie = jar.get(LOCALE_COOKIE)?.value;
  if (isLocale(fromCookie)) return fromCookie;

  const session = await getSession();
  if (session) return session.user.preferredLanguage;

  const h = await headers();
  return negotiateLocale(h.get('accept-language'), env().DEFAULT_LOCALE);
});

export const getTranslations = cache(async (): Promise<{ locale: Locale; t: Dictionary }> => {
  const locale = await getLocale();
  return { locale, t: getDictionary(locale) };
});

export type { Dictionary };
export * from './config';
export * from './format';
