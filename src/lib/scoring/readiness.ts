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

/**
 * Which readiness model produced a score.
 *
 * v1 reported one term it called "mastery" that was the mean over EVERY chapter
 * in the subject, so an untouched chapter entered as a zero. That number was
 * therefore mastery-on-attempted multiplied by the fraction attempted — breadth
 * folded invisibly into a word that means depth — and coverage was then added
 * again beside it.
 *
 * v2 states the same arithmetic honestly. `mean_over_all_chapters` is
 * identically `mastery_on_attempted x fraction_attempted`, so the SCORE IS
 * UNCHANGED and v1 and v2 snapshots remain on one scale. What changes is that
 * the two ideas are now separate values the product can show and reason about.
 *
 * v2 also floors an account with no attempts at zero — see `computeReadiness`.
 * That is the only behavioural difference, and it moves a number nothing was
 * allowed to display anyway.
 */
export const READINESS_MODEL_VERSION = 2;

/**
 * Weights, UNCHANGED from v1 and deliberately so.
 *
 * They are a product heuristic, not a calibration — nobody has fitted them to
 * an outcome, and this repository holds no data that could. Because v2 is an
 * algebraic restatement rather than a new formula, leaving them alone is what
 * keeps every historical score comparable. Changing them is a separate
 * decision that needs real distributions to justify.
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
  /**
   * The weighted mastery TERM — mastery x coverage, the quantity v1 called
   * `masteryComponent`. Kept under its old name because it is what the score is
   * built from; read `mastery` and `coverage` below for the two ideas.
   */
  masteryComponent: number;
  coverageComponent: number;
  trendComponent: number;
  trend: 'up' | 'flat' | 'down';

  /**
   * HOW WELL, where there is evidence. Mean mastery over chapters the student
   * has actually attempted, and undefined-but-zero when they have attempted
   * none. A student who has answered five chapters perfectly reads 1.0 here,
   * not 0.25 — the number answers "how am I doing on what I have done".
   */
  mastery: number;
  /**
   * HOW MUCH of the subject has been attempted at all: chapters with at least
   * one attempt, over every chapter in the subject.
   *
   * Distinct from `coverageComponent`, which counts chapters at or above
   * MIN_ATTEMPTS_FOR_WEAKNESS and is the stricter figure the score uses. This
   * one is the denominator inside the mastery term, and the honest answer to
   * "how much of this have I touched".
   */
  coverage: number;
  /** Chapters with at least one attempt, and the total. For evidence copy. */
  chaptersAttempted: number;
  chaptersTotal: number;

  /** False when there is not yet enough evidence; the UI shows an empty state instead of a number. */
  reportable: boolean;
  totalAttempts: number;
  /** Which model produced this. See READINESS_MODEL_VERSION. */
  modelVersion: number;
};

export function computeReadiness(input: ReadinessInput): ReadinessResult {
  const { chapters, masteryFourWeeksAgo } = input;

  const totalAttempts = chapters.reduce((sum, c) => sum + c.attemptsCount, 0);
  const totalChapters = chapters.length;

  /*
   * THE TWO IDEAS, SEPARATED.
   *
   * `mastery` is the mean over chapters with evidence — how well, where we
   * know. `coverage` is how many of the subject's chapters have any evidence at
   * all. Their product is the mean over every chapter, which is exactly what v1
   * computed and called mastery on its own.
   */
  const attempted = chapters.filter((c) => c.attemptsCount > 0);
  const chaptersAttempted = attempted.length;

  const mastery =
    chaptersAttempted === 0
      ? 0
      : attempted.reduce((sum, c) => sum + clamp01(c.masteryScore), 0) / chaptersAttempted;

  const coverage = totalChapters === 0 ? 0 : chaptersAttempted / totalChapters;

  // Identical to v1's `masteryComponent` by construction. See the note on
  // READINESS_MODEL_VERSION for why that identity is the whole point.
  const masteryComponent = mastery * coverage;

  const coveredChapters = chapters.filter((c) => c.attemptsCount >= MIN_ATTEMPTS_FOR_WEAKNESS).length;
  const coverageComponent = totalChapters === 0 ? 0 : coveredChapters / totalChapters;

  // With no history, "flat" is the honest answer — it must not read as decline.
  const delta = masteryFourWeeksAgo === null ? 0 : masteryComponent - masteryFourWeeksAgo;
  const trendComponent = clamp01(0.5 + (delta / TREND_SATURATION) * 0.5);
  const trend: ReadinessResult['trend'] = delta > 0.02 ? 'up' : delta < -0.02 ? 'down' : 'flat';

  /*
   * AN ACCOUNT WITH NO ATTEMPTS SCORES ZERO.
   *
   * v1 gave it 0.1 — the trend term's neutral 0.5 at weight 0.2 — for a student
   * who had done nothing. `reportable` hid that from every screen, but hiding a
   * wrong number is not the same as it being right, and any future caller
   * reading `score` without checking would have printed a mark for an empty
   * account.
   *
   * A floor rather than a reweighting: it moves the one case that was
   * indefensible and leaves every other score exactly where v1 put it.
   */
  const score =
    totalAttempts === 0
      ? 0
      : READINESS_WEIGHTS.mastery * masteryComponent +
        READINESS_WEIGHTS.coverage * coverageComponent +
        READINESS_WEIGHTS.trend * trendComponent;

  return {
    score: round3(clamp01(score)),
    masteryComponent: round3(masteryComponent),
    coverageComponent: round3(coverageComponent),
    trendComponent: round3(totalAttempts === 0 ? 0 : trendComponent),
    trend,
    mastery: round3(mastery),
    coverage: round3(coverage),
    chaptersAttempted,
    chaptersTotal: totalChapters,
    modelVersion: READINESS_MODEL_VERSION,
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
