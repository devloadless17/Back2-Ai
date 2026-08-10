/**
 * SM-2 spaced repetition.
 *
 * Implemented exactly as specified, including two details that differ from some
 * published variants — do not "fix" either without a decision to change the
 * scheduling behaviour:
 *
 *   1. The new interval is computed from the *previous* easiness, before the
 *      easiness update is applied.
 *   2. Easiness is updated on every review, including failures — so repeatedly
 *      failing a card keeps lowering its easiness even while the interval
 *      resets to 1.
 */

export const MIN_EASINESS = 1.3;
export const DEFAULT_EASINESS = 2.5;

/** SM-2 recall quality, 0–5. */
export type ReviewQuality = 0 | 1 | 2 | 3 | 4 | 5;

/**
 * The four buttons a student actually sees, mapped onto SM-2 quality.
 * "Again" maps to 2 so it falls below the quality < 3 failure threshold.
 */
export const QUALITY_BY_GRADE = {
  again: 2,
  hard: 3,
  good: 4,
  easy: 5,
} as const satisfies Record<string, ReviewQuality>;

export type ReviewGrade = keyof typeof QUALITY_BY_GRADE;

export type FlashcardSchedule = {
  easiness: number;
  intervalDays: number;
  repetitions: number;
};

export type ScheduleResult = FlashcardSchedule & {
  dueDate: Date;
  /** True when the card failed and will come back in this same session's day. */
  lapsed: boolean;
};

export function reviewFlashcard(
  current: FlashcardSchedule,
  quality: ReviewQuality,
  today: Date = new Date(),
): ScheduleResult {
  let { repetitions, intervalDays } = current;
  const previousEasiness = current.easiness;
  const lapsed = quality < 3;

  if (lapsed) {
    repetitions = 0;
    intervalDays = 1;
  } else {
    intervalDays =
      repetitions === 0 ? 1 : repetitions === 1 ? 6 : Math.round(intervalDays * previousEasiness);
    repetitions += 1;
  }

  const delta = 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02);
  const easiness = Math.max(MIN_EASINESS, previousEasiness + delta);

  return {
    easiness: round2(easiness),
    intervalDays,
    repetitions,
    dueDate: addDays(startOfDay(today), intervalDays),
    lapsed,
  };
}

export function gradeToQuality(grade: ReviewGrade): ReviewQuality {
  return QUALITY_BY_GRADE[grade];
}

export function newCard(today: Date = new Date()): ScheduleResult {
  return {
    easiness: DEFAULT_EASINESS,
    intervalDays: 1,
    repetitions: 0,
    dueDate: startOfDay(today),
    lapsed: false,
  };
}

/** Dates are stored as DATE, so normalize to UTC midnight to avoid off-by-one across timezones. */
function startOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
