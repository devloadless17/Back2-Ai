import { describe, expect, it } from 'vitest';

import { isLiveSitting } from '@/lib/exam';

/**
 * Whether a paper is actually under way.
 *
 * `status` alone was the test on the exam index, and it is the wrong one: a
 * sitting whose deadline has passed keeps `in_progress` until the sweep
 * reaches it. So the page hid "new simulation" and offered Resume against a
 * timer reading zero — while `startSimulation` would have accepted a new paper
 * quite happily, auto-submitting the stale one first.
 *
 * The UI was withholding an action the server allowed, which is the same class
 * of fault as offering one it refuses. One rule, in one place, for both.
 */

const at = (iso: string) => new Date(iso);
const now = at('2026-09-18T12:00:00.000Z');

describe('a live sitting', () => {
  it('is in progress and not yet expired', () => {
    expect(
      isLiveSitting({ status: 'in_progress', expiresAt: at('2026-09-18T13:00:00.000Z') }, now),
    ).toBe(true);
  });

  it('is NOT live once the deadline has passed, whatever the status still says', () => {
    // The case that was wrong. The sweep has not run, so the row still reads
    // `in_progress`, and the student is entitled to start a new paper.
    expect(
      isLiveSitting({ status: 'in_progress', expiresAt: at('2026-09-18T11:00:00.000Z') }, now),
    ).toBe(false);
  });

  it('is not live at the exact moment of expiry', () => {
    expect(
      isLiveSitting({ status: 'in_progress', expiresAt: at('2026-09-18T12:00:00.000Z') }, now),
    ).toBe(false);
  });

  it('is not live once submitted or graded', () => {
    const future = at('2026-09-18T13:00:00.000Z');
    expect(isLiveSitting({ status: 'submitted', expiresAt: future }, now)).toBe(false);
    expect(isLiveSitting({ status: 'graded', expiresAt: future }, now)).toBe(false);
  });

  it('treats no sitting at all as not live', () => {
    expect(isLiveSitting(null, now)).toBe(false);
  });
});

describe('the rule matches what starting a paper does', () => {
  it('blocks a new paper exactly when the server would refuse one', () => {
    /*
     * `startSimulation` throws IN_PROGRESS_EXISTS only when
     * `existing.expiresAt.getTime() > Date.now()`. That is this predicate, and
     * pinning it here is what stops the two drifting apart again.
     */
    const live = { status: 'in_progress', expiresAt: at('2026-09-18T12:00:01.000Z') };
    const stale = { status: 'in_progress', expiresAt: at('2026-09-18T11:59:59.000Z') };

    expect(isLiveSitting(live, now)).toBe(true);
    expect(isLiveSitting(stale, now)).toBe(false);
  });
});
