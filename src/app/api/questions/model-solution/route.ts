import { z } from 'zod';

import { assertSameOrigin, clientKey, fail, ok, parseBody, rateLimit, route, tooManyRequests, unauthorized } from '@/lib/api';
import { budgetState } from '@/lib/ai';
import { apiUser } from '@/lib/auth/guards';
import { modelSolutionFor } from '@/lib/model-solution';

export const maxDuration = 60;

const bodySchema = z.object({ questionId: z.string().uuid() });

export const POST = route(async (request) => {
  assertSameOrigin(request);
  const auth = await apiUser();
  if (!auth.ok) return unauthorized(auth);
  const limit = rateLimit(clientKey(request, `model-solution:${auth.user.id}`), 30, 60 * 60_000);
  if (!limit.allowed) return tooManyRequests(limit.retryAfter);

  const body = await parseBody(request, bodySchema);
  const result = await modelSolutionFor({
    questionId: body.questionId,
    trackId: auth.user.trackId,
    // Only consulted when an answer has to be written; stored ones are free.
    canSpend: async () => !(await budgetState(auth.user.id)).exhausted,
  });
  if (result.status === 'not_found') return fail(404, 'QUESTION_NOT_FOUND');
  if (result.status === 'needs_budget') return fail(402, 'AI_BUDGET_EXHAUSTED');
  return ok(result);
});
