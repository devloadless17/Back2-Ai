import { z } from 'zod';

import { assertSameOrigin, clientKey, fail, ok, parseBody, rateLimit, route, tooManyRequests, unauthorized } from '@/lib/api';
import { apiUser } from '@/lib/auth/guards';
import { answerFlashcardFromBook } from '@/lib/flashcard-answer';

export const maxDuration = 60;

const bodySchema = z.object({ questionId: z.string().uuid() });

export const POST = route(async (request) => {
  assertSameOrigin(request);
  const auth = await apiUser();
  if (!auth.ok) return unauthorized(auth);
  const limit = rateLimit(clientKey(request, `flashcard-answer:${auth.user.id}`), 20, 60 * 60_000);
  if (!limit.allowed) return tooManyRequests(limit.retryAfter);

  const body = await parseBody(request, bodySchema);
  const result = await answerFlashcardFromBook({ userId: auth.user.id, questionId: body.questionId });
  if (result.status === 'not_found') return fail(404, 'CARD_NOT_FOUND');
  return ok(result);
});
