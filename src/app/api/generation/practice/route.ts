import { z } from 'zod';

import {
  assertSameOrigin,
  clientKey,
  fail,
  ok,
  parseBody,
  parseQuery,
  rateLimit,
  route,
  tooManyRequests,
  unauthorized,
} from '@/lib/api';
import { apiUser } from '@/lib/auth/guards';
import { budgetState } from '@/lib/ai';
import { db } from '@/lib/db';
import { isAiConfigured, isEmbeddingConfigured } from '@/lib/env';
import { PUBLISHED_FILTER, generateProblem } from '@/lib/generation';

/**
 * Serves an extra practice problem for a chapter.
 *
 * Pool first: approved, published generated problems the student has not
 * attempted. Only when that pool is empty does it generate live — and a live
 * generation does NOT come back to the student, because it has not been
 * reviewed. It goes to the review queue and the student is told the chapter is
 * out of extra problems for now.
 *
 * That is the admin-gated publication rule from the exec plan holding under
 * pressure. The tempting version of this endpoint hands the fresh problem
 * straight back, and quietly makes the review queue decorative.
 */
const bodySchema = z.object({ chapterId: z.string().uuid() });
const querySchema = z.object({ chapterId: z.string().uuid() });

/** Serves the next unattempted approved problem for a chapter, or null. */
async function serveFromPool(chapterId: string, userId: string) {
  const fromPool = await db.generatedProblem.findFirst({
    where: {
      chapterId,
      ...PUBLISHED_FILTER,
      attempts: { none: { userId } },
    },
    select: {
      id: true,
      contentText: true,
      contentLatex: true,
      difficulty: true,
      bareme: true,
    },
    orderBy: { publishedAt: 'desc' },
  });

  if (!fromPool) return null;

  return {
    id: fromPool.id,
    contentText: fromPool.contentText,
    contentLatex: fromPool.contentLatex,
    difficulty: fromPool.difficulty === null ? null : Number(fromPool.difficulty),
    baremeCriteriaCount: Array.isArray(fromPool.bareme) ? fromPool.bareme.length : 0,
  };
}

/**
 * Pool-only read.
 *
 * The exec plan describes this endpoint as "serve from pool, or trigger live
 * gen as fallback". The fallback lives on POST, not here: a GET that spends
 * money and writes rows is a GET that a prefetch, a retry or a crawler will
 * fire by accident. GET reports the pool as exhausted and the client asks for
 * a top-up explicitly.
 */
export const GET = route(async (request) => {
  const auth = await apiUser();
  if (!auth.ok) return unauthorized(auth);
  const { user } = auth;

  const query = parseQuery(request, querySchema);

  const chapter = await db.chapter.findFirst({
    where: { id: query.chapterId, subject: { trackId: user.trackId ?? undefined } },
    select: { id: true },
  });
  if (!chapter) return fail(404, 'CHAPTER_NOT_FOUND');

  const problem = await serveFromPool(chapter.id, user.id);

  return problem
    ? ok({ source: 'pool', problem })
    : ok({ source: 'exhausted', problem: null, queued: false });
});

export const POST = route(async (request) => {
  assertSameOrigin(request);

  const auth = await apiUser();
  if (!auth.ok) return unauthorized(auth);
  const { user } = auth;

  const body = await parseBody(request, bodySchema);

  const chapter = await db.chapter.findFirst({
    where: { id: body.chapterId, subject: { trackId: user.trackId ?? undefined } },
    select: { id: true },
  });
  if (!chapter) return fail(404, 'CHAPTER_NOT_FOUND');

  // --- Pool ---------------------------------------------------------------
  const fromPool = await serveFromPool(chapter.id, user.id);
  if (fromPool) return ok({ source: 'pool', problem: fromPool });

  // --- Nothing in the pool: top it up for next time -----------------------
  if (!isAiConfigured() || !isEmbeddingConfigured()) {
    return ok({ source: 'exhausted', problem: null, queued: false });
  }

  const limit = rateLimit(clientKey(request, `generate:${user.id}`), 5, 60 * 60_000);
  if (!limit.allowed) return tooManyRequests(limit.retryAfter);


  /*

   * The month's ceiling, checked before the spend rather than after it, so

   * the request that would cross the line is the one refused.

   */

  const budget = await budgetState(user.id);

  if (budget.exhausted) return fail(402, 'AI_BUDGET_EXHAUSTED');

  const outcome = await generateProblem({ chapterId: chapter.id, requestedBy: user.id });

  return ok({
    source: 'exhausted',
    problem: null,
    /** True when a new problem is now waiting for review, so the UI can say so. */
    queued: outcome.status === 'created',
  });
});
