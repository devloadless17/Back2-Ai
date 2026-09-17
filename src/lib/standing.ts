/**
 * Where a student stands, in the units the Lebanese Baccalaureate actually uses.
 *
 * This replaces an earlier levels-and-badges layer. The reason is not taste: a
 * point score invented by this product means nothing to the person reading it.
 * A mark out of 20 means something to every Lebanese student, parent and
 * teacher before a word of explanation — 10 is the pass, 14 is good, and
 * everybody already knows it.
 *
 * Four numbers, and every one of them is checkable against something real:
 *
 *   * **Predicted mark, /20.** The readiness score re-expressed in the exam's
 *     own unit. It is not a grade and must never be presented as one; it is a
 *     prediction from marked work, shown only once there is enough of it.
 *   * **Programme covered.** How much of the syllabus has actually been
 *     practised.
 *   * **Days to the sitting.** Counted from the student's own exam date.
 *   * **Days worked this month.** Consistency, stated plainly, with no streak
 *     mechanics attached to it.
 *
 * Pure functions, no database, so the arithmetic is testable on its own.
 */

/** The Lebanese Baccalaureate is marked out of 20, and 10 is the pass. */
export const MARK_SCALE = 20;
export const PASS_MARK = 10;

/**
 * Turns a 0..1 readiness score into a mark out of 20.
 *
 * One decimal, because that is how a Lebanese report is written and because a
 * second decimal would imply a precision this prediction does not have.
 */
export function markOutOf20(readiness: number): number {
  const clamped = Number.isFinite(readiness) ? Math.min(1, Math.max(0, readiness)) : 0;
  return Math.round(clamped * MARK_SCALE * 10) / 10;
}

/** How a mark reads on the Lebanese scale. Drives colour, and is always labelled. */
export type MarkBand = 'failing' | 'passing' | 'good' | 'strong';

export function bandForMark(mark: number): MarkBand {
  if (mark < PASS_MARK) return 'failing';
  if (mark < 12) return 'passing';
  if (mark < 15) return 'good';
  return 'strong';
}

/**
 * The overall mark across subjects.
 *
 * The plain mean, deliberately: subject coefficients are set by ministry decree
 * and are not yet encoded in this product (see docs/CURRICULUM.md). Weighting
 * by a guess would produce a number that looks official and is wrong, so until
 * the descriptor is entered every subject counts once — and the UI says so.
 *
 * Subjects with too little evidence are excluded rather than counted as zero.
 * Averaging in a subject the product has refused to score would be inventing a
 * number, which is the one thing this codebase does not do.
 */
export function overallMark(subjectMarks: number[]): number | null {
  if (subjectMarks.length === 0) return null;
  const total = subjectMarks.reduce((sum, mark) => sum + mark, 0);
  return Math.round((total / subjectMarks.length) * 10) / 10;
}

/**
 * STUDENT coverage. One definition, the same one the readiness model divides
 * by: chapters attempted, over the chapters in the student's programme.
 *
 * The denominator used to be "chapters that have questions", which is a fact
 * about our corpus rather than about the student — it moved when ingestion ran
 * and it disagreed with readiness. That measure still exists, under a name
 * that says what it counts, in `src/lib/queries/content-health.ts`.
 *
 * The chapter list runs ahead of the questions, so this number is honest about
 * a programme the student cannot yet fully practise. That is why the count is
 * always shown beside the percentage, and why a chapter with material but no
 * questions says so rather than reading as a gap the student left.
 */
export type Coverage = {
  /** Chapters with at least one marked attempt. */
  practised: number;
  /** Chapters in the programme. */
  available: number;
  /** 0..1. Zero chapters reads as zero covered, never as complete. */
  ratio: number;
};

export function coverage(practised: number, available: number): Coverage {
  const safeAvailable = Math.max(0, available);
  const safePractised = Math.min(Math.max(0, practised), safeAvailable);

  return {
    practised: safePractised,
    available: safeAvailable,
    ratio: safeAvailable === 0 ? 0 : safePractised / safeAvailable,
  };
}

/**
 * Days worked in the current calendar month.
 *
 * A month rather than an all-time streak: a streak punishes one missed evening
 * by resetting months of work to zero, which is a mechanic borrowed from games
 * that has no place in a product a student depends on. "18 of 31 days" is the
 * same information without the threat.
 */
export type MonthlyEffort = {
  daysWorked: number;
  daysElapsed: number;
  daysInMonth: number;
  ratio: number;
};

export function monthlyEffort(activeDates: Date[], now: Date = new Date()): MonthlyEffort {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const daysElapsed = now.getUTCDate();

  const worked = new Set(
    activeDates
      .filter((date) => date.getUTCFullYear() === year && date.getUTCMonth() === month)
      .map((date) => date.getUTCDate()),
  );

  return {
    daysWorked: worked.size,
    daysElapsed,
    daysInMonth,
    ratio: daysElapsed === 0 ? 0 : Math.min(1, worked.size / daysElapsed),
  };
}
