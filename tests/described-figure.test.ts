import { describe, expect, it } from 'vitest';

import { hasDescribedFigure, missingVisual } from '@/lib/question-kind';

/**
 * "still" — 2026-09-20, third report of the same screen.
 *
 * A student photographed a physics problem. OCR transcribed it, including
 * `[figure: graph of P_av (W) versus w (rad/s), curve peaks near 10000 rad/s at
 * about 40 W, with point S(5000; 13)]` — every number the last three parts of
 * the question need. The tutor opened by saying it did not have the figure.
 *
 * The claim was false and it cost the student the answer. Storage is a
 * separate failure (the photo itself never persists, so nothing is attached),
 * but the description alone is enough here, and the notice must not fire over
 * a transcript that contains one.
 */

const TRANSCRIBED = `d) The adjacent graph represents the variation of P_av as a function of w.
[figure: graph of P_av (W) versus w (rad/s), curve peaks near 10000 rad/s at about 40 W, with point S(5000; 13)]
i. Refer to the graph to indicate the value of the proper frequency w_o.
ii. Prove that R = 10 ohms.`;

describe('a figure that has been described in words', () => {
  it('is recognised in a transcribed page', () => {
    expect(hasDescribedFigure(TRANSCRIBED)).toBe(true);
  });

  it('is recognised however the transcriber spaces it', () => {
    expect(hasDescribedFigure('[figure: a titration curve]')).toBe(true);
    expect(hasDescribedFigure('[Figure : a labelled cell diagram]')).toBe(true);
  });

  it('is not claimed for a page whose figure could not be read', () => {
    // OCR writes [illegible] where it failed. That is exactly when the student
    // does need telling that something is missing.
    expect(hasDescribedFigure('The adjacent circuit includes: [illegible]')).toBe(false);
  });

  it('is not claimed for an empty or stub bracket', () => {
    expect(hasDescribedFigure('[figure:]')).toBe(false);
    expect(hasDescribedFigure('[figure: ab]')).toBe(false);
  });

  it('is not claimed for ordinary prose mentioning a figure', () => {
    expect(hasDescribedFigure('Refer to the figure above to find the frequency.')).toBe(false);
    expect(hasDescribedFigure('')).toBe(false);
  });
});

/**
 * The two work together and neither replaces the other.
 *
 * `missingVisual` still fires — the question genuinely points at a figure, and
 * that fact is what drives attaching an image when one exists. What changes is
 * whether the student is TOLD the figure is unavailable.
 */
describe('detection and the notice are separate decisions', () => {
  it('still detects that the question points at a figure', () => {
    expect(missingVisual(TRANSCRIBED)).toBeTruthy();
  });

  it('but the page carries the description, so nothing is missing', () => {
    expect(hasDescribedFigure(TRANSCRIBED)).toBe(true);
  });

  it('a corpus question with no description is still a genuine gap', () => {
    const corpus = 'The results are shown in document 1. Describe the stages represented.';
    expect(missingVisual(corpus)).toBeTruthy();
    expect(hasDescribedFigure(corpus)).toBe(false);
  });
});
