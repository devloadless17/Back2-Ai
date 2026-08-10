import type { Locale } from './config';

/**
 * Locale-aware formatting shared by server and client components.
 *
 * Arabic is pinned to Latin digits (`-u-nu-latn`). Lebanese schooling writes
 * marks and dates in Western numerals; defaulting to Arabic-Indic digits would
 * make a score look unfamiliar to the very students it is meant to serve.
 */

const INTL_LOCALE: Record<Locale, string> = {
  fr: 'fr-FR',
  en: 'en-GB',
  ar: 'ar-LB-u-nu-latn',
};

export function intlLocale(locale: Locale): string {
  return INTL_LOCALE[locale];
}

/**
 * Substitutes `{name}` placeholders. Missing values are left as-is rather than
 * printed as "undefined", so a bad key is visible in review but never renders
 * as garbage to a student.
 */
export function format(template: string, values: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}

export function formatNumber(locale: Locale, value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(intlLocale(locale), options).format(value);
}

export function formatPercent(locale: Locale, ratio: number, digits = 0): string {
  return new Intl.NumberFormat(intlLocale(locale), {
    style: 'percent',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(ratio);
}

/** Marks are shown to one decimal only when they actually have one (14 not 14.0). */
export function formatScore(locale: Locale, value: number): string {
  const digits = Number.isInteger(value) ? 0 : 1;
  return new Intl.NumberFormat(intlLocale(locale), {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export function formatDate(locale: Locale, date: Date | string, options?: Intl.DateTimeFormatOptions): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat(
    intlLocale(locale),
    options ?? { day: 'numeric', month: 'long', year: 'numeric' },
  ).format(d);
}

export function formatDateShort(locale: Locale, date: Date | string): string {
  return formatDate(locale, date, { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function formatWeekday(locale: Locale, date: Date | string): string {
  return formatDate(locale, date, { weekday: 'long', day: 'numeric', month: 'long' });
}

/** mm:ss for the exam countdown; hh:mm:ss once past an hour. */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

/** Whole days between today and `date`, floored — negative once the date has passed. */
export function daysUntil(date: Date | string): number {
  const target = typeof date === 'string' ? new Date(date) : date;
  const a = Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate());
  const now = new Date();
  const b = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((a - b) / 86_400_000);
}
