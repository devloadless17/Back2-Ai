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
import { db } from '@/lib/db';
import { isPushConfigured } from '@/lib/push';

/**
 * Registering and forgetting a device.
 *
 * The browser owns the subscription; this only stores what is needed to send to
 * it. The endpoint is unique, so re-subscribing on a device that is already
 * registered updates it rather than adding a second row — browsers reissue
 * endpoints on their own schedule, and a student who has enabled notifications
 * twice should not get every reminder twice.
 *
 * DELETE removes only the endpoint given, not every device. Turning
 * notifications off on a shared family laptop must not silence the phone.
 */
const subscribeSchema = z.object({
  endpoint: z.string().url().max(2000),
  p256dh: z.string().min(1).max(500),
  auth: z.string().min(1).max(500),
});

export const POST = route(async (request) => {
  assertSameOrigin(request);

  const authResult = await apiUser();
  if (!authResult.ok) return unauthorized(authResult);
  const { user } = authResult;

  if (!isPushConfigured()) return fail(503, 'PUSH_NOT_CONFIGURED');

  const limit = rateLimit(clientKey(request, `push:${user.id}`), 20, 60_000);
  if (!limit.allowed) return tooManyRequests(limit.retryAfter);

  const body = await parseBody(request, subscribeSchema);

  /*
   * Keyed on the endpoint, not on (user, endpoint).
   *
   * A device handed from one student to another keeps its endpoint, and the
   * unique index is on the endpoint alone — so the update must move ownership
   * rather than leave the old account receiving reminders on hardware it no
   * longer has.
   */
  await db.pushSubscription.upsert({
    where: { endpoint: body.endpoint },
    create: {
      userId: user.id,
      endpoint: body.endpoint,
      p256dh: body.p256dh,
      auth: body.auth,
    },
    update: {
      userId: user.id,
      p256dh: body.p256dh,
      auth: body.auth,
      lastSeenAt: new Date(),
    },
  });

  await db.user.update({ where: { id: user.id }, data: { pushReminders: true } });

  return ok({ subscribed: true });
});

const unsubscribeSchema = z.object({ endpoint: z.string().url().max(2000) });

export const DELETE = route(async (request) => {
  assertSameOrigin(request);

  const authResult = await apiUser();
  if (!authResult.ok) return unauthorized(authResult);
  const { user } = authResult;

  const body = await parseBody(request, unsubscribeSchema);

  // Scoped to the caller: an endpoint is a bearer token for someone's lock
  // screen, and knowing one must not let you unregister another account's.
  await db.pushSubscription.deleteMany({ where: { userId: user.id, endpoint: body.endpoint } });

  const remaining = await db.pushSubscription.count({ where: { userId: user.id } });
  if (remaining === 0) {
    await db.user.update({ where: { id: user.id }, data: { pushReminders: false } });
  }

  return ok({ subscribed: false, remaining });
});
