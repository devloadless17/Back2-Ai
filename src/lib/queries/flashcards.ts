import 'server-only';

import { db } from '@/lib/db';
import { MIN_ATTEMPTS_FOR_WEAKNESS } from '@/lib/scoring/mastery';

/**
 * Flashcard deck reads and card creation.
 *
 * Cards are not authored separately — a card *is* a question the student has
 * already met in practice. That is the whole design: the deck cannot contain
 * something they have never seen, and reviewing is recall of their own work
 * rather than of a stranger's flashcard.
 */

export type ReviewScope =
  | { kind: 'all' }
  | { kind: 'subject'; subjectId: string }
  | { kind: 'unit'; unitId: string }
  | { kind: 'chapter'; chapterId: string }
  /** The chapters the student's own attempts say they are weakest in. */
  | { kind: 'weak' };

export type DueCard = {
  questionId: string;
  contentText: string;
  contentLatex: string | null;
  officialSolution: string | null;
  officialSolutionLatex: string | null;
  chapterId: string;
  chapterName: string;
  subjectName: string;
  easiness: number;
  intervalDays: number;
  repetitions: number;
  /**
   * True when the card was not due and was pulled in anyway because its chapter
   * is weak. Shown to the student — being handed a card early without being told
   * why looks like the scheduler is broken.
   */
  aheadOfSchedule: boolean;
};

/** How many weak chapters a "weak spots" session draws from. */
export const WEAK_CHAPTER_LIMIT = 5;

/** A chapter is only weak enough to target below this mastery. */
export const WEAKNESS_MASTERY_CEILING = 0.7;

function scopeWhere(scope: ReviewScope, trackId: string | null) {
  const base = { question: { chapter: { subject: { trackId: trackId ?? undefined } } } };

  switch (scope.kind) {
    case 'chapter':
      return { question: { chapterId: scope.chapterId } };
    case 'unit':
      return { question: { chapter: { unitId: scope.unitId } } };
    case 'subject':
      return { question: { chapter: { subjectId: scope.subjectId } } };
    default:
      return base;
  }
}

export type WeakChapter = {
  chapterId: string;
  chapterName: string;
  subjectName: string;
  masteryScore: number;
  attemptsCount: number;
};

/**
 * The chapters to work on, weakest first.
 *
 * The two thresholds are doing different jobs. `MIN_ATTEMPTS_FOR_WEAKNESS` is
 * the same gate the dashboard uses before naming a weak spot — one bad
 * afternoon in a chapter is not evidence. `WEAKNESS_MASTERY_CEILING` then keeps
 * a student who is at 90% everywhere from being told their best subject is a
 * weakness merely because it is their *relative* worst.
 */
export async function weakChapters(
  userId: string,
  trackId: string | null,
  limit = WEAK_CHAPTER_LIMIT,
): Promise<WeakChapter[]> {
  const rows = await db.chapterMastery.findMany({
    where: {
      userId,
      attemptsCount: { gte: MIN_ATTEMPTS_FOR_WEAKNESS },
      masteryScore: { lt: WEAKNESS_MASTERY_CEILING },
      chapter: { subject: { trackId: trackId ?? undefined } },
    },
    select: {
      chapterId: true,
      masteryScore: true,
      attemptsCount: true,
      chapter: { select: { name: true, subject: { select: { name: true } } } },
    },
    orderBy: [{ masteryScore: 'asc' }, { chapterId: 'asc' }],
    take: limit,
  });

  return rows.map((row) => ({
    chapterId: row.chapterId,
    chapterName: row.chapter.name,
    subjectName: row.chapter.subject.name,
    masteryScore: Number(row.masteryScore),
    attemptsCount: row.attemptsCount,
  }));
}

export function startOfToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export async function countDue(userId: string, trackId: string | null, scope: ReviewScope = { kind: 'all' }) {
  if (scope.kind === 'weak') {
    const chapters = await weakChapters(userId, trackId);
    if (chapters.length === 0) return 0;

    return db.flashcardState.count({
      where: {
        userId,
        dueDate: { lte: startOfToday() },
        question: { chapterId: { in: chapters.map((chapter) => chapter.chapterId) } },
      },
    });
  }

  return db.flashcardState.count({
    where: { userId, dueDate: { lte: startOfToday() }, ...scopeWhere(scope, trackId) },
  });
}

const CARD_SELECT = {
  easiness: true,
  intervalDays: true,
  repetitions: true,
  question: {
    select: {
      id: true,
      contentText: true,
      contentLatex: true,
      officialSolution: true,
      officialSolutionLatex: true,
      chapter: {
        select: { id: true, name: true, subject: { select: { name: true } } },
      },
    },
  },
} as const;

type CardRow = {
  easiness: unknown;
  intervalDays: number;
  repetitions: number;
  question: {
    id: string;
    contentText: string;
    contentLatex: string | null;
    officialSolution: string | null;
    officialSolutionLatex: string | null;
    chapter: { id: string; name: string; subject: { name: string } };
  };
};

