import { describe, expect, it } from 'vitest';

import { formatDuration } from '@/lib/exam-duration';

/**
 * How long a sitting runs, and whether that is the paper's own answer.
 *
 * `exam_cycles.duration_minutes` is `Int @default(180)` and the bulk corpus
 * loader never sets it, so every ingested official paper ran a three-hour
 * clock while being described as sat exactly as it was printed. Lebanese Bac
 * Mathematics SG is four hours. The column could not tell a paper we knew ran
 * 180 minutes from one nobody had recorded, which is why
 * `duration_is_official` exists.
 */

const EN = {
  hours: '{hours}h',
  hoursMinutes: '{hours}h {minutes}',
  minutesOnly: '{minutes} min',
};

describe('formatting a sitting length', () => {
  it('reads a whole number of hours as hours', () => {
    expect(formatDuration(240, EN)).toBe('4h');
    expect(formatDuration(180, EN)).toBe('3h');
  });

  it('pads the minutes so a clock does not read "3h 5"', () => {
    expect(formatDuration(185, EN)).toBe('3h 05');
    expect(formatDuration(210, EN)).toBe('3h 30');
  });

  it('drops the hour when there is not one', () => {
    expect(formatDuration(45, EN)).toBe('45 min');
  });

  it('never goes negative', () => {
    expect(formatDuration(-10, EN)).toBe('0 min');
  });

  it('takes its words from the dictionary rather than hardcoding them', () => {
    // The Arabic reading is not "4h". The template is the whole point.
    const ar = { hours: '{hours} ساعة', hoursMinutes: '{hours} ساعة و{minutes} دقيقة', minutesOnly: '{minutes} دقيقة' };
    expect(formatDuration(240, ar)).toBe('4 ساعة');
    expect(formatDuration(45, ar)).toBe('45 دقيقة');
  });
});

/**
 * The rule the sitting applies. Kept here as a plain function so the decision
 * is testable without a database or a React tree — it is three lines in the
 * page, and it is the difference between a true claim and a false one.
 */
function clockIsThePapers(input: {
  sourceMode: 'real_cycle' | 'real_mixed' | 'ai_generated';
  cycleDurationIsOfficial: boolean | null;
}): boolean {
  if (input.sourceMode !== 'real_cycle') return true;
  return input.cycleDurationIsOfficial ?? false;
}

describe('whether the clock may be called the paper’s own', () => {
  it('says no for an official paper whose duration nobody recorded', () => {
    // The case that was live: every corpus-loaded cycle.
    expect(clockIsThePapers({ sourceMode: 'real_cycle', cycleDurationIsOfficial: false })).toBe(
      false,
    );
  });

  it('says yes for an official paper ingested with an explicit duration', () => {
    expect(clockIsThePapers({ sourceMode: 'real_cycle', cycleDurationIsOfficial: true })).toBe(true);
  });

  it('says yes for a composed mock, which has no printed paper to contradict', () => {
    /*
     * A mock assembled from past-exam questions was never printed as a paper,
     * so our length IS its length. Marking it "standard sitting" would imply a
     * missing official duration that does not exist to be missing.
     */
    expect(clockIsThePapers({ sourceMode: 'real_mixed', cycleDurationIsOfficial: null })).toBe(true);
    expect(clockIsThePapers({ sourceMode: 'ai_generated', cycleDurationIsOfficial: null })).toBe(
      true,
    );
  });

  it('treats a missing cycle on a real_cycle sitting as not official', () => {
    // `examCycleId` is nullable and set null on delete. Absence is not evidence.
    expect(clockIsThePapers({ sourceMode: 'real_cycle', cycleDurationIsOfficial: null })).toBe(
      false,
    );
  });
});
