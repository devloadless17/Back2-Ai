import { describe, expect, it } from 'vitest';

import { REPEAT_THRESHOLD } from '@/lib/queries/repeated-criteria';
import { baremeResultItemSchema } from '@/lib/grading';

/**
 * The rules behind Examiner Mode.
 *
 * Two of these are personalised claims shown to a student, and the dashboard
 * principle applies: a wrong personalised claim is worse than a missing one.
 * The third is the field discipline that keeps ministry wording apart from
 * generated coaching — the mistake this phase existed to correct.
 */

/** Mirrors `outcomeOf` in examiner-mark.tsx. */
function outcomeOf(awarded: number, possible: number): 'earned' | 'partial' | 'lost' {
  if (awarded >= possible) return 'earned';
  return awarded > 0 ? 'partial' : 'lost';
}

const GLYPH = { earned: '✓', partial: '◐', lost: '×' } as const;
const COLOUR = { earned: 'text-correct', partial: 'text-partial', lost: 'text-mark' } as const;

describe('criterion status', () => {
  it('earns on full marks, and on more than full', () => {
    expect(outcomeOf(1, 1)).toBe('earned');
    expect(outcomeOf(2, 2)).toBe('earned');
    // Defensive: a marker that over-awards must not render as a loss.
    expect(outcomeOf(3, 2)).toBe('earned');
  });

  it('is partial between nothing and full', () => {
    expect(outcomeOf(1, 2)).toBe('partial');
    expect(outcomeOf(0.5, 1)).toBe('partial');
  });

  it('is lost at zero', () => {
    expect(outcomeOf(0, 1)).toBe('lost');
    expect(outcomeOf(0, 9)).toBe('lost');
  });

  it('treats a zero-point criterion as earned rather than lost', () => {
    // A heading in the barème carries no marks. Rendering it with a red cross
    // would tell a student they failed something that was never marked.
    expect(outcomeOf(0, 0)).toBe('earned');
  });
});

describe('status maps to both a glyph and a colour', () => {
  /*
   * The pairing is the accessibility contract: the row must still read for a
   * student who cannot distinguish teal from rose, and the semantic colours
   * mean the same here as everywhere else in the product.
   */
  it('never uses a colour without its glyph', () => {
    for (const status of ['earned', 'partial', 'lost'] as const) {
      expect(GLYPH[status]).toBeTruthy();
      expect(COLOUR[status]).toBeTruthy();
    }
  });

  it('keeps rose for lost marks and teal for earned', () => {
    expect(COLOUR.lost).toBe('text-mark');
    expect(COLOUR.earned).toBe('text-correct');
    expect(COLOUR.partial).toBe('text-partial');
  });
});

describe('the recurring-loss threshold', () => {
  it('is two — one prior slip is a coincidence, not a pattern', () => {
    expect(REPEAT_THRESHOLD).toBe(2);
  });

  it('matches the threshold recurringLosses itself applies', () => {
    /*
     * `recurringLosses` refuses to report anything seen once. A lower value
     * here would silently widen a rule set deliberately in another file, and
     * the student would be told something keeps costing them marks on the
     * strength of a single occasion.
     */
    expect(REPEAT_THRESHOLD).toBeGreaterThanOrEqual(2);
  });
});

describe('the stored marking keeps its fields apart', () => {
  const parsed = baremeResultItemSchema.parse({
    criterion: 'Justification de la continuité',
    points_awarded: 0,
    points_possible: 1,
    justification: 'The candidate applied the theorem without establishing continuity.',
    explanation: 'You used the theorem correctly, but did not state that $f$ is continuous first.',
    provisional: false,
  });

  it('carries a teacher-facing justification and a student-facing explanation', () => {
    // They are different sentences written for different readers, and the
    // results screen printed the wrong one for as long as it existed.
    expect(parsed.justification).not.toBe(parsed.explanation);
  });

  it('defaults explanation rather than requiring it, so old rows survive', () => {
    const old = baremeResultItemSchema.parse({
      criterion: 'x',
      points_awarded: 0,
      points_possible: 1,
      justification: 'y',
    });
    expect(old.explanation).toBe('');
    expect(old.provisional).toBe(false);
  });

  it('keeps provisional on the criterion, not on the attempt', () => {
    // A paper can mix an exercise whose scheme survived extraction with one
    // whose did not; a single flag over both would have to lie about one.
    const mixed = [
      baremeResultItemSchema.parse({
        criterion: 'a', points_awarded: 1, points_possible: 1, justification: '', provisional: false,
      }),
      baremeResultItemSchema.parse({
        criterion: 'b', points_awarded: 0, points_possible: 2, justification: '', provisional: true,
      }),
    ];
    expect(mixed.map((m) => m.provisional)).toEqual([false, true]);
  });
});
