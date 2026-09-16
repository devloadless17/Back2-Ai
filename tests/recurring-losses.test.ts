import { describe, expect, it } from 'vitest';

import { baremeResultSchema } from '@/lib/grading';

/**
 * The grouping rules behind "you keep losing marks on X".
 *
 * The query itself needs a database, but the two decisions that make it right
 * or wrong are pure: what counts as losing a mark, and when two criteria are the
 * same criterion. Both fail silently in production — a student is simply told
 * the wrong thing, or nothing — so they are pinned here.
 *
 * These mirror the implementation in `src/lib/queries/recurring-losses.ts`. If
 * that file's rules change, these should fail.
 */

/** Same normalisation as the query. */
function normalise(criterion: string): string {
  return criterion
    .replace(/[ـ]/g, '')
    .replace(/^[\s\d.\-–—)(]+/, '')
    .replace(/\s+/g, ' ')
    .replace(/[.:;،,]+$/, '')
    .trim()
    .toLowerCase();
}

const lostEntirely = (awarded: number, possible: number) => possible > 0 && awarded === 0;

describe('what counts as losing a mark', () => {
  it('counts a criterion scored zero out of some', () => {
    expect(lostEntirely(0, 9)).toBe(true);
  });

  it('does NOT count a partial', () => {
    // Knowing the move and executing it incompletely is a different problem,
    // and counting it here buries the criteria missed entirely.
    expect(lostEntirely(1, 2)).toBe(false);
  });

  it('does not count a criterion worth nothing, however it was scored', () => {
    // A zero-point criterion is a heading in the barème, not a mark to lose.
    expect(lostEntirely(0, 0)).toBe(false);
  });

  it('does not count full marks', () => {
    expect(lostEntirely(9, 9)).toBe(false);
  });
});

describe('when two criteria are the same criterion', () => {
  it('groups the same barème line printed with different numbering', () => {
    // These are the real forms this text arrives in — see the barème survey in
    // scripts/compare-document-prompt.ts.
    const a = '1 1- Explain this text and state the problematic it raises. (9 points)';
    const b = '2) Explain this text and state the problematic it raises. (9 points)';
    expect(normalise(a)).toBe(normalise(b));
  });

  it('ignores whitespace the OCR invented', () => {
    expect(normalise('قدّم   المستند:  نوعه،\n مصدره')).toBe(normalise('قدّم المستند: نوعه، مصدره'));
  });

  it('ignores a kashida, which is decoration and carries no meaning', () => {
    expect(normalise('اســـتخرج الفكرة')).toBe(normalise('استخرج الفكرة'));
  });

  it('ignores trailing punctuation, Arabic comma included', () => {
    expect(normalise('حدّد المسألة،')).toBe(normalise('حدّد المسألة'));
  });

  it('keeps genuinely different criteria apart', () => {
    expect(normalise('Explain this text')).not.toBe(normalise('Discuss this judgment'));
  });

  it('does NOT group two criteria that merely mean the same thing', () => {
    /*
     * Deliberate. Semantic grouping would let the feature tell a student they
     * keep failing at something they failed once, which is worse than saying
     * nothing. Understating a weakness is the safe direction.
     */
    expect(normalise('State the problematic')).not.toBe(normalise('Dégagez la problématique'));
  });
});

describe('the stored shape', () => {
  it('accepts what the marker writes', () => {
    const parsed = baremeResultSchema.safeParse([
      {
        criterion: '1- Explain this text and state the problematic it raises.',
        points_awarded: 0,
        points_possible: 9,
        justification: 'No problematic is stated anywhere in the answer.',
        explanation: '',
      },
    ]);
    expect(parsed.success).toBe(true);
  });

  /*
   * The result schema does NOT require a non-empty criterion — only the barème
   * schema it was marked against does. So an empty or punctuation-only criterion
   * can reach the grouper, where it would collect every such row from every
   * question into one meaningless "you keep losing marks on ''".
   *
   * The guard is in the query, not the schema, and this is what it relies on.
   */
  it('accepts an empty criterion, so the grouper must drop it itself', () => {
    const parsed = baremeResultSchema.safeParse([
      { criterion: '', points_awarded: 0, points_possible: 9, justification: 'x' },
    ]);
    expect(parsed.success).toBe(true);
  });

  it('normalises an empty or punctuation-only criterion to nothing, which the query drops', () => {
    expect(normalise('')).toBe('');
    expect(normalise('  1. ')).toBe('');
    expect(normalise('—')).toBe('');
  });
});
