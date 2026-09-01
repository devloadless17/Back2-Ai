import { describe, expect, it } from 'vitest';

import { exerciseKey, schemeFor, type Sidecar } from '../scripts/corpus/scheme-sidecars';

/**
 * The paper these rows come from is `gs/2005 1/gs math_fr 1.pdf`, checked by eye
 * against the printed page: exercise Q1 runs 1, 2a, 2b, 2c, 3 at 1, 1, ½, 1, 1½,
 * and its scheme is printed on twice the paper's scale.
 */
function gsMathsSidecar(overrides: Partial<Sidecar> = {}): Sidecar {
  return {
    path: 'gs/2005 1/gs math_fr 1.pdf',
    sha256: 'abc123',
    subject: 'maths',
    track: 'GS',
    scaleRatio: 2,
    illegible: false,
    rows: [
      { exercise: '1', label: '1', answer: 'The equation of plane (P)...', marks: 1 },
      { exercise: '1', label: '2a', answer: '$\\vec{V}_d(1,1,-1)$...', marks: 1 },
      { exercise: '1', label: '2b', answer: '$\\overrightarrow{HA}$...', marks: 0.5 },
      { exercise: '1', label: '2c', answer: 'HAB is isosceles...', marks: 1 },
      { exercise: '1', label: '3', answer: '$V(MABC)$...', marks: 1.5 },
      { exercise: '2', label: '1', answer: '$U_0=\\ln 2$', marks: 1 },
      { exercise: '2', label: '3b', answer: 'Since the limit is 0...', marks: 0.5 },
    ],
    ...overrides,
  };
}

describe('exerciseKey', () => {
  it('reads the numbering a Lebanese paper actually uses', () => {
    expect(exerciseKey('Q 1')).toBe('1');
    expect(exerciseKey('Q1')).toBe('1');
    expect(exerciseKey('2')).toBe('2');
    expect(exerciseKey('Exercise II')).toBe('2');
    expect(exerciseKey('التمرين الأول')).toBe('1');
    expect(exerciseKey('التمرين الثالث')).toBe('3');
  });

  it('prefers a printed digit to a roman numeral in the same token', () => {
    // "Exercise 2" must not be read as the V/I letters that happen to appear.
    expect(exerciseKey('Exercise 2')).toBe('2');
  });
});

describe('schemeFor', () => {
  it('puts the marks back on the paper scale, not the scheme scale', () => {
    const result = schemeFor(gsMathsSidecar(), 1, 0)!;

    // The scheme prints 1 / 1 / ½ / 1 / 1½ = 5 on a x2 scale, so the exercise
    // is worth 2.5 to the student. Storing it raw would double every mark.
    expect(result.bareme.map((c) => c.points)).toEqual([0.5, 0.5, 0.25, 0.5, 0.75]);
    expect(result.bareme.reduce((a, c) => a + c.points, 0)).toBeCloseTo(2.5, 5);
  });

  it('leaves a x1 scheme alone', () => {
    const result = schemeFor(gsMathsSidecar({ scaleRatio: 1 }), 1, 0)!;
    expect(result.bareme.map((c) => c.points)).toEqual([1, 1, 0.5, 1, 1.5]);
  });

  it('gives one criterion per part rather than one for the whole exercise', () => {
    const result = schemeFor(gsMathsSidecar(), 1, 0)!;
    expect(result.bareme).toHaveLength(5);
    expect(result.bareme[0]!.criterion).toContain('1 The equation of plane');
    expect(result.bareme[2]!.criterion).toContain('2b');
  });

  it('only returns the rows belonging to the exercise asked for', () => {
    const result = schemeFor(gsMathsSidecar(), 2, 1)!;
    expect(result.bareme).toHaveLength(2);
    expect(result.solution).toContain('$U_0=\\ln 2$');
    expect(result.solution).not.toContain('isosceles');
  });

  it('returns null for an exercise the scheme does not cover', () => {
    expect(schemeFor(gsMathsSidecar(), 7, 6)).toBeNull();
  });

  it('refuses an exercise the reader could not reconcile, even if rows survive', () => {
    const sidecar = gsMathsSidecar({ droppedExercises: ['2'] });
    expect(schemeFor(sidecar, 2, 1)).toBeNull();
    // ...and the exercises that did reconcile are unaffected.
    expect(schemeFor(sidecar, 1, 0)).not.toBeNull();
  });

  it('keeps an unmarked row in the solution but out of the barème', () => {
    const sidecar = gsMathsSidecar({
      scaleRatio: 1,
      rows: [
        { exercise: '1', label: '1', answer: 'First step', marks: 2 },
        { exercise: '1', label: '2', answer: 'A step the scheme did not mark', marks: null },
      ],
    });
    const result = schemeFor(sidecar, 1, 0)!;
    expect(result.bareme).toHaveLength(1);
    expect(result.solution).toContain('A step the scheme did not mark');
  });

  it('falls back to nothing when a scheme carries neither marks nor answers', () => {
    const sidecar = gsMathsSidecar({
      rows: [{ exercise: '1', label: '1', answer: '   ', marks: null }],
    });
    expect(schemeFor(sidecar, 1, 0)).toBeNull();
  });

  it('survives a scaleRatio that was never measured', () => {
    // A hand-edited or older sidecar. Treating 0 as a divisor would produce
    // Infinity marks; treating it as 1 stores the scheme as printed, which is
    // wrong only if the paper was scaled — and is at least a real number.
    const result = schemeFor(gsMathsSidecar({ scaleRatio: 0 }), 1, 0)!;
    expect(result.bareme.every((c) => Number.isFinite(c.points))).toBe(true);
  });
});
