import { describe, expect, it } from 'vitest';

import { bag, decide, longestRun, overlap, words, type Ranked } from '../scripts/corpus/exercise-band-rules';

/*
 * These rules decide which printed exercise gets photographed and shown to a
 * student in place of text whose mathematics the PDF reader destroyed. Placing
 * a row on the wrong exercise is worse than leaving the flattened text there,
 * so both mistakes made while tuning them are pinned here rather than described
 * in a comment.
 */

const say = (s: string) => words(s);
const cand = (session: string, ordinal: number, text: string) => ({ session, ordinal, words: words(text) });
const rank = (rows: Array<[number, ReturnType<typeof cand>]>): Ranked[] =>
  rows.map(([score, candidate]) => ({ score, candidate }));

const CURVE =
  'Let f be the function defined over the interval by the curve and the line is an asymptote to the curve determine the limits and set up the table of variations of the function';
const TITRATION =
  'The aim of this exercise is to verify the indication of a tablet of vitamin C ascorbic acid noted as HA prepare a solution and titrate it with sodium hydroxide of known concentration';

describe('scoring the wording of a flattened row against a printed exercise', () => {
  it('does not let a long exercise swallow a short row', () => {
    // THE MISTAKE THAT LEFT 61 ROWS UNPLACEABLE: ranking on containment — how
    // much of the row appears in the candidate — gives a short row a perfect
    // 1.0 against anything that happens to include its few words, so dozens of
    // unrelated exercises tie at the top and none can be chosen.
    const row = bag(say('set up the table of variations'));
    const whole = bag(say(CURVE));
    const unrelated = bag(say(TITRATION));

    expect(overlap(row, whole)).toBeLessThan(1);
    expect(overlap(row, whole)).toBeGreaterThan(overlap(row, unrelated));
  });

  it('counts only the prose, because the symbols are mangled in both texts', () => {
    // The reader returns `2f(x) x lnx= +` where the paper prints `f(x) = x² + ln x`.
    // Neither spelling can be trusted, so neither may contribute to the score.
    expect(words('2f(x) x lnx= + and (C) its representative curve')).toEqual([
      'lnx', 'and', 'its', 'representative', 'curve',
    ]);
  });

  it('measures the shared run in order, not merely shared vocabulary', () => {
    const a = say('determine the limits and set up the table of variations');
    const sameWordsDifferentOrder = say('variations of the table set determine limits up and the');
    expect(longestRun(a, a)).toBe(a.length);
    expect(longestRun(a, sameWordsDifferentOrder)).toBeLessThan(a.length);
  });
});

describe('deciding whether a band is safe to put in front of a student', () => {
  it('accepts a clear winner', () => {
    const verdict = decide(say(CURVE), rank([
      [0.95, cand('2019 1', 3, CURVE)],
      [0.41, cand('2015 2', 1, TITRATION)],
    ]));
    expect(verdict.accept).toBe(true);
  });

  it('treats the same exercise reprinted as one candidate, not an ambiguity', () => {
    // LH and SE sit the same science paper, and every session also prints
    // accommodation editions. Identical scores there mean identical exercises,
    // and any of their bands shows the student the same printed page.
    const verdict = decide(say(CURVE), rank([
      [0.9, cand('2019 1', 3, CURVE)],
      [0.9, cand('2019 1', 3, CURVE)],
    ]));
    expect(verdict.accept).toBe(true);
    if (verdict.accept) expect(verdict.tied).toHaveLength(2);
  });

  it('does not wave a lone candidate past the gap test', () => {
    // THE FIRST TUNING MISTAKE. Accepting whenever the tied candidates agree
    // lets a single candidate through, because one candidate trivially agrees
    // with itself — so the runner-up is never looked at. Here the rival is
    // close behind AND shares as long a run, which is a real ambiguity.
    const rival = `${CURVE} and then draw the curve`;
    const verdict = decide(say(CURVE), rank([
      [0.6, cand('2008 2', 6, CURVE)],
      [0.55, cand('2013 1', 6, rival)],
    ]));
    expect(verdict.accept).toBe(false);
    if (!verdict.accept) expect(verdict.reason).toBe('ambiguous');
  });

  it('lets the anchor settle a close call the gap alone would throw away', () => {
    // THE SECOND TUNING MISTAKE. A row holding only part A of an exercise
    // scores badly against the whole of it: one verified maths row matched its
    // own paper at 0.55 with a 0.48 runner-up, and rejecting every close call
    // discarded a correct placement. A long run the rival cannot match settles
    // it, because the row's wording appears in that candidate in order.
    const partA = say(CURVE);
    const verdict = decide(partA, rank([
      [0.58, cand('2008 2', 6, `${CURVE} ${TITRATION}`)],
      [0.52, cand('2013 1', 6, 'the curve and the line')],
    ]));
    expect(verdict.accept).toBe(true);
    if (verdict.accept) expect(verdict.run).toBeGreaterThanOrEqual(12);
  });

  it('refuses a row whose wording is nowhere near the best candidate', () => {
    const verdict = decide(say(CURVE), rank([[0.44, cand('2015 2', 1, TITRATION)]]));
    expect(verdict.accept).toBe(false);
    if (!verdict.accept) expect(verdict.reason).toBe('no-match');
  });

  it('refuses when there is no candidate at all', () => {
    const verdict = decide(say(CURVE), []);
    expect(verdict.accept).toBe(false);
    if (!verdict.accept) expect(verdict.reason).toBe('no-match');
  });

  it('refuses a high score that rests on scattered words rather than a passage', () => {
    // Vocabulary alone is not evidence: two exercises about a curve and its
    // asymptote share almost every word. Without a run in order there is no
    // reason to believe it is the same passage.
    const row = say('curve asymptote table limits line interval function determine variations');
    const shuffled = 'table interval variations determine asymptote function line curve limits';
    const verdict = decide(row, rank([[0.92, cand('2019 1', 3, shuffled)]]));
    expect(longestRun(row, say(shuffled))).toBeLessThan(6);
    expect(verdict.accept).toBe(false);
    if (!verdict.accept) expect(verdict.reason).toBe('weak-anchor');
  });
});
