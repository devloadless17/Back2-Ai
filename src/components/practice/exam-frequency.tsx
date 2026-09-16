import { cn } from '@/lib/cn';

/**
 * How often the examiners have actually set this chapter.
 *
 * The most actionable fact the product holds, and until now it held it
 * silently: 99.6% of the corpus is linked to a dated paper running 2004-2024.
 * A chapter set in sixteen of eighteen years is where a student should spend
 * Sunday. One last set in 2011 is not. No model is involved and none could do
 * it better — this is arithmetic over the ministry's own papers.
 *
 * WHY RECENCY AND FREQUENCY BOTH, and never one alone. Frequency alone
 * recommends a chapter that was set every year until the syllabus changed in
 * 2015. Recency alone recommends a chapter set once, last year. A student
 * revising for one exam needs the chapters that are BOTH common and current,
 * so the tone is set by the recent window and the count gives the weight.
 *
 * The window is the last eight years. Long enough that a chapter skipped for
 * two years is not written off, short enough that a syllabus change eight years
 * ago has worked its way out. It is a judgement, not a measurement — there is
 * no experiment here that would settle it, and pretending otherwise by tuning
 * it against the corpus would be fitting to the past.
 */

const RECENT_WINDOW = 8;

export type ExamFrequencyTone = 'core' | 'regular' | 'occasional' | 'dormant';

export function examFrequencyOf(
  examYears: number[],
  now = new Date().getUTCFullYear(),
): { tone: ExamFrequencyTone; recent: number; total: number; last: number | null } | null {
  if (examYears.length === 0) return null;

  const cutoff = now - RECENT_WINDOW;
  const recent = examYears.filter((y) => y > cutoff).length;
  const last = examYears[0] ?? null;

  /*
   * `dormant` is deliberately loud. A chapter with a large total and nothing
   * recent is the trap this exists to flag: it looks important by every other
   * measure on the page — lots of questions, plenty of material — and a student
   * can lose a weekend to a topic the examiners stopped setting.
   */
  const tone: ExamFrequencyTone =
    recent === 0 ? 'dormant' : recent >= 5 ? 'core' : recent >= 3 ? 'regular' : 'occasional';

  return { tone, recent, total: examYears.length, last };
}

const TONE_CLASS: Record<ExamFrequencyTone, string> = {
  core: 'bg-primary-soft text-primary',
  regular: 'bg-paper-sunken text-ink-muted',
  occasional: 'bg-paper-sunken text-ink-faint',
  dormant: 'bg-paper-sunken text-ink-faint',
};

export function ExamFrequency({
  examYears,
  labels,
  className,
}: {
  examYears: number[];
  labels: {
    core: string;
    regular: string;
    occasional: string;
    dormant: string;
    years: string;
  };
  className?: string;
}) {
  const frequency = examFrequencyOf(examYears);
  if (!frequency) return null;

  const label = labels[frequency.tone]
    .replace('{recent}', String(frequency.recent))
    .replace('{window}', String(RECENT_WINDOW))
    .replace('{last}', String(frequency.last ?? ''));

  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <span
        className={cn(
          'rounded-full px-2 py-0.5 text-caption font-medium',
          TONE_CLASS[frequency.tone],
        )}
      >
        {label}
      </span>
      {/*
        The years themselves, on wide screens only. A student who half-believes
        the badge should be able to check it, and "2024 · 2022 · 2021" is the
        evidence — but it is detail, so it is the first thing to go when there
        is no room for it.
      */}
      {frequency.total > 0 && (
        <span className="hidden text-caption text-ink-faint lg:inline">
          {labels.years.replace('{years}', examYears.slice(0, 3).join(' · '))}
        </span>
      )}
    </span>
  );
}
