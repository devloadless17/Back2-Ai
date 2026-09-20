import { describe, expect, it } from 'vitest';

import { MAX_GRADE_VALUE, gradeIsWithinMax, mergeGrade } from '@/lib/grades';

/**
 * Editing a mark already in the log.
 *
 * Before this, correcting a typed 41/20 meant deleting the row and typing it
 * again, which threw away the date it was filed under. The edit is a PATCH
 * where every field is optional and absent means unchanged — and that is the
 * whole difficulty, because `grade <= maxGrade` then cannot be decided from
 * the request on its own.
 */

describe('what a partial edit produces', () => {
  const stored = { grade: 15, maxGrade: 20 };

  it('keeps the fields the request does not mention', () => {
    expect(mergeGrade(stored, {})).toEqual({ grade: 15, maxGrade: 20 });
    expect(mergeGrade(stored, { grade: 17 })).toEqual({ grade: 17, maxGrade: 20 });
    expect(mergeGrade(stored, { maxGrade: 25 })).toEqual({ grade: 15, maxGrade: 25 });
  });

  it('takes a zero from the request rather than reading it as absent', () => {
    // `patch.grade ?? existing.grade` and not `||`. A student who actually
    // scored nothing must be able to log it; `||` would silently keep the 15.
    expect(mergeGrade(stored, { grade: 0 })).toEqual({ grade: 0, maxGrade: 20 });
  });
});

describe('a mark has to fit inside its own maximum', () => {
  it('refuses a grade above the max it is out of', () => {
    expect(gradeIsWithinMax({ grade: 41, maxGrade: 20 })).toBe(false);
  });

  it('allows a full mark', () => {
    expect(gradeIsWithinMax({ grade: 20, maxGrade: 20 })).toBe(true);
  });

  /**
   * The case the request alone cannot answer, and the reason the merge exists.
   *
   * Lowering the maximum under a grade that is already stored is a valid
   * request in isolation — there is no grade in it to compare against — and it
   * leaves the row describing 18 out of 10.
   */
  it('catches an edit that lowers only the maximum under the stored grade', () => {
    const merged = mergeGrade({ grade: 18, maxGrade: 20 }, { maxGrade: 10 });
    expect(gradeIsWithinMax(merged)).toBe(false);
  });

  it('catches an edit that raises only the grade above the stored maximum', () => {
    const merged = mergeGrade({ grade: 12, maxGrade: 20 }, { grade: 24 });
    expect(gradeIsWithinMax(merged)).toBe(false);
  });

  it('accepts an edit that raises both together', () => {
    const merged = mergeGrade({ grade: 15, maxGrade: 20 }, { grade: 38, maxGrade: 40 });
    expect(gradeIsWithinMax(merged)).toBe(true);
  });

  /**
   * An unscored row is not a violation. The log has always allowed a student
   * to note a paper that came back without a mark, and renaming that row must
   * not be refused because it was never scored.
   */
  it('does not refuse a row that has no numbers on it', () => {
    expect(gradeIsWithinMax({ grade: null, maxGrade: null })).toBe(true);
    expect(gradeIsWithinMax({ grade: null, maxGrade: 20 })).toBe(true);
    expect(gradeIsWithinMax({ grade: 15, maxGrade: null })).toBe(true);
  });
});

describe('the ceiling matches the column', () => {
  /**
   * `Decimal(5, 2)` holds 999.99 and no more. The schema accepted 1000, which
   * Postgres rejects on write — the student saw a 500 where they should have
   * seen a refused field.
   */
  it('stays inside what Decimal(5, 2) can hold', () => {
    expect(MAX_GRADE_VALUE).toBe(999.99);
    expect(MAX_GRADE_VALUE).toBeLessThan(1000);
  });
});
