import { z } from 'zod';

import { assertSameOrigin, created, ok, parseBody, route, unauthorized } from '@/lib/api';
import { apiUser } from '@/lib/auth/guards';
import { today, toStoredDate } from '@/lib/calendar';
import { db } from '@/lib/db';
import {
  DEFAULT_MAX_DAILY_MINUTES,
  DEFAULT_REST_WEEKDAY,
  buildPlan,
  horizonDays,
  toDateKey,
  type PlannerChapter,
} from '@/lib/planner';
import { getProgressForUser } from '@/lib/queries/progress';

/**
 * Rebuild the study plan.
 *
 * Called when a student asks for a plan, and again after a session that moved
 * their mastery — the plan is only worth having if it reflects what they got
 * wrong this week rather than last month.
 *
 * Proposes by default and writes nothing. The student sees the plan, then
 * accepts it — `apply: true` is the accept. This follows the same rule as
 * /api/schedule/suggest: a plan that silently appeared in someone's calendar is
 * not a suggestion, and the first thing they learn is that the app puts things
 * there without asking. The difference between the two endpoints is scope —
 * suggest covers one exam, this covers the whole programme and can be re-run
 * after every session to re-weight a plan the student has already accepted.
 *
 * Two rules govern what applying is allowed to touch. It only ever deletes
 * `ai_suggested` sessions still `planned` and dated from today onward: a
 * student's own entries are theirs, and a session already marked done or
 * skipped is history, not a plan. And it plans *around* days that already have
 * work rather than stacking on top of them, so re-generating never quietly
 * doubles a day someone had already committed to.
 */

const bodySchema = z.object({
  maxDailyMinutes: z.number().int().min(20).max(600).optional(),
  /** 0 = Sunday. Null asks for no rest day at all. */
  restWeekday: z.number().int().min(0).max(6).nullish(),
  /** False (the default) previews the plan and writes nothing. */
  apply: z.boolean().default(false),
});

export const POST = route(async (request) => {
  assertSameOrigin(request);

  const auth = await apiUser();
  if (!auth.ok) return unauthorized(auth);
  const { user } = auth;

  const body = await parseBody(request, bodySchema);
  const maxDailyMinutes = body.maxDailyMinutes ?? DEFAULT_MAX_DAILY_MINUTES;

  /*
   * The plan starts on the student's today, not the server's. `buildPlan`'s
   * own arithmetic is correct — it adds whole days to this anchor and reads
   * them back with UTC getters, which is exactly right for calendar days. The
   * only thing that was wrong was which day it started from.
   */
  const from = toStoredDate(today());

  const [progress, nextExam, dueCards] = await Promise.all([
    getProgressForUser(user.id, user.trackId, user.preferredLanguage),
    db.upcomingExam.findFirst({
      where: { userId: user.id, examDate: { gte: from } },
      orderBy: { examDate: 'asc' },
      // The subject matters as much as the date: `buildPlan` uses it to put the
      // paper being sat ahead of whatever merely scores weakest.
      select: { examDate: true, subject: { select: { name: true } } },
    }),
    // Due cards decide which chapters get a flashcard session rather than a
    // quiz — the cheapest win available, and one that expires if ignored.
    db.flashcardState.findMany({
      where: { userId: user.id, dueDate: { lte: from } },
      // A card reaches its chapter through whichever source it has. Reading
      // only `question` here counted an attempted card and ignored one written
      // from the textbook, so a chapter seeded with cards but never practised
      // looked to the planner like a chapter with nothing due.
      select: {
        question: { select: { chapterId: true } },
        generatedCard: { select: { chapterId: true, retiredAt: true } },
      },
    }),
  ]);

  const dueByChapter = new Map<string, number>();
  for (const card of dueCards) {
    if (card.generatedCard?.retiredAt) continue;
    const id = card.question?.chapterId ?? card.generatedCard?.chapterId;
    if (!id) continue;
    dueByChapter.set(id, (dueByChapter.get(id) ?? 0) + 1);
  }

  const chapters: PlannerChapter[] = progress.flatMap((subject) =>
    subject.chapters.map((chapter) => ({
      chapterId: chapter.chapterId,
      chapterName: chapter.chapterName,
      subjectName: subject.subjectName,
      masteryScore: chapter.masteryScore,
      attemptsCount: chapter.attemptsCount,
      dueFlashcards: dueByChapter.get(chapter.chapterId) ?? 0,
    })),
  );

  const days = horizonDays(from, nextExam?.examDate ?? null);
  const until = new Date(from.getTime() + Math.max(days, 1) * 86_400_000);

  // Days already spoken for: anything the student wrote themselves, plus
  // anything already done. Suggestions we are about to replace do not count.
  const existing = await db.studySession.findMany({
    where: {
      userId: user.id,
      scheduledDate: { gte: from, lte: until },
      NOT: { source: 'ai_suggested', status: 'planned' },
    },
    select: { scheduledDate: true },
  });
  const busyDates = new Set(existing.map((s) => toDateKey(s.scheduledDate)));

  const plan = buildPlan({
    chapters,
    examDate: nextExam?.examDate ?? null,
    examSubject: nextExam?.subject?.name ?? null,
    from,
    maxDailyMinutes,
    busyDates,
    restWeekday: body.restWeekday === undefined ? DEFAULT_REST_WEEKDAY : body.restWeekday,
  });

  const summary = {
    examDate: nextExam ? toDateKey(nextExam.examDate) : null,
    horizonDays: days,
    totalMinutes: plan.reduce((sum, s) => sum + s.durationMinutes, 0),
    // Said plainly so the caller can explain an empty plan rather than showing
    // a blank page: no weak chapter is a real answer, not a failure.
    reason: plan.length === 0 ? (chapters.length === 0 ? 'NO_PROGRESS_YET' : 'NOTHING_WEAK') : null,
  };

  if (!body.apply) {
    return ok({ ...summary, applied: false, sessions: plan });
  }

  const result = await db.$transaction(async (tx) => {
    const removed = await tx.studySession.deleteMany({
      where: {
        userId: user.id,
        source: 'ai_suggested',
        status: 'planned',
        scheduledDate: { gte: from },
      },
    });

    if (plan.length === 0) return { created: 0, replaced: removed.count };

    const inserted = await tx.studySession.createMany({
      data: plan.map((session) => ({
        userId: user.id,
        title: session.title,
        scheduledDate: new Date(`${session.scheduledDate}T00:00:00.000Z`),
        chapterId: session.chapterId,
        durationMinutes: session.durationMinutes,
        taskType: session.taskType,
        rationale: session.rationale,
        source: 'ai_suggested' as const,
      })),
    });

    return { created: inserted.count, replaced: removed.count };
  });

  return created({ ...summary, ...result, applied: true });
});
