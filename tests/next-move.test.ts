import { describe, expect, it } from 'vitest';

import { nextMoveReason } from '@/lib/queries/next-move';
import type { RecurringLoss } from '@/lib/queries/recurring-losses';

/**
 * What the dashboard is allowed to claim it knows.
 *
 * This is the one place in the product where a sentence is chosen on the
 * strength of evidence, and getting it wrong is not a crash — it is a
 * personalised-sounding line shown to a student it is not true of. So the ladder
 * is pinned rung by rung, including the rung that says nothing.
 */

const loss = (over: Partial<RecurringLoss> = {}): RecurringLoss => ({
  criterion: 'Explain this text and state the problematic it raises.',
  times: 3,
  pointsLost: 9,
  subjectName: 'فلسفة عامة',
  occasions: [],
  ...over,
});

describe('the strongest evidence wins', () => {
  it('leads with a criterion missed repeatedly, even when the action is flashcards', () => {
    const reason = nextMoveReason({
      next: { kind: 'flashcards', href: '/flashcards/review', count: 8 },
      losses: [loss()],
      weakest: { chapterName: 'Integrals', masteryScore: 0.3, attemptsCount: 9 },
    });
    expect(reason.kind).toBe('recurringLoss');
  });

  it('ignores a criterion seen only once — that is a coincidence, not a pattern', () => {
    const reason = nextMoveReason({
      next: { kind: 'examSim', href: '/exam-sim' },
      losses: [loss({ times: 1 })],
      weakest: { chapterName: 'Integrals', masteryScore: 0.3, attemptsCount: 9 },
    });
    expect(reason.kind).toBe('weakChapter');
  });
});

describe('a chapter is only weak with enough work behind it', () => {
  it('uses it above the attempts threshold', () => {
    const reason = nextMoveReason({
      next: { kind: 'examSim', href: '/exam-sim' },
      losses: [],
      weakest: { chapterName: 'Integrals', masteryScore: 0.34, attemptsCount: 5 },
    });
    expect(reason).toEqual({ kind: 'weakChapter', chapterName: 'Integrals', percent: 34 });
  });

  it('refuses below it — two bad answers is not a weakness', () => {
    const reason = nextMoveReason({
      next: { kind: 'examSim', href: '/exam-sim' },
      losses: [],
      weakest: { chapterName: 'Integrals', masteryScore: 0.1, attemptsCount: 2 },
    });
    expect(reason.kind).toBe('none');
  });

  it('never calls a chapter weak on a perfect score, whatever the ranking says', () => {
    // `findWeakestChapter` returns the lowest, which on a strong account is 1.0.
    const reason = nextMoveReason({
      next: { kind: 'examSim', href: '/exam-sim' },
      losses: [],
      weakest: { chapterName: 'Limits', masteryScore: 1, attemptsCount: 40 },
    });
    expect(reason.kind).toBe('none');
  });
});

describe('the weaker rungs', () => {
  it('falls back to due cards, which are the student own backlog', () => {
    const reason = nextMoveReason({
      next: { kind: 'flashcards', href: '/flashcards/review', count: 8 },
      losses: [],
      weakest: null,
    });
    expect(reason).toEqual({ kind: 'flashcards', count: 8 });
  });

  it('falls back to untouched material', () => {
    const reason = nextMoveReason({
      next: {
        kind: 'newChapter',
        href: '/practice/s/c',
        chapterName: 'Complex numbers',
        subjectName: 'Mathematics',
      },
      losses: [],
      weakest: null,
    });
    expect(reason).toEqual({ kind: 'notStarted', chapterName: 'Complex numbers' });
  });
});

describe('a brand-new account', () => {
  it('says nothing rather than something that sounds personal and is not', () => {
    const reason = nextMoveReason({
      next: { kind: 'anything', href: '/practice' },
      losses: [],
      weakest: null,
    });
    expect(reason).toEqual({ kind: 'none' });
  });

  it('says nothing when cards exist but none are due', () => {
    const reason = nextMoveReason({
      next: { kind: 'flashcards', href: '/flashcards/review', count: 0 },
      losses: [],
      weakest: null,
    });
    expect(reason.kind).toBe('none');
  });
});
