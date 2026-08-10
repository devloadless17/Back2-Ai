import { MIN_ATTEMPTS_FOR_WEAKNESS } from './mastery';

/**
 * Predicted exam readiness for one student in one subject.
 *
 *   readiness = 0.5 × mean(chapter mastery across the subject)
 *             + 0.3 × (chapters with ≥5 attempts ÷ total chapters)
 *             + 0.2 × normalized trend over the trailing 4 weeks
 *
 * Chapters are weighted equally, per the v1 decision. Chapters with no attempts
 * count as zero mastery rather than being skipped — a chapter the student has
 * never opened is a real gap in readiness, not missing data.
 *
 * This number is shown to students as a prediction about a national exam, so
 * the three components are stored alongside it. When a student asks why their
 * readiness dropped, "your coverage fell because two new chapters opened" has
 * to be answerable from the database, not re-derived by hand.
 */

export const READINESS_WEIGHTS = { mastery: 0.5, coverage: 0.3, trend: 0.2 } as const;

/** A 4-week mastery swing of ±0.2 saturates the trend component. */
export const TREND_SATURATION = 0.2;

/** Below this many attempts across the whole subject, readiness is not reported at all. */
export const MIN_ATTEMPTS_FOR_READINESS = 10;

export type ChapterMasterySnapshot = {
  chapterId: string;
  masteryScore: number;
  attemptsCount: number;
};

export type ReadinessInput = {
  /** Every chapter in the subject. Chapters the student has not touched must be included. */
  chapters: ChapterMasterySnapshot[];
  /** Mean mastery across the subject as it stood 4 weeks ago; null when there is no history. */
  masteryFourWeeksAgo: number | null;
};

export type ReadinessResult = {
  score: number;
  masteryComponent: number;
  coverageComponent: number;
  trendComponent: number;
  trend: 'up' | 'flat' | 'down';
  /** False when there is not yet enough evidence; the UI shows an empty state instead of a number. */
  reportable: boolean;
  totalAttempts: number;
};

export function computeReadiness(input: ReadinessInput): ReadinessResult {
  const { chapters, masteryFourWeeksAgo } = input;

  const totalAttempts = chapters.reduce((sum, c) => sum + c.attemptsCount, 0);
  const totalChapters = chapters.length;

  const masteryComponent =
    totalChapters === 0
      ? 0
      : chapters.reduce((sum, c) => sum + clamp01(c.masteryScore), 0) / totalChapters;

  const coveredChapters = chapters.filter((c) => c.attemptsCount >= MIN_ATTEMPTS_FOR_WEAKNESS).length;
  const coverageComponent = totalChapters === 0 ? 0 : coveredChapters / totalChapters;

  // With no history, "flat" is the honest answer — it must not read as decline.
  const delta = masteryFourWeeksAgo === null ? 0 : masteryComponent - masteryFourWeeksAgo;
  const trendComponent = clamp01(0.5 + (delta / TREND_SATURATION) * 0.5);
  const trend: ReadinessResult['trend'] = delta > 0.02 ? 'up' : delta < -0.02 ? 'down' : 'flat';

  const score =
    READINESS_WEIGHTS.mastery * masteryComponent +
    READINESS_WEIGHTS.coverage * coverageComponent +
    READINESS_WEIGHTS.trend * trendComponent;

  return {
    score: round3(clamp01(score)),
    masteryComponent: round3(masteryComponent),
    coverageComponent: round3(coverageComponent),
    trendComponent: round3(trendComponent),
    trend,
    reportable: totalAttempts >= MIN_ATTEMPTS_FOR_READINESS && totalChapters > 0,
    totalAttempts,
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
