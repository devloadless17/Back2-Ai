import 'server-only';

import { db } from '@/lib/db';
import {
  badgeStates,
  CHAPTER_MASTERED_AT,
  dailyGoal,
  levelFromXp,
  nextBadge,
  rankForLevel,
  totalXp,
  type BadgeState,
  type BadgeStats,
  type DailyGoal,
  type LevelState,
  type ProgressSummary,
  type RankKey,
} from '@/lib/gamification';
import { MIN_ATTEMPTS_FOR_WEAKNESS } from '@/lib/scoring/mastery';

import { attemptsByDay, streakFrom } from './activity';

/**
 * Everything the progress layer needs, in one round of queries.
 *
 * Derived on every read rather than stored. That costs a handful of counts on
 * pages that already run several, and buys the guarantee that a student's level
 * can never disagree with their work — there is no column to migrate, no
 * backfill to get wrong, and no way for a bug to hand out XP that was not
 * earned.
 *
 * A chapter counts as mastered only with `MIN_ATTEMPTS_FOR_WEAKNESS` attempts
 * behind it, the same gate the dashboard uses before naming a weak spot. Three
 * lucky answers is not a mastered chapter, and a badge that says otherwise is
 * a badge that teaches students to trust the wrong number.
 */

export type ProgressSnapshot = {
  levelState: LevelState;
  rank: RankKey;
  goal: DailyGoal;
  streak: number;
  badges: BadgeState[];
  next: BadgeState | null;
  stats: BadgeStats & {
    correctAttempts: number;
    partialAttempts: number;
    answeredToday: number;
  };
};

/**
 * The wire-sized view of a snapshot.
 *
 * Study APIs return this after a write; the client diffs it against the summary
 * its page was rendered with and turns the difference into toasts. Diffing on
 * the client rather than the server means one snapshot query per action instead
 * of two, and the client already knows what it last showed.
 */
export function summarize(snapshot: ProgressSnapshot): ProgressSummary {
  return {
    xp: snapshot.levelState.totalXp,
    level: snapshot.levelState.level,
    badges: snapshot.badges.filter((badge) => badge.earned).map((badge) => badge.key),
    goalMet: snapshot.goal.met,
    streak: snapshot.streak,
  };
}

export async function getProgressSummary(userId: string): Promise<ProgressSummary> {
  return summarize(await getProgressSnapshot(userId));
}

export async function getProgressSnapshot(userId: string): Promise<ProgressSnapshot> {
  const today = startOfToday();

  const [
    attemptTally,
    flashcardReviews,
    examSimulations,
    masteredChapters,
    bestPaper,
    activity,
  ] = await Promise.all([
    /*
     * All four attempt counts in one pass.
     *
     * Raw SQL because two of them compare `score` against `max_score`, and a
     * column-to-column comparison is not something Prisma's filter language can
     * express — the alternative is pulling every attempt row into Node to count
     * it, which for a student with two thousand attempts is absurd.
     *
     * Full marks means an MCQ marked right, or an open answer that took every
     * point on its barème. Partial means scored above zero but short of it.
     * An unmarked answer (null score) is neither: it earns the base rate and
     * nothing more, which is the same rule mastery uses.
     */
    db.$queryRaw<
      { attempts: bigint; correct: bigint; partial: bigint; today: bigint }[]
    >`
      SELECT COUNT(*)                                                       AS "attempts",
             COUNT(*) FILTER (
               WHERE is_correct = true
                  OR (score IS NOT NULL AND max_score IS NOT NULL
                      AND max_score > 0 AND score >= max_score)
             )                                                              AS "correct",
             COUNT(*) FILTER (
               WHERE is_correct IS NULL AND score IS NOT NULL
                 AND max_score IS NOT NULL AND score > 0 AND score < max_score
             )                                                              AS "partial",
             COUNT(*) FILTER (WHERE attempted_at >= ${today})               AS "today"
      FROM attempts
      WHERE user_id = ${userId}::uuid
    `,

    // Cards that have actually been through a review, not cards that exist.
    db.flashcardState.aggregate({ where: { userId }, _sum: { repetitions: true } }),

    db.examSimulation.count({ where: { userId, status: { in: ['submitted', 'graded'] } } }),

    db.chapterMastery.count({
      where: {
        userId,
        masteryScore: { gte: CHAPTER_MASTERED_AT },
        attemptsCount: { gte: MIN_ATTEMPTS_FOR_WEAKNESS },
      },
    }),

    db.examSimulation.findMany({
      where: { userId, status: 'graded', maxScore: { gt: 0 }, totalScore: { not: null } },
      select: { totalScore: true, maxScore: true },
    }),

    attemptsByDay(userId, 40),
  ]);

  const tally = attemptTally[0];
  const attempts = Number(tally?.attempts ?? 0);
  const correctAttempts = Number(tally?.correct ?? 0);
  const partialAttempts = Number(tally?.partial ?? 0);
  const answeredToday = Number(tally?.today ?? 0);

  const reviews = flashcardReviews._sum.repetitions ?? 0;

  // Best paper as a percentage, so the badge threshold reads in the same unit.
  const bestPaperRatio = bestPaper.reduce((best, paper) => {
    const max = Number(paper.maxScore ?? 0);
    if (max <= 0) return best;
    return Math.max(best, (Number(paper.totalScore ?? 0) / max) * 100);
  }, 0);

  const xp = totalXp({
    attempts,
    correctAttempts,
    partialAttempts,
    flashcardReviews: reviews,
    examSimulations,
    chaptersMastered: masteredChapters,
  });

  const levelState = levelFromXp(xp);
  const streak = streakFrom(activity);

  const stats: BadgeStats = {
    attempts,
    streak,
    chaptersMastered: masteredChapters,
    examSimulations,
    flashcardReviews: reviews,
    bestPaperRatio,
  };

  const badges = badgeStates(stats);

  return {
    levelState,
    rank: rankForLevel(levelState.level),
    goal: dailyGoal(answeredToday),
    streak,
    badges,
    next: nextBadge(badges),
    stats: { ...stats, correctAttempts, partialAttempts, answeredToday },
  };
}

function startOfToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
