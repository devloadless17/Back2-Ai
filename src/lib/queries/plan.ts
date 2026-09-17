import 'server-only';

import { dayOf, today, toStoredDate } from '@/lib/calendar';
import { db } from '@/lib/db';

/**
 * Everything the planning page needs, in one round of queries.
 *
 * `/schedule` and `/todos` each read their own sessions, todos and the whole
 * chapter list, duplicating most of it. This loads the window, the backlog,
 * the exams and the evidence behind completion, in one place. The chapter list
 * for the picker is a measured decision — see the schedule page.
 */

/** How far back the planner still shows. Yesterday's work is still tickable. */
export const PAST_TAIL_DAYS = 7;
/** How far forward one screen of planning reaches. */
export const HORIZON_DAYS = 14;

/**
 * How long after a session's date an attempt still counts as that session.
 *
 * Forty-eight hours, and it stays forty-eight now that the day boundary is
 * correct. Sessions carry a DATE and no time at all, so a student who works
 * late on Tuesday and one who works on Wednesday morning are both doing
 * Tuesday's session; the plan is a plan, not a stopwatch. Attempts are
 * timestamps rather than calendar days, so this window is deliberately
 * generous at both ends of a day.
 *
 * The window is why the copy says "3 answers marked" and never "3 answers
 * marked that day". The narrower claim is the one we cannot support.
 */
export const RECONCILE_WINDOW_HOURS = 48;

export type PlanSession = {
  id: string;
  title: string;
  /** YYYY-MM-DD, as stored. */
  scheduledDate: string;
  durationMinutes: number | null;
  taskType: 'quiz' | 'flashcards' | 'exam_drill' | 'review' | null;
  rationale: string | null;
  source: 'manual' | 'ai_suggested';
  status: 'planned' | 'done' | 'skipped';
  chapterId: string | null;
  chapterName: string | null;
  subjectId: string | null;
  subjectName: string | null;
  /**
   * Answers marked in this session's chapter inside the reconciliation window.
   *
   * Null when the session has no chapter, so nothing could be counted. Zero is
   * a real answer and means we looked and found none — the UI must not read
   * the two as the same thing.
   *
   * This is the whole of what completion means here. Ticking a session records
   * that the student says they did it; this records what the product actually
   * saw. Neither is mastery, and the page never implies it is.
   */
  answersMarked: number | null;
};

export type PlanTodo = {
  id: string;
  content: string;
  isDone: boolean;
  linkedAction: 'quiz' | 'flashcards' | 'practice' | 'exam_sim' | null;
  chapterId: string | null;
  chapterName: string | null;
  subjectId: string | null;
};

export type PlanExam = {
  id: string;
  examDate: string;
  label: string | null;
  subjectName: string | null;
  isBacExam: boolean;
};

export type Plan = {
  /** The Beirut day the rest of the page is laid out against. */
  todayKey: string;
  sessions: PlanSession[];
  /** Undated intentions. Capture, not commitment — see `/todos` redirect. */
  backlog: PlanTodo[];
  exams: PlanExam[];
};

/**
 * The Beirut day a stored session belongs to.
 *
 * `dayOf` reads a `DATE` column, which round-trips as midnight UTC; `today`
 * decides what day it is where the students are. Two different operations —
 * see `src/lib/calendar.ts`, which exists because this file conflated them.
 */
export function startOfTodayBeirut(now: Date = new Date()): Date {
  return toStoredDate(today(now));
}

