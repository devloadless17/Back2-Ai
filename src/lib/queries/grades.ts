import 'server-only';

import { db } from '@/lib/db';
import { markOutOf20 } from '@/lib/standing';

/**
 * The marks a student got at school, per subject, on the product's own scale.
 *
 * These have been logged since the grades page was written and nothing has ever
 * read them. Logging a number and never looking at it is worse than not asking
 * for it: the student did the work of entering it and the product implied it
 * mattered.
 *
 * What makes them worth reading is that they are the only *external* measure in
 * the system. Everything else here — mastery, readiness, the predicted mark —
 * is computed from work done inside this product, so it can be internally
 * consistent and still wrong about the exam. A school mark is a different
 * examiner, marking a different paper, and where the two disagree that is a
 * fact worth showing rather than a discrepancy to hide.
 */
export type SchoolMark = {
  subjectId: string;
  /** Mean of every logged mark for the subject, rescaled to 20. */
  mark: number;
  /** How many marks that mean is drawn from — one test is not a picture. */
  count: number;
};

export async function schoolMarksBySubject(userId: string): Promise<SchoolMark[]> {
  const rows = await db.userGrade.findMany({
    where: {
      userId,
      subjectId: { not: null },
      grade: { not: null },
      // A max of zero or null gives no scale to convert from, and a mark of
      // "14" means nothing without knowing whether it was out of 20 or 100.
      maxGrade: { gt: 0 },
    },
    select: { subjectId: true, grade: true, maxGrade: true },
  });

  const bySubject = new Map<string, { total: number; count: number }>();

  for (const row of rows) {
    if (!row.subjectId || row.grade === null || row.maxGrade === null) continue;
    const max = Number(row.maxGrade);
    if (!(max > 0)) continue;

    // Rescaled through the product's own helper rather than by multiplying by
    // 20 here, so a mark logged out of 100 and a predicted mark are on one
    // scale and stay there if that scale is ever changed in one place.
    const outOf20 = markOutOf20(Number(row.grade) / max);
    const entry = bySubject.get(row.subjectId) ?? { total: 0, count: 0 };
    entry.total += outOf20;
    entry.count += 1;
    bySubject.set(row.subjectId, entry);
  }

  return [...bySubject.entries()].map(([subjectId, { total, count }]) => ({
    subjectId,
    mark: Math.round((total / count) * 10) / 10,
    count,
  }));
}

/**
 * How far apart the two marks have to be before it is worth saying so.
 *
 * Two marks out of twenty. Below that the gap is noise — a hard test, a
 * generous marker, a bad morning — and a product that flagged every one-point
 * difference would train its student to ignore the flag.
 *
 * `TUNABLE` — `src/lib/queries/grades.ts`.
 */
export const MARK_GAP_THRESHOLD = 2;

export type MarkComparison = {
  subjectId: string;
  subjectName: string;
  /** Mean school mark out of 20, or null when nothing is logged. */
  school: number | null;
  schoolCount: number;
  /** The product's predicted mark out of 20, or null below the evidence bar. */
  predicted: number | null;
  /** 'aligned' | 'school_lower' | 'school_higher' — null when either is absent. */
  verdict: 'aligned' | 'school_lower' | 'school_higher' | null;
};

/**
 * Pairs each subject's school marks with the mark this product predicts.
 *
 * Deliberately returns a row per subject even when one side is missing, and
 * says which side. "You have not logged anything for Physics" and "we cannot
 * predict Physics yet" are different sentences and lead to different actions;
 * collapsing both into an empty row would tell the student neither.
 */
export function compareMarks(
  subjects: { subjectId: string; subjectName: string; mark: number | null }[],
  schoolMarks: SchoolMark[],
): MarkComparison[] {
  const schoolBySubject = new Map(schoolMarks.map((row) => [row.subjectId, row]));

  return subjects.map((subject) => {
    const school = schoolBySubject.get(subject.subjectId) ?? null;
    const predicted = subject.mark;

    let verdict: MarkComparison['verdict'] = null;
    if (school && predicted !== null) {
      const gap = school.mark - predicted;
      verdict =
        Math.abs(gap) < MARK_GAP_THRESHOLD
          ? 'aligned'
          : gap < 0
            ? 'school_lower'
            : 'school_higher';
    }

    return {
      subjectId: subject.subjectId,
      subjectName: subject.subjectName,
      school: school?.mark ?? null,
      schoolCount: school?.count ?? 0,
      predicted,
      verdict,
    };
  });
}
