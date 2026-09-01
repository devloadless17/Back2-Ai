import { describe, expect, it } from 'vitest';

import { rescaleArithmetically } from '@/lib/rescale-bareme';
import { baremeMaxScore, type Bareme } from '@/lib/grading';

/**
 * Putting an assembled paper back on the Bac's scale.
 *
 * The arithmetic path, which is what runs when no model is configured and
 * whenever the model's answer fails its checks. It has one property that must
 * hold every time — the paper totals exactly the target — because every figure
 * downstream of it is expressed out of 20.
 */

const total = (bs: Bareme[]) => Math.round(bs.reduce((n, b) => n + baremeMaxScore(b), 0) * 100) / 100;

const ex = (...points: number[]): Bareme =>
  points.map((p, i) => ({ criterion: `c${i}`, points: p }));

describe('rescaleArithmetically', () => {
  it('brings a paper that is over the target down to it exactly', () => {
    const paper = [ex(6, 6), ex(5, 5)]; // 22
    expect(total(rescaleArithmetically(paper, 20))).toBe(20);
  });

  it('brings a paper that is under the target up to it exactly', () => {
    const paper = [ex(4, 3), ex(5, 5)]; // 17
    expect(total(rescaleArithmetically(paper, 20))).toBe(20);
  });

  it('leaves a paper that is already right alone in total', () => {
    const paper = [ex(10), ex(6), ex(4)];
    expect(total(rescaleArithmetically(paper, 20))).toBe(20);
  });

  it('keeps every criterion, in order, with its wording untouched', () => {
    const paper = [ex(6, 6), ex(5, 5)];
    const out = rescaleArithmetically(paper, 20);
    expect(out.map((b) => b.map((c) => c.criterion))).toEqual(
      paper.map((b) => b.map((c) => c.criterion)),
    );
  });

  it('never leaves a criterion worth nothing', () => {
    // A tiny criterion inside a heavy paper rounds toward zero without a floor,
    // which would tell the marker to assess something worth no marks.
    const paper = [ex(40, 0.5), ex(40)];
    const out = rescaleArithmetically(paper, 20);
    expect(out.flat().every((c) => c.points > 0)).toBe(true);
    expect(total(out)).toBe(20);
  });

  it('uses half marks, the way these papers are printed', () => {
    const paper = [ex(7, 7), ex(7)]; // 21 -> awkward factor
    const out = rescaleArithmetically(paper, 20);
    expect(out.flat().every((c) => Math.round(c.points * 2) === c.points * 2)).toBe(true);
    expect(total(out)).toBe(20);
  });

  it('keeps the heavier exercise heavier', () => {
    const paper = [ex(12), ex(6)]; // 18, 2:1
    const out = rescaleArithmetically(paper, 20);
    expect(baremeMaxScore(out[0]!)).toBeGreaterThan(baremeMaxScore(out[1]!));
    expect(total(out)).toBe(20);
  });

  it('hits the target across a spread of awkward starting totals', () => {
    for (const marks of [[3, 4], [5, 5, 5], [9, 9], [1, 1, 1], [13, 11], [2, 3, 4, 5]]) {
      const paper = marks.map((m) => ex(m));
      expect(total(rescaleArithmetically(paper, 20))).toBe(20);
    }
  });
});