export async function getPlan(userId: string, now: Date = new Date()): Promise<Plan> {
  const anchor = startOfTodayBeirut(now);
  const from = new Date(anchor.getTime() - PAST_TAIL_DAYS * 86_400_000);
  const to = new Date(anchor.getTime() + HORIZON_DAYS * 86_400_000);

  const [rows, todos, exams] = await Promise.all([
    db.studySession.findMany({
      where: { userId, scheduledDate: { gte: from, lte: to } },
      select: {
        id: true,
        title: true,
        scheduledDate: true,
        durationMinutes: true,
        taskType: true,
        rationale: true,
        source: true,
        status: true,
        chapterId: true,
        chapter: { select: { name: true, subjectId: true, subject: { select: { name: true } } } },
      },
      orderBy: [{ scheduledDate: 'asc' }, { createdAt: 'asc' }],
    }),

    db.todo.findMany({
      where: { userId, isDone: false },
      select: {
        id: true,
        content: true,
        isDone: true,
        linkedAction: true,
        linkedChapter: { select: { id: true, name: true, subjectId: true } },
      },
      orderBy: { createdAt: 'desc' },
      // A backlog is a list, not an archive. Past this, the page is the problem.
      take: 20,
    }),

    db.upcomingExam.findMany({
      where: { userId, examDate: { gte: anchor } },
      select: {
        id: true,
        examDate: true,
        label: true,
        isBacExam: true,
        subject: { select: { name: true } },
      },
      orderBy: { examDate: 'asc' },
    }),
  ]);

  const answersByChapter = await countAnswers(userId, rows, from, to);

  return {
    todayKey: dayOf(anchor),
    sessions: rows.map((row) => ({
      id: row.id,
      title: row.title,
      scheduledDate: dayOf(row.scheduledDate),
      durationMinutes: row.durationMinutes,
      taskType: row.taskType,
      rationale: row.rationale,
      source: row.source,
      status: row.status,
      chapterId: row.chapterId,
      chapterName: row.chapter?.name ?? null,
      subjectId: row.chapter?.subjectId ?? null,
      subjectName: row.chapter?.subject?.name ?? null,
      answersMarked:
        row.chapterId === null
          ? null
          : countWithin(
              answersByChapter.get(row.chapterId) ?? [],
              row.scheduledDate,
              RECONCILE_WINDOW_HOURS,
            ),
    })),
    backlog: todos.map((todo) => ({
      id: todo.id,
      content: todo.content,
      isDone: todo.isDone,
      linkedAction: todo.linkedAction,
      chapterId: todo.linkedChapter?.id ?? null,
      chapterName: todo.linkedChapter?.name ?? null,
      subjectId: todo.linkedChapter?.subjectId ?? null,
    })),
    exams: exams.map((exam) => ({
      id: exam.id,
      examDate: dayOf(exam.examDate),
      label: exam.label,
      subjectName: exam.subject?.name ?? null,
      isBacExam: exam.isBacExam,
    })),
  };
}

/**
 * When the student actually answered something, per chapter.
 *
 * One query for the whole window rather than one per session — a fortnight of
 * planning is easily thirty rows, and thirty round trips to draw one page is
 * the shape of problem this module exists to avoid. The timestamps come back
 * unbucketed and each session counts its own window in memory.
 *
 * `attempts.chapter_id` is null when the student practised through a question's
 * own chapter, so it falls back the same way the rest of the product does.
 */
async function countAnswers(
  userId: string,
  rows: { chapterId: string | null; scheduledDate: Date }[],
  from: Date,
  to: Date,
): Promise<Map<string, Date[]>> {
  const chapterIds = [...new Set(rows.map((r) => r.chapterId).filter((id): id is string => !!id))];
  if (chapterIds.length === 0) return new Map();

  const until = new Date(to.getTime() + RECONCILE_WINDOW_HOURS * 3_600_000);

  const attempts = await db.attempt.findMany({
    where: {
      userId,
      attemptedAt: { gte: from, lt: until },
      OR: [
        { chapterId: { in: chapterIds } },
        { chapterId: null, question: { chapterId: { in: chapterIds } } },
      ],
    },
    select: { attemptedAt: true, chapterId: true, question: { select: { chapterId: true } } },
  });

  const byChapter = new Map<string, Date[]>();
  for (const attempt of attempts) {
    const id = attempt.chapterId ?? attempt.question?.chapterId;
    if (!id) continue;
    const list = byChapter.get(id);
    if (list) list.push(attempt.attemptedAt);
    else byChapter.set(id, [attempt.attemptedAt]);
  }
  return byChapter;
}

export function countWithin(times: Date[], start: Date, windowHours: number): number {
  const begin = start.getTime();
  const end = begin + windowHours * 3_600_000;
  let n = 0;
  for (const time of times) {
    const at = time.getTime();
    if (at >= begin && at < end) n += 1;
  }
  return n;
}
