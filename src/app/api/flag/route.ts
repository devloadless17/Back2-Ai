import { z } from 'zod';

import { assertSameOrigin, clientKey, created, parseBody, rateLimit, route, tooManyRequests, unauthorized } from '@/lib/api';
import { AuditAction, recordAudit } from '@/lib/audit';
import { apiUser } from '@/lib/auth/guards';
import { db } from '@/lib/db';

/**
 * Student-facing "report a problem".
 *
 * Writes to the review queue and stops there. A student can raise a concern
 * about any question or explanation; they cannot resolve one, and a flag does
 * not remove the content. Both halves of that are the point: reporting is
 * frictionless so it actually gets used, and acting on it needs an
 * administrator so it cannot be weaponised to delete a question a student
 * found hard.
 */
const bodySchema = z.object({
  itemType: z.enum(['generated_problem', 'tagged_question', 'flagged_content']),
  itemId: z.string().uuid(),
  reason: z.string().trim().min(3).max(2000),
});

export const POST = route(async (request) => {
  assertSameOrigin(request);

  const auth = await apiUser();
  if (!auth.ok) return unauthorized(auth);
  const { user } = auth;

  // Generous, but enough to stop a script filling the queue.
  const limit = rateLimit(clientKey(request, `flag:${user.id}`), 20, 60 * 60_000);
  if (!limit.allowed) return tooManyRequests(limit.retryAfter);

  const body = await parseBody(request, bodySchema);

  // Don't stack duplicate open flags from the same student on the same item.
  const existing = await db.reviewQueueItem.findFirst({
    where: { itemId: body.itemId, flaggedByUserId: user.id, status: 'pending' },
    select: { id: true },
  });

  if (existing) return created({ id: existing.id, alreadyReported: true });

  const item = await db.reviewQueueItem.create({
    data: {
      itemType: body.itemType,
      itemId: body.itemId,
      flagReason: body.reason,
      flaggedByUserId: user.id,
    },
    select: { id: true },
  });

  await recordAudit({
    actorUserId: user.id,
    action: AuditAction.CONTENT_FLAGGED,
    targetType: body.itemType,
    targetId: body.itemId,
    metadata: { reviewQueueItemId: item.id },
  });

  return created({ id: item.id, alreadyReported: false });
});
