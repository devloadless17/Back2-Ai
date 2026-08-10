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
 * Resolves the active locale for this request, in priority order:
 *   1. The signed-in user's locked `preferred_language`.
 *   2. An explicit cookie (how a signed-out visitor switches language).
 *   3. Accept-Language negotiation.
 *   4. DEFAULT_LOCALE.
 *
 * A signed-in user's preference always wins: their locale is part of their
 * enrolment, not a per-device setting.
 */
export const getLocale = cache(async (): Promise<Locale> => {
  const session = await getSession();
  if (session) return session.user.preferredLanguage;

  const jar = await cookies();
  const fromCookie = jar.get(LOCALE_COOKIE)?.value;
  if (isLocale(fromCookie)) return fromCookie;

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
