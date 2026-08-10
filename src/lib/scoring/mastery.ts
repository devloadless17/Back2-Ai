/**
 * Chapter mastery.
 *
 *   mastery = Σ(correct_i × recency_i × difficulty_i) / Σ(recency_i × difficulty_i)
 *   recency_i = exp(-days_since_attempt_i / 14)          -- 14-day half-life
 *
 * Two things this function deliberately does not do:
 *   * It never sees old-cycle activity. That mode writes no attempt rows at
 *     all, so unscored self-checking cannot move a student's mastery.
 *   * It does not read the database. It takes the attempts it should count and
 *     returns a number, so the formula is testable without a Postgres instance.
 */

export const MASTERY_HALF_LIFE_DAYS = 14;

/** Below this, "weakest chapter" stays hidden — one bad day is not a weakness. */
export const MIN_ATTEMPTS_FOR_WEAKNESS = 5;

/** Used when a question has no calibrated difficulty yet. */
export const DEFAULT_DIFFICULTY = 0.5;

export type ScorableAttempt = {
  attemptedAt: Date;
  /** Null for open questions that were graded on a barème rather than marked right/wrong. */
  isCorrect: boolean | null;
  /** Barème points awarded, when the attempt was marked rather than checked. */
  score?: number | null;
  maxScore?: number | null;
  /** 0..1. Null falls back to DEFAULT_DIFFICULTY. */
  difficulty?: number | null;
};

/**
 * How much credit an attempt earns, in 0..1.
 *
 * MCQ attempts are binary. Open and problem attempts are marked against a
 * barème and earn partial credit — collapsing "8 out of 10" to `false` would
 * make mastery on the long-form questions that dominate the Bac essentially
 * meaningless.
 */
export function attemptCredit(attempt: ScorableAttempt): number {
  if (attempt.isCorrect !== null && attempt.isCorrect !== undefined) {
    return attempt.isCorrect ? 1 : 0;
  }

  const { score, maxScore } = attempt;
  if (typeof score === 'number' && typeof maxScore === 'number' && maxScore > 0) {
    return clamp01(score / maxScore);
  }

  // Neither marked nor scored — cannot contribute, and must not be counted as
  // a failure, so the caller filters these out before weighting.
  return Number.NaN;
}

export function recencyWeight(attemptedAt: Date, now: Date = new Date()): number {
  const days = Math.max(0, (now.getTime() - attemptedAt.getTime()) / 86_400_000);
  return Math.exp(-days / MASTERY_HALF_LIFE_DAYS);
}

export type MasteryResult = {
  /** 0..1, rounded to the 3 decimals the column stores. */
  masteryScore: number;
  /** Every attempt supplied, including unscored ones — this is the gate for the dashboard. */
  attemptsCount: number;
};

export function computeMastery(attempts: ScorableAttempt[], now: Date = new Date()): MasteryResult {
  let numerator = 0;
  let denominator = 0;

  for (const attempt of attempts) {
    const credit = attemptCredit(attempt);
    if (Number.isNaN(credit)) continue;

    const difficulty = attempt.difficulty ?? DEFAULT_DIFFICULTY;
    // A zero-difficulty question would contribute no weight at all and could
    // make the denominator zero; floor it so every attempt counts for something.
    const weight = recencyWeight(attempt.attemptedAt, now) * Math.max(difficulty, 0.05);

    numerator += credit * weight;
    denominator += weight;
  }

  const score = denominator === 0 ? 0 : numerator / denominator;
  return { masteryScore: round3(clamp01(score)), attemptsCount: attempts.length };
}

/**
 * Picks the chapter to surface as "needs the most work".
 *
 * Returns null until at least one chapter clears MIN_ATTEMPTS_FOR_WEAKNESS.
 * Naming a weak spot off two attempts is worse than saying nothing: it is
 * usually noise, and students act on it.
 */
export function weakestChapter<T extends { chapterId: string; masteryScore: number; attemptsCount: number }>(
  rows: T[],
): T | null {
  const eligible = rows.filter((r) => r.attemptsCount >= MIN_ATTEMPTS_FOR_WEAKNESS);
  if (eligible.length === 0) return null;

  return eligible.reduce((lowest, row) => (row.masteryScore < lowest.masteryScore ? row : lowest));
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
