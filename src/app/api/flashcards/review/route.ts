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
  /**
   * Which deck the card came from.
   *
   * Sent rather than guessed. Both ids are uuids, so a server that tried to
   * work out which table one belonged to would have to probe both — and would
   * grade the wrong card the day the two ever collided.
   */
  source: z.enum(['question', 'generated']).default('question'),
  cardId: z.string().uuid(),
  grade: z.enum(['again', 'hard', 'good', 'easy']),
});

export const POST = route(async (request) => {
  assertSameOrigin(request);

  const auth = await apiUser();
  if (!auth.ok) return unauthorized(auth);
  const { user } = auth;

  const body = await parseBody(request, bodySchema);

  /*
   * Whichever unique constraint applies. Both survived the migration that made
   * `question_id` nullable, so each kind of card is still a single indexed
   * lookup scoped to this user — a client cannot reschedule someone else's
   * card by knowing its id.
   */
  const where =
    body.source === 'generated'
      ? { userId_generatedCardId: { userId: user.id, generatedCardId: body.cardId } }
      : { userId_questionId: { userId: user.id, questionId: body.cardId } };

  const card = await db.flashcardState.findUnique({
    where,
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
    where,
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
