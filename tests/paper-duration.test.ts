import { describe, expect, it } from 'vitest';

import { paperDuration, STANDARD_EXAM_MINUTES } from '@/lib/exam-duration';

describe('how long a paper is sat for', () => {
  it("uses the subject's length when the paper has none of its own", () => {
    expect(paperDuration({ durationMinutes: 180, durationIsOfficial: false }, 120)).toEqual({
      minutes: 120,
      official: true,
      source: 'subject',
    });
  });

  it("keeps a paper's own confirmed length over the subject's", () => {
    expect(paperDuration({ durationMinutes: 150, durationIsOfficial: true }, 120).minutes).toBe(150);
  });

  it('falls back to the standard length, and says so, when neither is set', () => {
    expect(paperDuration({ durationMinutes: 180, durationIsOfficial: false }, null)).toEqual({
      minutes: STANDARD_EXAM_MINUTES,
      official: false,
      source: 'standard',
    });
  });

  it('uses the subject length for a paper put together from several', () => {
    expect(paperDuration(null, 240).minutes).toBe(240);
  });
});
