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

/**
 * Picks the right wording for a count.
 *
 * Written because the exam countdown — the most-read number in this product —
 * was ungrammatical in all three languages in the week that matters most. The
 * hero said "exam in 1 days", "examen dans 1 jours", and in Arabic
 * `الامتحان بعد 1 يومًا`.
 *
 * Arabic is why this uses `Intl.PluralRules` rather than an `n === 1` check.
 * English and French need two forms; Arabic needs SIX, and the corpus of
 * mistakes is not limited to 1:
 *
 *     1   يوم واحد      one
 *     2   يومين         two   — a dual form, which English has no equivalent of
 *     3   أيام          few
 *     11  يومًا          many
 *
 * The string that shipped, `يومًا`, is the form for 11-99. It is wrong for
 * every count from one to ten — which is the whole of the final revision week
 * and then some, in a product whose entire purpose is that countdown.
 *
 * Falls back to `other` for any category a dictionary does not supply, so
 * adding a language cannot produce an empty string; the worst case is the
 * slightly-wrong plural we already had.
 */
export type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };

export function plural(locale: Locale, count: number, forms: PluralForms): string {
  const category = new Intl.PluralRules(intlLocale(locale)).select(count);
  return forms[category] ?? forms.other;
}

/** `plural` and `format` together, with `{count}` always available. */
export function formatPlural(
  locale: Locale,
  count: number,
  forms: PluralForms,
  values: Record<string, string | number> = {},
): string {
  return format(plural(locale, count, forms), { count, ...values });
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
