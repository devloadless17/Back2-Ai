'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';

import type { Locale } from './config';
import { dirFor } from './config';
import type { Dictionary } from './dictionaries/en';
import { format, formatDate, formatNumber, formatPercent, formatScore } from './format';

/**
 * Client-side access to the dictionary.
 *
 * The server layout resolves the locale once and passes the whole dictionary
 * down. It is a few kilobytes and avoids every interactive component having to
 * round-trip for a label. Client components import from `@/lib/i18n/client`;
 * `@/lib/i18n` is server-only.
 */

type I18nValue = {
  locale: Locale;
  dir: 'ltr' | 'rtl';
  t: Dictionary;
  format: (template: string, values?: Record<string, string | number>) => string;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
  formatPercent: (ratio: number, digits?: number) => string;
  formatScore: (value: number) => string;
  formatDate: (date: Date | string, options?: Intl.DateTimeFormatOptions) => string;
};

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({
  locale,
  dictionary,
  children,
}: {
  locale: Locale;
  dictionary: Dictionary;
  children: ReactNode;
}) {
  const value = useMemo<I18nValue>(
    () => ({
      locale,
      dir: dirFor(locale),
      t: dictionary,
      format,
      formatNumber: (v, o) => formatNumber(locale, v, o),
      formatPercent: (r, d) => formatPercent(locale, r, d),
      formatScore: (v) => formatScore(locale, v),
      formatDate: (d, o) => formatDate(locale, d, o),
    }),
    [locale, dictionary],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error('useI18n must be used inside <I18nProvider>. Check that the app layout wraps this tree.');
  }
  return ctx;
}
