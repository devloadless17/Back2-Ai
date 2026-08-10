import { describe, expect, it } from 'vitest';

import { answerTextOf, tallyMarks } from '@/lib/exam';

/**
 * These two functions decide what a student is marked on and what mark they
 * end up with. Both encode rules that fail silently and plausibly if broken:
 * a wrong total still looks like a total.
 */

describe('answerTextOf', () => {
  it('uses the typed answer when there is one', () => {
    expect(
      answerTextOf({ typedAnswer: 'x = 4', ocrExtractedText: null, ocrConsistencyPassed: null }),
    ).toBe('x = 4');
  });

  it('uses the transcription when the photo passed the consistency gate', () => {
    expect(
      answerTextOf({ typedAnswer: null, ocrExtractedText: 'x = 4', ocrConsistencyPassed: true }),
    ).toBe('x = 4');
  });

  it('discards a transcription that FAILED the gate rather than marking noise', () => {
    // The student was told to re-shoot during the sitting. If they never did,
    // this is an unsubmitted answer — not an answer worth zero for being blurry.
    expect(
      answerTextOf({ typedAnswer: null, ocrExtractedText: 'x=?? |||', ocrConsistencyPassed: false }),
    ).toBe('');
  });

  it('prefers the photo path once a photo exists, even alongside stale typed text', () => {
    // saveAnswer nulls the other field on switch; this guards the ordering if
    // that ever stops being true.
    expect(
      answerTextOf({ typedAnswer: 'old draft', ocrExtractedText: 'x = 4', ocrConsistencyPassed: true }),
    ).toBe('x = 4');
  });

  it('treats a missing answer as empty, not as an error', () => {
    expect(answerTextOf(null)).toBe('');
  });
});

describe('tallyMarks', () => {
  it('totals a fully marked paper', () => {
    expect(
      tallyMarks([
        { status: 'graded', totalScore: 8, maxScore: 10 },
        { status: 'graded', totalScore: 5, maxScore: 10 },
      ]),
    ).toEqual({ totalScore: 13, maxScore: 20, unmarked: 0 });
  });

  it('excludes an unmarkable question from BOTH sides of the fraction', () => {
    // Counting it 0/10 would report our outage as the student's failure.
    const result = tallyMarks([
      { status: 'graded', totalScore: 8, maxScore: 10 },
      { status: 'needs_human_review', totalScore: 0, maxScore: 10 },
    ]);

    expect(result).toEqual({ totalScore: 8, maxScore: 10, unmarked: 1 });
  });

  it('reports an entirely unmarkable paper as 0/0, not 0/20', () => {
    const result = tallyMarks([
      { status: 'needs_human_review', totalScore: 0, maxScore: 10 },
      { status: 'needs_human_review', totalScore: 0, maxScore: 10 },
    ]);

    // maxScore 0 is what the results screen keys off to say "awaiting marking"
    // instead of rendering a fail.
    expect(result.maxScore).toBe(0);
    expect(result.unmarked).toBe(2);
  });

  it('keeps a legitimate zero as a zero', () => {
    // A blank answer IS marked, and it IS zero. Only marking *failures* are
    // withheld — otherwise not answering would quietly stop counting.
    const result = tallyMarks([{ status: 'graded', totalScore: 0, maxScore: 10 }]);

    expect(result).toEqual({ totalScore: 0, maxScore: 10, unmarked: 0 });
  });

  it('does not accumulate floating-point noise across half marks', () => {
    const result = tallyMarks(
      Array.from({ length: 10 }, () => ({ status: 'graded' as const, totalScore: 0.1, maxScore: 0.5 })),
    );

    expect(result.totalScore).toBe(1);
    expect(result.maxScore).toBe(5);
  });

  it('handles an empty paper', () => {
    expect(tallyMarks([])).toEqual({ totalScore: 0, maxScore: 0, unmarked: 0 });
  });
});
