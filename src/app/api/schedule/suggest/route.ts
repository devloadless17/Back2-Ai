import { z } from 'zod';

import {
  assertSameOrigin,
  clientKey,
  fail,
  ok,
  parseBody,
  rateLimit,
  route,
  tooManyRequests,
  unauthorized,
} from '@/lib/api';
import { apiUser } from '@/lib/auth/guards';
import { suggestSchedule } from '@/lib/scheduling';

/**
 * Proposes a revision plan for one upcoming exam.
 *
 * Returns the plan; it writes nothing. The student accepts, edits or discards
 * it in the UI, and accepting posts the rows to /api/schedule. A suggestion
 * that silently populated someone's calendar would not be a suggestion, and the
 * first thing they would learn is that the app puts things there without
 * asking.
 */
const bodySchema = z.object({ upcomingExamId: z.string().uuid() });

export const POST = route(async (request) => {
  assertSameOrigin(request);

  const auth = await apiUser();
  if (!auth.ok) return unauthorized(auth);
  const { user } = auth;

  const limit = rateLimit(clientKey(request, `suggest:${user.id}`), 10, 60 * 60_000);
  if (!limit.allowed) return tooManyRequests(limit.retryAfter);

  const body = await parseBody(request, bodySchema);

  const plan = await suggestSchedule(user.id, body.upcomingExamId, user.preferredLanguage);
  if (!plan) return fail(404, 'EXAM_NOT_FOUND');

  if (plan.sessions.length === 0) {
    // Nothing to plan is a real answer — the exam is tomorrow, or the syllabus
    // for it has not been ingested yet.
    return ok({ ...plan, reason: 'NO_DAYS_AVAILABLE' });
  }

  return ok(plan);
});
