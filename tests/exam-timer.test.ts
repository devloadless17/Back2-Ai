import { describe, expect, it } from 'vitest';

import { secondsUntil } from '@/lib/exam-timer';

describe('exam countdown deadline', () => {
  it('catches up by the full elapsed time after a throttled background interval', () => {
    const deadline = Date.parse('2026-09-30T12:10:00.000Z');
    const afterBackgrounding = Date.parse('2026-09-30T12:07:37.400Z');
    expect(secondsUntil(deadline, afterBackgrounding)).toBe(143);
  });

  it('never displays negative time after expiry', () => {
    expect(secondsUntil(1_000, 1_001)).toBe(0);
  });

  it('rounds up a partial final second instead of showing zero early', () => {
    expect(secondsUntil(1_001, 1_000)).toBe(1);
  });
});
