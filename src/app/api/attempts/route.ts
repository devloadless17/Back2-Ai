import { z } from 'zod';

import {
  assertSameOrigin,
  clientKey,
  created,
  fail,
  parseBody,
  rateLimit,
  route,
  tooManyRequests,
  unauthorized,
} from '@/lib/api';
import { apiUser } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { gradeAgainstBareme, parseBareme } from '@/lib/grading';
import { ensureCard } from '@/lib/queries/flashcards';
import { getProgressSummary } from '@/lib/queries/gamification';
import { recomputeChapterMastery } from '@/lib/queries/progress';

/**
 * Records one practice or quiz attempt, marks it, and updates mastery.
 *
 * This is the write that the entire progress side of the product rests on, so
 * three things are enforced here and not left to the caller:
 *
 *   * The question must belong to the student's own track. An id from a request
 *     body is not evidence of entitlement.
 *   * `context` may not be 'exam_sim'. Exam attempts are written by the marking
 *     path in lib/exam.ts, under the server-authoritative timer. Accepting one
 *     here would let a client manufacture exam history.
 *   * Mastery is recomputed inline, in the same request. The dashboard bar has
 *     to move the moment the student answers; a nightly job would make progress
 *     feel like something that happens to other people.
 *
 * Old-cycle mode deliberately does not call this route at all.
 */
const bodySchema = z
  .object({
    questionId: z.string().uuid().optional(),
    generatedProblemId: z.string().uuid().optional(),
    context: z.enum(['practice', 'quiz']),
    /** MCQ only — the option the student chose. */
    selectedOptionId: z.string().max(64).optional(),
    /** Open/problem — their working. */
    answerText: z.string().max(20_000).optional(),
    timeTakenSeconds: z.number().int().min(0).max(24 * 3600).optional(),
  })
  .refine((body) => Boolean(body.questionId) !== Boolean(body.generatedProblemId), {
    message: 'Provide exactly one of questionId or generatedProblemId.',
  });

export const POST = route(async (request) => {
  assertSameOrigin(request);

  const auth = await apiUser();
  if (!auth.ok) return unauthorized(auth);
  const { user } = auth;

  const body = await parseBody(request, bodySchema);

  /*
   * Throttle before any model call.
   *
   * Marking an open answer runs on the verify model at high effort — the most
   * expensive call in the product — and this was the only AI-invoking endpoint
   * without a limit. 60 an hour is far beyond honest practice (a barème
   * question takes minutes to answer) while capping what a stuck retry loop or
   * a bored student with devtools open can spend.
   *
   * MCQ attempts are marked by string comparison and cost nothing, so they are
   * deliberately not counted against the budget.
   */
  const marksAnswer = !body.selectedOptionId;
  if (marksAnswer) {
    const limit = rateLimit(clientKey(request, `attempts:${user.id}`), 60, 60 * 60_000);
    if (!limit.allowed) return tooManyRequests(limit.retryAfter);
  }

  // --- Resolve the question, scoped to the student's track -----------------
  const source = body.questionId
    ? await db.question.findFirst({
        where: { id: body.questionId, chapter: { subject: { trackId: user.trackId ?? undefined } } },
        select: {
          id: true,
          chapterId: true,
          questionType: true,
          contentText: true,
          officialSolution: true,
          correctOptionId: true,
          bareme: true,
          chapter: { select: { subject: { select: { language: true } } } },
        },
      })
    : await db.generatedProblem.findFirst({
        where: {
          id: body.generatedProblemId,
          chapter: { subject: { trackId: user.trackId ?? undefined } },
          // Unapproved generated content is not practisable, same rule as everywhere.
          verificationStatus: 'approved',
          publishedAt: { not: null },
        },
        select: {
          id: true,
          chapterId: true,
          contentText: true,
          generatedSolution: true,
          bareme: true,
          chapter: { select: { subject: { select: { language: true } } } },
        },
      });

  if (!source) return fail(404, 'QUESTION_NOT_FOUND');

  const isQuestion = 'questionType' in source;
  const language = source.chapter.subject.language;
  const bareme = parseBareme(source.bareme);

  let isCorrect: boolean | null = null;
  let score: number | null = null;
  let maxScore: number | null = null;
  let baremeResult: unknown = null;
  let needsHumanReview = false;

  if (isQuestion && source.questionType === 'mcq') {
    // Objective and free to mark. No model call for a multiple-choice answer.
    if (!body.selectedOptionId) return fail(422, 'OPTION_REQUIRED');
    isCorrect = source.correctOptionId !== null && body.selectedOptionId === source.correctOptionId;
  } else if (bareme) {
    const outcome = await gradeAgainstBareme({
      questionText: source.contentText,
      officialSolution: isQuestion ? source.officialSolution : source.generatedSolution,
      bareme,
      studentAnswer: body.answerText ?? '',
      language,
    });

    score = outcome.totalScore;
    maxScore = outcome.maxScore;
    baremeResult = outcome.results;
    needsHumanReview = outcome.status === 'needs_human_review';
  } else {
    // No barème and not multiple choice: the attempt is recorded as practice
    // activity, but it cannot be scored, and it must not count as a failure.
    isCorrect = null;
  }

  const attempt = await db.attempt.create({
    data: {
      userId: user.id,
      questionId: body.questionId ?? null,
      generatedProblemId: body.generatedProblemId ?? null,
      isCorrect,
      submittedAnswer: body.answerText ?? null,
      score,
      maxScore,
      timeTakenSeconds: body.timeTakenSeconds ?? null,
      context: body.context,
    },
    select: { id: true },
  });

  // A practised question becomes a flashcard. Generated problems do not — the
  // flashcard table keys on `question_id`, and a card whose source can still be
  // rejected at review has no place in a student's long-term deck.
  if (body.questionId) await ensureCard(user.id, body.questionId);

  await recomputeChapterMastery(user.id, source.chapterId);

  const mastery = await db.chapterMastery.findUnique({
    where: { userId_chapterId: { userId: user.id, chapterId: source.chapterId } },
    select: { masteryScore: true, attemptsCount: true },
  });

  // Read *after* mastery is recomputed: the "chapter mastered" badge and the XP
  // it carries depend on the score this attempt just produced. Reading first
  // would pay out a level late, on the following question.
  const progress = await getProgressSummary(user.id);

  return created({
    attemptId: attempt.id,
    isCorrect,
    score,
    maxScore,
    baremeResult,
    needsHumanReview,
    solution: isQuestion ? source.officialSolution : source.generatedSolution,
    mastery: {
      chapterId: source.chapterId,
      masteryScore: Number(mastery?.masteryScore ?? 0),
      attemptsCount: mastery?.attemptsCount ?? 0,
    },
    progress,
  });
});