function toCard(row: CardRow, aheadOfSchedule: boolean): DueCard {
  return {
    questionId: row.question.id,
    contentText: row.question.contentText,
    contentLatex: row.question.contentLatex,
    officialSolution: row.question.officialSolution,
    officialSolutionLatex: row.question.officialSolutionLatex,
    chapterId: row.question.chapter.id,
    chapterName: row.question.chapter.name,
    subjectName: row.question.chapter.subject.name,
    easiness: Number(row.easiness),
    intervalDays: row.intervalDays,
    repetitions: row.repetitions,
    aheadOfSchedule,
  };
}

/**
 * The cards due now, oldest due-date first so the longest-overdue card is seen
 * first rather than last.
 */
export async function getDueCards(
  userId: string,
  trackId: string | null,
  scope: ReviewScope = { kind: 'all' },
  limit = 40,
): Promise<DueCard[]> {
  if (scope.kind === 'weak') return getWeakCards(userId, trackId, limit);

  const rows = await db.flashcardState.findMany({
    where: { userId, dueDate: { lte: startOfToday() }, ...scopeWhere(scope, trackId) },
    select: CARD_SELECT,
    orderBy: [{ dueDate: 'asc' }, { questionId: 'asc' }],
    take: limit,
  });

  return rows.map((row) => toCard(row, false));
}

/**
 * A session built from what the student is worst at rather than from the clock.
 *
 * Due cards in weak chapters come first, and only if there are not enough of
 * them is the session topped up with cards that are not due yet — nearest due
 * date first, so the ones pulled forward are the ones closest to being needed
 * anyway.
 *
 * Reviewing early is a real cost: SM-2 lengthens an interval on a correct
 * answer, and answering a card the day after you last saw it is easier than
 * answering it in three weeks, so the interval it earns is not quite honest.
 * That is accepted deliberately and only inside this scope. A student who has
 * asked to drill their weak chapters is not served by "nothing due, come back
 * Thursday", and the top-up cards are labelled so the choice is visible rather
 * than silent.
 */
async function getWeakCards(userId: string, trackId: string | null, limit: number): Promise<DueCard[]> {
  const chapters = await weakChapters(userId, trackId);
  if (chapters.length === 0) return [];

  const chapterIds = chapters.map((chapter) => chapter.chapterId);
  const today = startOfToday();

  const due = await db.flashcardState.findMany({
    where: { userId, dueDate: { lte: today }, question: { chapterId: { in: chapterIds } } },
    select: CARD_SELECT,
    orderBy: [{ dueDate: 'asc' }, { questionId: 'asc' }],
    take: limit,
  });

  if (due.length >= limit) return due.map((row) => toCard(row, false));

  const upcoming = await db.flashcardState.findMany({
    where: { userId, dueDate: { gt: today }, question: { chapterId: { in: chapterIds } } },
    select: CARD_SELECT,
    orderBy: [{ dueDate: 'asc' }, { questionId: 'asc' }],
    take: limit - due.length,
  });

  return [...due.map((row) => toCard(row, false)), ...upcoming.map((row) => toCard(row, true))];
}

/**
 * Adds a question to the deck the first time it is practised.
 *
 * `create`-only on conflict: a card that already exists carries scheduling
 * state, and re-practising a question must not reset the interval a student has
 * built up over weeks.
 */
export async function ensureCard(userId: string, questionId: string): Promise<void> {
  await db.flashcardState
    .create({ data: { userId, questionId, dueDate: startOfToday() } })
    .catch(() => undefined);
}

/**
 * Due counts per chapter, in one query.
 *
 * The scope selector needs a number next to every chapter, unit and subject.
 * Doing that with one count query per node would be dozens of round trips on a
 * page that loads constantly, so it is counted once at chapter level and summed
 * upwards in memory.
 */
export async function dueCountsByChapter(
  userId: string,
): Promise<{ chapterId: string; unitId: string | null; subjectId: string; due: number }[]> {
  const rows = await db.$queryRaw<
    { chapterId: string; unitId: string | null; subjectId: string; due: bigint }[]
  >`
    SELECT c.id         AS "chapterId",
           c.unit_id    AS "unitId",
           c.subject_id AS "subjectId",
           COUNT(*)     AS "due"
    FROM flashcard_state fs
    JOIN questions q ON q.id = fs.question_id
    JOIN chapters c  ON c.id = q.chapter_id
    WHERE fs.user_id = ${userId}::uuid
      AND fs.due_date <= CURRENT_DATE
    GROUP BY c.id, c.unit_id, c.subject_id
  `;

  return rows.map((row) => ({ ...row, due: Number(row.due) }));
}

/** Deck size and how it is distributed, for the flashcards landing page. */
export async function deckSummary(userId: string) {
  const [total, due, upcoming] = await Promise.all([
    db.flashcardState.count({ where: { userId } }),
    countDue(userId, null),
    db.flashcardState.findMany({
      where: { userId, dueDate: { gt: startOfToday() } },
      select: { dueDate: true },
      orderBy: { dueDate: 'asc' },
      take: 1,
    }),
  ]);

  return { total, due, nextDueDate: upcoming[0]?.dueDate ?? null };
}
