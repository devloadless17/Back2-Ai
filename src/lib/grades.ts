/**
 * Rules for the student's private grade log.
 *
 * Pulled out of the route so the one piece with real logic in it — deciding
 * what a partial edit produces — can be tested without standing up a request,
 * a session and a database.
 */

/**
 * The largest mark the column can hold.
 *
 * `UserGrade.grade` and `maxGrade` are `Decimal(5, 2)`: five significant
 * digits, two after the point, so 999.99 is the ceiling. The schema used to
 * accept 1000, which Postgres rejects on write — a numeric field overflow,
 * surfacing to the student as a 500 rather than a refused field. Marks out of
 * a thousand do not exist in the Lebanese Bac; the bound is here to make the
 * failure a validation error instead of a crash.
 */
export const MAX_GRADE_VALUE = 999.99;

export type GradeBounds = {
  grade: number | null;
  maxGrade: number | null;
};

/**
 * The row as it would be after a partial edit.
 *
 * Every field of a PATCH is optional and absent means unchanged, so
 * `grade <= maxGrade` cannot be checked on the request alone: a request that
 * raises only the maximum carries no grade to compare against, and one that
 * lowers only the grade carries no maximum. Both have to be read against the
 * stored row.
 */
export function mergeGrade(
  existing: GradeBounds,
  patch: { grade?: number; maxGrade?: number },
): GradeBounds {
  return {
    grade: patch.grade ?? existing.grade,
    maxGrade: patch.maxGrade ?? existing.maxGrade,
  };
}

/**
 * Whether a mark fits inside its own maximum.
 *
 * A null on either side is not a violation. The log has always allowed a row
 * with no numbers on it — a student noting that a paper came back without a
 * mark — and an edit that touches only the label must not be refused because
 * the row it belongs to was never scored.
 */
export function gradeIsWithinMax({ grade, maxGrade }: GradeBounds): boolean {
  if (grade === null || maxGrade === null) return true;
  return grade <= maxGrade;
}
