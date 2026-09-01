import Link from 'next/link';

import { MasteryRing } from '@/components/dashboard/mastery-ring';
import { BandIcon, bandForMastery, bandStyle, type Band } from '@/components/ui/band';
import { getTranslations } from '@/lib/i18n';
import { format } from '@/lib/i18n/format';

/**
 * One ring per subject.
 *
 * This replaced a grid of one tile per chapter. Both are "where you stand", but
 * a candidate has six subjects and three hundred chapters, and the question they
 * actually open the app with is which subject is behind — not which of 292
 * chapters is. The chapter view still exists, one click away, where the extra
 * resolution is worth the scan.
 *
 * The ring is filled by mean chapter mastery, which is a number we always have.
 * The mark in the middle is the predicted mark out of 20, which we frequently do
 * not: below the evidence threshold it shows a dash rather than a number,
 * because a confident 4/20 off two attempts is worse than admitting we cannot
 * say yet.
 */

export type SubjectRing = {
  subjectId: string;
  subjectName: string;
  /** 0–1, mean mastery across the subject's chapters. */
  mastery: number;
  /** Null until there is enough marked work to predict. */
  mark: number | null;
  attemptsCount: number;
  /** Optional shelf counts, shown at `lg` where there is room for them. */
  chapterCount?: number;
  questionCount?: number;
};

/**
 * Two sizes: the compact one for the dashboard panel, a larger one for the
 * subject picker, where the ring is the page rather than a component of it.
 */
const SIZES = {
  md: { box: 64, r: 26, stroke: 6, mark: 13, name: 12.5, gap: 'gap-3', cols: 'sm:grid-cols-3' },
  lg: { box: 84, r: 35, stroke: 7, mark: 16, name: 14, gap: 'gap-4', cols: 'sm:grid-cols-3 lg:grid-cols-4' },
} as const;

export async function SubjectRings({
  subjects,
  size = 'md',
}: {
  subjects: SubjectRing[];
  size?: keyof typeof SIZES;
}) {
  const s = SIZES[size];
  const { t } = await getTranslations();

  const bandLabels: Record<Band, string> = {
    weak: t.dashboard.bandWeak,
    developing: t.dashboard.bandDeveloping,
    mastered: t.dashboard.bandMastered,
    not_started: t.dashboard.bandNotStarted,
    needs_review: t.dashboard.bandNeedsReview,
  };

  return (
    <ul className={`grid grid-cols-2 ${s.gap} ${s.cols}`}>
      {subjects.map((subject) => {
        const band = bandForMastery(subject.mastery, subject.attemptsCount);
        const style = bandStyle(band);
        // A ring that has never moved should read as empty, not as a thin
        // sliver that looks like a rounding error.
        const filled = subject.attemptsCount === 0 ? 0 : subject.mastery;
        const percent = Math.round(subject.mastery * 100);

        return (
          <li key={subject.subjectId}>
            <Link
              href={`/practice/${subject.subjectId}`}
              className="pressable flex h-full flex-col items-center rounded-lg bg-paper-raised px-3 py-4 text-center shadow-sheet transition-[box-shadow,transform] duration-200 hover:shadow-sheet-raised"
            >
              <MasteryRing
                value={filled}
                size={s.box}
                radius={s.r}
                stroke={s.stroke}
                className={style.ink.replace('text-', 'stroke-')}
              >
                {/* The mark when we can state one, the mastery percentage when
                    we cannot — an empty ring with a dash in it tells a student
                    nothing they did not already know. Plain text, so the ring
                    never has to animate for this to be readable. */}
                <span className="numeric font-display font-extrabold" style={{ fontSize: s.mark }}>
                  {subject.mark !== null
                    ? `${subject.mark}/20`
                    : subject.attemptsCount > 0
                      ? `${percent}%`
                      : '—'}
                </span>
              </MasteryRing>

              <span className="font-bold leading-tight" style={{ fontSize: s.name }}>
                {subject.subjectName}
              </span>

              <span className={`mt-1 inline-flex items-center gap-1 text-micro font-semibold ${style.ink}`}>
                <BandIcon band={band} width={11} height={11} />
                {bandLabels[band]}
              </span>

              {subject.chapterCount !== undefined ? (
                <span className="numeric mt-1.5 text-micro text-ink-faint">
                  {subject.chapterCount} · {subject.questionCount}
                </span>
              ) : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** Consecutive days, ending today or yesterday, with at least one attempt. */
export function streakFrom(days: { date: Date; count: number }[]): number {
  const active = new Set(
    days.filter((d) => d.count > 0).map((d) => d.date.toISOString().slice(0, 10)),
  );
  if (active.size === 0) return 0;

  const today = new Date();
  const key = (offset: number) => {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    d.setUTCDate(d.getUTCDate() - offset);
    return d.toISOString().slice(0, 10);
  };

  // Yesterday still counts as alive: a streak that dies at midnight punishes a
  // student for not having opened the app yet this morning.
  let offset = active.has(key(0)) ? 0 : active.has(key(1)) ? 1 : -1;
  if (offset === -1) return 0;

  let streak = 0;
  while (active.has(key(offset))) {
    streak += 1;
    offset += 1;
  }
  return streak;
}

export async function StreakBanner({ streak }: { streak: number }) {
  const { t } = await getTranslations();
  if (streak < 2) return null;

  return (
    <p className="mb-3 flex items-center gap-2.5 rounded-lg bg-partial-soft px-3.5 py-2.5 text-meta font-semibold text-partial">
      <span aria-hidden="true" className="text-base leading-none">
        ⬤
      </span>
      {format(t.dashboard.streakDays, { count: streak })}
    </p>
  );
}
