import { z } from 'zod';

import { assertSameOrigin, fail, ok, parseBody, route, unauthorized } from '@/lib/api';
import { apiUser } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { gradeToQuality, reviewFlashcard, type ReviewGrade } from '@/lib/scoring/sm2';

/**
 * Records one flashcard review and reschedules the card (SM-2).
 *
 * The card's current scheduling state is read from the database rather than
 * accepted from the client. Interval and easiness are the student's learning
 * history; a client that could post them could hand itself a six-month interval
 * on a card it has never seen.
 */
const bodySchema = z.object({
  questionId: z.string().uuid(),
  grade: z.enum(['again', 'hard', 'good', 'easy']),
});

export const POST = route(async (request) => {
  assertSameOrigin(request);

  const auth = await apiUser();
  if (!auth.ok) return unauthorized(auth);
  const { user } = auth;

  const body = await parseBody(request, bodySchema);

  const card = await db.flashcardState.findUnique({
    where: { userId_questionId: { userId: user.id, questionId: body.questionId } },
    select: { easiness: true, intervalDays: true, repetitions: true },
  });

  if (!card) return fail(404, 'CARD_NOT_FOUND');

  const next = reviewFlashcard(
    {
      easiness: Number(card.easiness),
      intervalDays: card.intervalDays,
      repetitions: card.repetitions,
    },
    gradeToQuality(body.grade as ReviewGrade),
  );

  await db.flashcardState.update({
    where: { userId_questionId: { userId: user.id, questionId: body.questionId } },
    data: {
      easiness: next.easiness,
      intervalDays: next.intervalDays,
      repetitions: next.repetitions,
      dueDate: next.dueDate,
      lastReviewedAt: new Date(),
    },
  });

  return ok({
    dueDate: next.dueDate.toISOString().slice(0, 10),
    intervalDays: next.intervalDays,
    easiness: next.easiness,
    lapsed: next.lapsed,
  });
});
