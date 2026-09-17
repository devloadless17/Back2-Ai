import { describe, expect, it } from 'vitest';

import { destinationFor } from '@/components/schedule/plan-today';
import { RECONCILE_WINDOW_HOURS, countWithin, startOfTodayBeirut } from '@/lib/queries/plan';
import { todosRedirectTarget } from '@/lib/todos-redirect';

/**
 * The planning page's two honest claims.
 *
 * Completing a session used to mean nothing at all: `status = done` had no
 * link to any attempt and no effect on mastery or readiness, so a student
 * could tick "Maths — Integrals, quiz, 30 min" without answering a question
 * and the product would have no idea. It still records what the student says.
 * What is new is that it also records what we actually saw, and the two are
 * never presented as the same fact.
 */

const at = (iso: string) => new Date(iso);

describe('reconciling a completed session against real answers', () => {
  const tuesday = at('2026-05-12T00:00:00.000Z');

  it('counts answers marked on the day itself', () => {
    const times = [at('2026-05-12T14:20:00.000Z'), at('2026-05-12T14:45:00.000Z')];
    expect(countWithin(times, tuesday, RECONCILE_WINDOW_HOURS)).toBe(2);
  });

  it('counts evening work that lands on the next UTC day', () => {
    /*
     * The reason the window is not one day. Sessions carry a DATE and no time
     * of day at all, and attempts are timestamps, so a student working late on
     * Tuesday and one working on Wednesday morning are both doing Tuesday's
     * session. A narrower window would tell them their own work was not
     * recorded.
     */
    expect(countWithin([at('2026-05-12T20:30:00.000Z')], tuesday, RECONCILE_WINDOW_HOURS)).toBe(1);
    expect(countWithin([at('2026-05-13T09:00:00.000Z')], tuesday, RECONCILE_WINDOW_HOURS)).toBe(1);
  });

  it('stops at the window rather than sweeping up later work', () => {
    // Answers three days later are their own study, not evidence for Tuesday.
    expect(countWithin([at('2026-05-15T09:00:00.000Z')], tuesday, RECONCILE_WINDOW_HOURS)).toBe(0);
  });

  it('does not count work done before the session was due', () => {
    expect(countWithin([at('2026-05-11T23:59:00.000Z')], tuesday, RECONCILE_WINDOW_HOURS)).toBe(0);
  });

  it('reports zero rather than nothing when it looked and found none', () => {
    // Zero is a real answer: we checked this chapter and saw no answers. The
    // UI must not read it the same way as "this session has no chapter, so
    // there was nothing to check" — that case is null.
    expect(countWithin([], tuesday, RECONCILE_WINDOW_HOURS)).toBe(0);
  });
});

describe('the day the plan is laid out against', () => {
  it('is the current Beirut day, encoded as a stored DATE', () => {
    expect(startOfTodayBeirut(at('2026-05-12T21:45:00.000Z')).toISOString()).toBe(
      '2026-05-13T00:00:00.000Z',
    );
  });

  it('shows TOMORROW once Beirut has passed midnight and UTC has not', () => {
    /*
     * This is the regression. 22:30Z on Tuesday is 01:30 Wednesday in Beirut,
     * and the plan used to answer Tuesday — a student revising after midnight
     * was handed the previous day's sessions. `src/lib/calendar.ts` now owns
     * the decision and every caller of it inherited the fix.
     */
    const afterMidnightInBeirut = at('2026-05-12T22:30:00.000Z');
    expect(startOfTodayBeirut(afterMidnightInBeirut).toISOString().slice(0, 10)).toBe('2026-05-13');
  });

  it('still agrees with UTC in the middle of the day', () => {
    expect(startOfTodayBeirut(at('2026-05-12T09:00:00.000Z')).toISOString().slice(0, 10)).toBe(
      '2026-05-12',
    );
  });
});

describe('where a planned session sends the student', () => {
  it('sends a quiz to its own chapter when the chapter is known', () => {
    expect(
      destinationFor({ taskType: 'quiz', chapterId: 'ch-1', subjectId: 'sub-1' }),
    ).toBe('/practice/sub-1/ch-1');
  });

  it('falls back to the practice index only when there is no chapter', () => {
    // A hand-written "revise integration" with nothing linked. The fallback is
    // a real page, not a dead button.
    expect(destinationFor({ taskType: 'quiz', chapterId: null, subjectId: null })).toBe('/practice');
  });

  it('sends flashcards and drills to their own real routes', () => {
    expect(
      destinationFor({ taskType: 'flashcards', chapterId: 'ch-1', subjectId: 'sub-1' }),
    ).toBe('/flashcards/review');
    expect(
      destinationFor({ taskType: 'exam_drill', chapterId: 'ch-1', subjectId: 'sub-1' }),
    ).toBe('/exam-sim');
  });

  it('has a destination for a session with no task type at all', () => {
    expect(destinationFor({ taskType: null, chapterId: 'ch-1', subjectId: 'sub-1' })).toBe(
      '/practice/sub-1/ch-1',
    );
  });
});

describe('old todo links', () => {
  it('lands on the plan', () => {
    expect(todosRedirectTarget({})).toBe('/schedule');
  });

  it('carries query context across', () => {
    expect(todosRedirectTarget({ chapter: 'abc' })).toBe('/schedule?chapter=abc');
  });

  it('keeps a repeated parameter repeated', () => {
    expect(todosRedirectTarget({ tag: ['a', 'b'] })).toBe('/schedule?tag=a&tag=b');
  });
});
