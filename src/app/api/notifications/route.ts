import { z } from 'zod';

import { assertSameOrigin, ok, parseBody, parseQuery, route, unauthorized } from '@/lib/api';
import { apiUser } from '@/lib/auth/guards';
import { db } from '@/lib/db';

const querySchema = z.object({
  unreadOnly: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(30),
});

export const GET = route(async (request) => {
  const auth = await apiUser();
  if (!auth.ok) return unauthorized(auth);

  const query = parseQuery(request, querySchema);

  const notifications = await db.notification.findMany({
    where: { userId: auth.user.id, ...(query.unreadOnly === 'true' ? { isRead: false } : {}) },
    orderBy: { createdAt: 'desc' },
    take: query.limit,
  });

  return ok({
    notifications: notifications.map((n) => ({
      id: n.id,
      type: n.type,
      message: n.message,
      href: n.href,
      isRead: n.isRead,
      createdAt: n.createdAt.toISOString(),
    })),
  });
});

const markSchema = z.object({
  /** Omit to mark everything read. */
  ids: z.array(z.string().uuid()).max(100).optional(),
});

export const POST = route(async (request) => {
  assertSameOrigin(request);

  const auth = await apiUser();
  if (!auth.ok) return unauthorized(auth);

  const body = await parseBody(request, markSchema);

  const result = await db.notification.updateMany({
    // The userId predicate is what makes this safe: a supplied id that belongs
    // to another student simply matches nothing.
    where: { userId: auth.user.id, isRead: false, ...(body.ids ? { id: { in: body.ids } } : {}) },
    data: { isRead: true },
  });

  return ok({ marked: result.count });
});
