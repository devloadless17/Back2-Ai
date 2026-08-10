import { describe, expect, it } from 'vitest';

import {
  BADGES,
  badgeStates,
  dailyGoal,
  levelFromXp,
  nextBadge,
  progressEvents,
  rankForLevel,
  totalXp,
  xpForNextLevel,
  xpToReachLevel,
  type BadgeStats,
} from '@/lib/gamification';

const NO_STATS: BadgeStats = {
  attempts: 0,
  streak: 0,
  chaptersMastered: 0,
  examSimulations: 0,
  flashcardReviews: 0,
  bestPaperRatio: 0,
};

describe('totalXp', () => {
  it('pays for turning up, and pays more for getting it right', () => {
    const base = totalXp({
      attempts: 10,
      correctAttempts: 0,
      partialAttempts: 0,
      flashcardReviews: 0,
      examSimulations: 0,
      chaptersMastered: 0,
    });
    const withCorrect = totalXp({
      attempts: 10,
      correctAttempts: 10,
      partialAttempts: 0,
      flashcardReviews: 0,
      examSimulations: 0,
      chaptersMastered: 0,
    });

    expect(base).toBe(100);
    expect(withCorrect).toBeGreaterThan(base);
  });

  it('gives partial credit half the correct bonus', () => {
    const partial = totalXp({
      attempts: 0,
      correctAttempts: 0,
      partialAttempts: 2,
      flashcardReviews: 0,
      examSimulations: 0,
      chaptersMastered: 0,
    });
    expect(partial).toBe(14);
  });

  it('is zero for a student who has done nothing', () => {
    expect(
      totalXp({
        attempts: 0,
        correctAttempts: 0,
        partialAttempts: 0,
        flashcardReviews: 0,
        examSimulations: 0,
        chaptersMastered: 0,
      }),
    ).toBe(0);
  });
});

describe('levelFromXp', () => {
  it('starts everyone at level 1', () => {
    const state = levelFromXp(0);
    expect(state.level).toBe(1);
    expect(state.xpIntoLevel).toBe(0);
    expect(state.progress).toBe(0);
  });

  it('levels up exactly at the threshold, not before', () => {
    const needed = xpForNextLevel(1);
    expect(levelFromXp(needed - 1).level).toBe(1);
    expect(levelFromXp(needed).level).toBe(2);
    expect(levelFromXp(needed).xpIntoLevel).toBe(0);
  });

  it('agrees with the cumulative curve', () => {
    for (const level of [2, 3, 7, 15, 25]) {
      expect(levelFromXp(xpToReachLevel(level)).level).toBe(level);
    }
  });

  it('gets harder to level, but never brutally so', () => {
    // A linear curve: each level costs a fixed amount more than the last.
    expect(xpForNextLevel(2) - xpForNextLevel(1)).toBe(xpForNextLevel(9) - xpForNextLevel(8));
  });

  it('survives nonsense input rather than looping forever', () => {
    expect(levelFromXp(Number.NaN).level).toBe(1);
    expect(levelFromXp(-500).level).toBe(1);
    expect(levelFromXp(Number.MAX_SAFE_INTEGER).level).toBeLessThanOrEqual(99);
  });
});

describe('rankForLevel', () => {
  it('moves through the ranks in order', () => {
    expect(rankForLevel(1)).toBe('beginner');
    expect(rankForLevel(5)).toBe('apprentice');
    expect(rankForLevel(12)).toBe('scholar');
    expect(rankForLevel(20)).toBe('expert');
    expect(rankForLevel(30)).toBe('master');
  });
});

describe('dailyGoal', () => {
  it('clamps an overshoot to a full ring', () => {
    const goal = dailyGoal(25, 10);
    expect(goal.progress).toBe(1);
    expect(goal.met).toBe(true);
    // The real count is kept — the ring is clamped, the number is not.
    expect(goal.done).toBe(25);
  });

  it('is not met one question short', () => {
    expect(dailyGoal(9, 10).met).toBe(false);
  });

  it('cannot be met by a target of zero', () => {
    expect(dailyGoal(0, 0).met).toBe(false);
  });
});

describe('badges', () => {
  it('earns nothing on an empty account', () => {
    expect(badgeStates(NO_STATS).every((badge) => !badge.earned)).toBe(true);
  });

  it('earns exactly the thresholds that have been passed', () => {
    const states = badgeStates({ ...NO_STATS, attempts: 50 });
    const earned = states.filter((badge) => badge.earned).map((badge) => badge.key);

    expect(earned).toContain('firstSteps');
    expect(earned).toContain('tenQuestions');
    expect(earned).toContain('fiftyQuestions');
    expect(earned).not.toContain('twoHundredQuestions');
  });

  it('points at the closest unearned badge', () => {
    const states = badgeStates({ ...NO_STATS, attempts: 9, streak: 1 });
    expect(nextBadge(states)?.key).toBe('tenQuestions');
  });

  it('returns null once everything is earned', () => {
    const maxed = Object.fromEntries(
      BADGES.map((badge) => [badge.metric, badge.threshold]),
    ) as BadgeStats;
    expect(nextBadge(badgeStates({ ...NO_STATS, ...maxed }))).toBeNull();
  });
});

describe('progressEvents', () => {
  const base = { xp: 100, level: 1, badges: [] as never[], goalMet: false, streak: 3 };

  it('announces XP before the level it caused', () => {
    const events = progressEvents(base, { ...base, xp: 400, level: 2 });
    expect(events[0]?.kind).toBe('xp');
    expect(events[1]?.kind).toBe('level');
  });

  it('says nothing at all when nothing changed', () => {
    expect(progressEvents(base, base)).toEqual([]);
  });

  it('does not re-announce a badge that was already held', () => {
    const before = { ...base, badges: ['firstSteps' as const] };
    const after = { ...before, badges: ['firstSteps' as const, 'tenQuestions' as const] };

    const events = progressEvents(before, after);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'badge', badge: 'tenQuestions' });
  });

  it('announces the goal only on the crossing', () => {
    expect(progressEvents(base, { ...base, goalMet: true })).toContainEqual({
      kind: 'goal',
      target: 10,
    });
    expect(
      progressEvents({ ...base, goalMet: true }, { ...base, goalMet: true }),
    ).toEqual([]);
  });

  it('never announces a streak going backwards', () => {
    expect(progressEvents(base, { ...base, streak: 1 })).toEqual([]);
  });
});
