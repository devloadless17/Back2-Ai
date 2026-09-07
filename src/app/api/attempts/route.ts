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
import { budgetState } from '@/lib/ai';
import { db } from '@/lib/db';
import { resolveCreditChapter } from '@/lib/queries/progress';
import { gradeAgainstBareme, gradeWithoutBareme, parseBareme, statedMarksOf } from '@/lib/grading';
import { retrieveGrounding } from '@/lib/retrieval';
import { ensureCard } from '@/lib/queries/flashcards';
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
    /**
     * The chapter the student is practising, which is not always the chapter the
     * question is filed under.
     *
     * GS and LS sit the same chemistry from the same book, so a GS student
     * practising Alcohols is offered LS exercises on alcohols too. The mark has
     * to land on the chapter they are working through, not on the other track's
     * copy of it, or their progress page never moves.
     *
     * Validated, never trusted: it must belong to this student's track, and the
     * question must actually be offered in it.
     */
    chapterId: z.string().uuid().optional(),
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

    /*
     * The month's ceiling, checked before the spend rather than after it, so
     * the request that would cross the line is the one refused.
     */
    const budget = await budgetState(user.id);
    if (budget.exhausted) return fail(402, 'AI_BUDGET_EXHAUSTED');
  }

  // --- Resolve the question, scoped to the student's track -----------------
  const source = body.questionId
    ? await db.question.findFirst({
        where: {
          id: body.questionId,
          /*
           * Offered by some chapter of this student's track — not filed under
           * one. The old rule read the question's own `chapter.subject.trackId`,
           * and it rejected every shared exercise with a 404 the moment the
           * student pressed submit.
           *
           * The guarantee is unchanged: a student can still only answer what a
           * chapter of their own track actually offers, so a forged body buys
           * nothing.
           */
          alsoInChapters: { some: { chapter: { subject: { trackId: user.trackId ?? undefined } } } },
        },
        select: {
          id: true,
          chapterId: true,
          questionType: true,
          contentText: true,
          officialSolution: true,
          correctOptionId: true,
          bareme: true,
          chapter: { select: { subject: { select: { id: true, language: true, name: true } } } },
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
          chapter: { select: { subject: { select: { id: true, language: true, name: true } } } },
        },
      });

  if (!source) return fail(404, 'QUESTION_NOT_FOUND');

  /*
   * Which chapter this mark belongs to.
   *
   * Not `source.chapterId`. A GS student practising Alcohols may be answering an
   * LS exercise on alcohols — the two tracks sit the same chemistry from the same
   * book — and crediting the question's own chapter would post the mark to the
   * other track's copy, where this student's progress page will never look for
   * it. They would answer twenty questions and watch nothing move.
   *
   * The client says which chapter the student is sitting in, and it is checked
   * rather than believed: it must be in this student's track and must actually
   * offer this question. Anything else falls back to resolving it server-side,
   * which also covers the quiz path, where there is no chapter on screen to name.
   */
  const creditChapterId = await resolveCreditChapter({
    userTrackId: user.trackId,
    questionId: source.id,
    questionChapterId: source.chapterId,
    claimed: body.chapterId,
    isGenerated: !('questionType' in source),
  });
  if (!creditChapterId) return fail(404, 'QUESTION_NOT_FOUND');

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
      subject: source.chapter.subject.name,
    });

    score = outcome.totalScore;
    maxScore = outcome.maxScore;
    baremeResult = outcome.results;
    needsHumanReview = outcome.status === 'needs_human_review';
  } else if ((body.answerText ?? '').trim().length > 0) {
    /*
     * No barème, but the student wrote something.
     *
     * This is where practice used to go quiet: the attempt was logged and the
     * student got nothing back. The marker now proposes the criteria a
     * Lebanese examiner would use, grounded in retrieved course material, and
     * the result is flagged provisional so nobody mistakes it for the
     * ministry's. Where nothing can be grounded — or the question turns on a
     * figure we do not store — it still declines rather than inventing.
     *
     * Not anchored on this question: anchoring hands back the question and its
     * own solution, and a criterion grounded in the question it was invented
     * for is grounded in nothing.
     */
    const grounding = await retrieveGrounding({
      query: source.contentText,
      subjectIds: [source.chapter.subject.id],
      userId: user.id,
    });

    const outcome = await gradeWithoutBareme({
      questionText: source.contentText,
      officialSolution: isQuestion ? source.officialSolution : source.generatedSolution,
      bareme: [],
      studentAnswer: body.answerText ?? '',
      language,
      subject: source.chapter.subject.name,
      statedMarks: statedMarksOf(source.contentText),
      courseMaterial: grounding.context,
    });

    if (outcome.status === 'graded_provisional') {
      score = outcome.totalScore;
      maxScore = outcome.maxScore;
      baremeResult = outcome.results;
      isCorrect = outcome.maxScore > 0 ? outcome.totalScore >= outcome.maxScore / 2 : null;
    } else {
      // Declined — a figure it cannot see, or nothing groundable. Recorded as
      // practice activity, not as a failure.
      isCorrect = null;
    }
  } else {
    // No barème, no answer: the attempt is recorded as practice activity, but
    // it cannot be scored, and it must not count as a failure.
    isCorrect = null;
  }

  const attempt = await db.attempt.create({
    data: {
      chapterId: creditChapterId,
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

  await recomputeChapterMastery(user.id, creditChapterId);

  const mastery = await db.chapterMastery.findUnique({
    where: { userId_chapterId: { userId: user.id, chapterId: creditChapterId } },
    select: { masteryScore: true, attemptsCount: true },
  });

  return created({
    attemptId: attempt.id,
    isCorrect,
    score,
    maxScore,
    baremeResult,
    needsHumanReview,
    solution: isQuestion ? source.officialSolution : source.generatedSolution,
    mastery: {
      chapterId: creditChapterId,
      masteryScore: Number(mastery?.masteryScore ?? 0),
      attemptsCount: mastery?.attemptsCount ?? 0,
    },
  });
});
