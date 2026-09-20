import { describe, expect, it } from 'vitest';

import { visualEvidenceState } from '@/lib/chat';

/**
 * Which of three things the answer actually has to look at.
 *
 * WHY THIS EXISTS. The condition this replaces collapsed "the figure is
 * attached" into "somebody wrote down what the figure showed". They are not the
 * same, and the gap was invisible exactly when it mattered: a student
 * photographs a page, the transcription carries `[figure: …]`, the photo then
 * fails to load — and the missing-visual notice was suppressed because a
 * description existed. The model answered from prose about a picture, and
 * nothing said it had never seen the picture.
 *
 * The `[figure: …]` strings below are the real marker `transcribeImage` is
 * instructed to emit, not an invented one.
 */

const DESCRIBED =
  'Study the resonance curve. [figure: curve peaks near 10000 rad/s at about 40 W, ' +
  'with point S(5000; 13)] Determine the resonance frequency.';

const PLAIN_REFERENCE =
  'The adjacent figure represents an RLC circuit. Determine the impedance.';

describe('A — the original visual is attached', () => {
  it('is "attached" when an image is in the request', () => {
    expect(visualEvidenceState(true, PLAIN_REFERENCE)).toBe('attached');
  });

  it('stays "attached" even when a description is also present', () => {
    // Both together is the ordinary photo case: the page is attached AND its
    // transcription mentions the figure. The image wins — it is the better
    // evidence, and the model should not be told to hedge.
    expect(visualEvidenceState(true, DESCRIBED)).toBe('attached');
  });
});

describe('B — no image, but a transcription of one', () => {
  it('is "described-only", not "attached"', () => {
    expect(visualEvidenceState(false, DESCRIBED)).toBe('described-only');
  });

  it('is the state reached when an uploaded photo fails to load', () => {
    // This is the exact bug: images empty because the load failed, description
    // present because OCR ran before the failure. It must not read as
    // "attached", and it must not read as "absent" either — the description is
    // real evidence and refusing outright would throw it away.
    expect(visualEvidenceState(false, DESCRIBED)).not.toBe('attached');
    expect(visualEvidenceState(false, DESCRIBED)).not.toBe('absent');
  });
});

describe('C — neither image nor description', () => {
  it('is "absent" for a bare reference to a figure', () => {
    expect(visualEvidenceState(false, PLAIN_REFERENCE)).toBe('absent');
  });

  it('is "absent" when the question mentions a figure only in prose', () => {
    // Ordinary wording must not be mistaken for a transcription. Only the
    // bracketed OCR marker counts as a description.
    expect(visualEvidenceState(false, 'Using document 2 and the diagram below, explain.')).toBe(
      'absent',
    );
    expect(visualEvidenceState(false, 'Refer to figure 3 of the paper.')).toBe('absent');
  });

  it('is "absent" when the page was unreadable rather than described', () => {
    // `[illegible]` is what OCR writes where it could not read — precisely when
    // the student does need telling that something is missing.
    expect(visualEvidenceState(false, 'Study the curve. [illegible] Find the peak.')).toBe('absent');
  });

  it('is "absent" for a description stub too short to carry anything', () => {
    expect(visualEvidenceState(false, 'Study the curve. [figure: ab] Find the peak.')).toBe(
      'absent',
    );
  });
});
