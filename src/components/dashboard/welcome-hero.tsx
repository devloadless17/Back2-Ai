import Link from 'next/link';

import { getTranslations } from '@/lib/i18n';
import { format, formatPlural } from '@/lib/i18n/format';

/**
 * The welcome banner.
 *
 * This is where the brand gradient belongs and the one place in the product it
 * is used. It holds four short lines and one button, so white type sits on it
 * with room to breathe — which is exactly what failed when the same treatment
 * was put behind the dense Today card, where small muted text and blurred
 * colour blobs fought each other for the same 400 pixels.
 *
 * Two rules keep it honest. Every colour on it is set explicitly rather than
 * inherited, so nothing downstream can wander in expecting ink on paper. And
 * the blobs are pseudo-elements sized against a wide banner, positioned with
 * logical properties so they mirror in Arabic instead of drifting across the
 * text.
 *
 * The streak chip and the three-figure row come from the design mockup. Both
 * are deliberately colourless: on a gradient this saturated the only readable
 * ink is white, and a "weak spots" figure printed in rose here would either
 * fail contrast or stop meaning what rose means everywhere else. Status keeps
 * its colours on the cards below, where they read.
 */
export async function WelcomeHero({
  firstName,
  sessionCount,
  totalMinutes,
  doneCount,
  daysToExam,
  streak,
  weekAccuracy,
  weekAnswered,
  weakSpots,
}: {
  firstName: string;
  sessionCount: number;
  totalMinutes: number;
  doneCount: number;
  daysToExam: number | null;
  /** Consecutive active days. Shown from two — one day is not a streak. */
  streak: number;
  /** 0–1 over the last seven days, or null when nothing carries a verdict. */
  weekAccuracy: number | null;
  weekAnswered: number;
  /** Chapters with enough evidence behind them to call weak. */
  weakSpots: number;
}) {
  const { t, locale } = await getTranslations();

  const planned = sessionCount > 0;
  const allDone = !planned && doneCount > 0;

  const title = planned
    ? format(t.dashboard.heroTitle, { name: firstName })
    : allDone
      ? format(t.dashboard.heroDoneTitle, { name: firstName })
      : format(t.dashboard.heroEmptyTitle, { name: firstName });

  /*
   * Built from three separately-pluralised pieces.
   *
   * As one template it read "1 sessions · 30 minutes · exam in 1 days" — and in
   * Arabic it used the 11-99 form of "day" for every count, so it was
   * ungrammatical for the whole final week. A single string cannot agree with
   * three independent numbers; each piece agrees with its own.
   */
  const summary = planned
    ? [
        formatPlural(locale, sessionCount, t.dashboard.heroSessions),
        formatPlural(locale, totalMinutes, t.dashboard.heroMinutes),
        daysToExam !== null && daysToExam >= 0
          ? formatPlural(locale, daysToExam, t.dashboard.heroExamIn)
          : t.dashboard.heroPlanned,
      ].join(' · ')
    : allDone
      ? format(t.dashboard.heroDoneSummary, { count: doneCount })
      : t.dashboard.heroEmptySummary;

  const cta = planned
    ? { href: '/practice', label: t.dashboard.heroCta }
    : { href: '/schedule', label: t.dashboard.heroEmptyCta };

  return (
    <section className="hero-banner mb-5 px-6 py-8 sm:px-9 sm:py-10">
      <div className="relative z-[1]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-xl">
            <p className="text-caption font-bold uppercase tracking-[0.08em] text-on-primary">
              {t.dashboard.heroEyebrow}
            </p>
            <h1 className="mt-2 font-display text-display font-extrabold text-on-primary sm:text-hero">
              {title}
            </h1>
            <p className="numeric mt-2 text-body text-on-primary">{summary}</p>
          </div>

          {/* From two days. One day is a session, not a run — and a chip that
              appears the first time anyone opens the app teaches nothing. */}
          {streak >= 2 ? (
            <p className="rounded-lg bg-on-primary/15 px-3.5 py-2.5 text-meta font-bold text-on-primary">
              {formatPlural(locale, streak, t.dashboard.heroStreakBadge)}
            </p>
          ) : null}
        </div>

        {/*
          The week, in three figures.

          Accuracy is null until something in the window has been marked, and
          prints a dash rather than 0% — telling a student they are at zero
          when they have simply not started is the fastest way to lose them.
        */}
        <dl className="mt-6 flex flex-wrap gap-x-8 gap-y-3">
          <HeroStat
            value={weekAccuracy === null ? '—' : `${Math.round(weekAccuracy * 100)}%`}
            label={weekAccuracy === null ? t.dashboard.heroStatPending : t.dashboard.heroStatAccuracy}
          />
          <HeroStat value={weekAnswered} label={t.dashboard.heroStatAnswered} />
          <HeroStat value={weakSpots} label={t.dashboard.heroStatWeakSpots} />
        </dl>

        <Link
          href={cta.href}
          className="mt-6 inline-flex items-center gap-2 rounded-full bg-partial-bright px-5 py-3 text-body font-bold text-ink shadow-pop transition-transform duration-200 ease-soft hover:-translate-y-0.5 motion-reduce:transform-none motion-reduce:hover:transform-none"
        >
          {cta.label}
          <span aria-hidden="true">→</span>
        </Link>
      </div>
    </section>
  );
}

/**
 * A figure with its label.
 *
 * `dt` before `dd` because that is the only order a description list is allowed
 * to have; `flex-col-reverse` puts the figure on top where the design wants it,
 * without lying to a screen reader about which is the term.
 */
function HeroStat({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <div className="flex flex-col-reverse">
      <dt className="mt-1 text-caption text-on-primary">{label}</dt>
      <dd className="numeric font-display text-heading font-extrabold leading-none text-on-primary">
        {value}
      </dd>
    </div>
  );
}
