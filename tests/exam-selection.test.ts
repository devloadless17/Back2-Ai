import { describe, expect, it } from 'vitest';

import { assemblePaper, chooseQuestions } from '@/lib/exam';

/**
 * What a generated paper is allowed to contain.
 *
 * This rule decides how a candidate's marks are spread across the syllabus, and
 * it fails silently: a paper that draws half its marks from one chapter is
 * still a paper, still marks correctly, and still looks right on screen. The
 * only symptom is a student whose result depended on which single topic they
 * happened to revise.
 */

/** A twelve-mark exercise, the kind that carries a quarter of a paper. */
const large = (id: string, chapterId: string) => ({
  id,
  chapterId,
  difficulty: 0.5,
  bareme: [
    { criterion: 'a', points: 6 },
    { criterion: 'b', points: 6 },
  ],
});

/** A three-mark question, cheap enough that two from one chapter cost little. */
const small = (id: string, chapterId: string) => ({
  id,
  chapterId,
  difficulty: 0.5,
  bareme: [{ criterion: 'a', points: 3 }],
});

describe('chooseQuestions', () => {
  it('takes one question per chapter while it can', () => {
    const chosen = chooseQuestions(
      [large('1', 'ch-a'), large('2', 'ch-b'), large('3', 'ch-c')],
      3,
    );
    expect(chosen.map((c) => c.chapterId)).toEqual(['ch-a', 'ch-b', 'ch-c']);
  });

  it('never takes a second large exercise from a chapter that already has one', () => {
    // Only two chapters exist, and both offer two big exercises. A five-slot
    // paper cannot be filled without breaking the rule, so it must not be.
    const chosen = chooseQuestions(
      [large('1', 'ch-a'), large('2', 'ch-a'), large('3', 'ch-b'), large('4', 'ch-b')],
      5,
    );

    expect(chosen).toHaveLength(2);
    expect(new Set(chosen.map((c) => c.chapterId)).size).toBe(2);
  });

  it('returns a shorter paper rather than doubling up a chapter on marks', () => {
    const chosen = chooseQuestions([large('1', 'ch-a'), large('2', 'ch-a')], 4);
    expect(chosen).toHaveLength(1);
  });

  it('still lets small questions double up, because they do not decide a paper', () => {
    const chosen = chooseQuestions(
      [small('1', 'ch-a'), small('2', 'ch-a'), small('3', 'ch-a')],
      3,
    );
    expect(chosen).toHaveLength(3);
  });

  it('allows a small question from a chapter that already gave a large one', () => {
    const chosen = chooseQuestions([large('1', 'ch-a'), small('2', 'ch-a')], 2);
    expect(chosen.map((c) => c.id)).toEqual(['1', '2']);
  });

  it('prefers a new chapter over topping up an old one', () => {
    // 'ch-a' comes first in the pool twice over, but the second slot must go to
    // the chapter that has nothing yet.
    const chosen = chooseQuestions(
      [small('1', 'ch-a'), small('2', 'ch-a'), small('3', 'ch-b')],
      2,
    );
    expect(chosen.map((c) => c.chapterId)).toEqual(['ch-a', 'ch-b']);
  });

  it('measures size by the barème, not by how long the text is', () => {
    // A terse question carrying half the paper is large; a wordy three-mark one
    // is not. Length would get both backwards.
    const terseButHeavy = { ...large('1', 'ch-a'), contentText: 'Résoudre.' };
    const wordyButLight = { ...small('2', 'ch-a'), contentText: 'x'.repeat(4000) };

    const chosen = chooseQuestions([terseButHeavy, { ...large('3', 'ch-a') }], 2);
    expect(chosen).toHaveLength(1); // the second large one is refused

    const both = chooseQuestions([terseButHeavy, wordyButLight], 2);
    expect(both).toHaveLength(2); // a small one alongside it is fine
  });

  it('falls back to length when a problem carries no barème', () => {
    const noBareme = { id: '1', chapterId: 'ch-a', difficulty: 0.5, bareme: null, contentText: 'x'.repeat(2500) };
    const another = { id: '2', chapterId: 'ch-a', difficulty: 0.5, bareme: null, contentText: 'x'.repeat(2500) };

    // ~10 marks each by the length fallback, so the second is refused.
    expect(chooseQuestions([noBareme, another], 2)).toHaveLength(1);
  });

  it('returns nothing from an empty pool rather than throwing', () => {
    expect(chooseQuestions([], 5)).toEqual([]);
  });
});

/**
 * What a paper adds up to.
 *
 * A Lebanese Bac paper is marked out of 20 — 396 of the official papers in this
 * corpus total exactly that. Every figure in the product is on that scale, so a
 * paper totalling anything else quietly feeds a different unit into the
 * predicted mark, readiness and the dashboard. `14 / 22` is not a Bac mark.
 */
describe('assemblePaper', () => {
  const q = (id: string, chapterId: string, marks: number) => ({
    id,
    chapterId,
    difficulty: 0.5,
    bareme: [{ criterion: 'a', points: marks }],
  });

  it('hits the target exactly', () => {
    const paper = assemblePaper(
      [q('1', 'a', 6), q('2', 'b', 5), q('3', 'c', 4), q('4', 'd', 5), q('5', 'e', 7)],
      20,
    );
    expect(paper.reduce((n, p) => n + Number(p.bareme[0]?.points ?? 0), 0)).toBe(20);
  });

  it('returns nothing rather than a paper worth the wrong amount', () => {
    // 7 + 7 + 7 = 21, 7 + 7 = 14. No subset reaches 20.
    expect(assemblePaper([q('1', 'a', 7), q('2', 'b', 7), q('3', 'c', 7)], 20)).toEqual([]);
  });

  it('refuses twenty reached as too many tiny questions', () => {
    // Twenty 1-mark questions total 20 and are not a paper.
    const tiny = Array.from({ length: 20 }, (_, i) => q(String(i), `ch-${i}`, 1));
    expect(assemblePaper(tiny, 20)).toEqual([]);
  });

  it('refuses twenty reached as too few', () => {
    // 10 + 10 is the right total in two exercises; a paper has at least three.
    expect(assemblePaper([q('1', 'a', 10), q('2', 'b', 10)], 20)).toEqual([]);
  });

  it('still never takes two large exercises from one chapter', () => {
    // 10 + 10 from one chapter would total 20 but doubles up the marks.
    // 10 + 6 + 4 across three chapters is the honest answer.
    const paper = assemblePaper(
      [q('1', 'a', 10), q('2', 'a', 10), q('3', 'b', 6), q('4', 'c', 4)],
      20,
    );
    expect(paper.map((p) => p.id)).toEqual(['1', '3', '4']);
  });

  it('honours the order it is given, so the caller can prefer unseen questions', () => {
    const first = assemblePaper([q('1', 'a', 5), q('2', 'b', 5), q('3', 'c', 10), q('4', 'd', 10)], 20);
    expect(first.map((p) => p.id)).toEqual(['1', '2', '3']);
  });

  it('ignores questions with no marks, which cannot be marked', () => {
    const unmarkable = { id: 'x', chapterId: 'z', difficulty: 0.5, bareme: [] };
    const paper = assemblePaper([unmarkable, q('1', 'a', 6), q('2', 'b', 7), q('3', 'c', 7)], 20);
    expect(paper.map((p) => p.id)).toEqual(['1', '2', '3']);
  });
});
