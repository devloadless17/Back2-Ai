import { z } from 'zod';

import {
  assertSameOrigin,
  clientKey,
  ok,
  parseBody,
  rateLimit,
  route,
  tooManyRequests,
  unauthorized,
} from '@/lib/api';
import { apiUser } from '@/lib/auth/guards';
import { db } from '@/lib/db';

/**
 * Turning reminders off.
 *
 * A student who does not want a nightly email must be able to stop it from
 * inside the product, in one click, without asking anyone. Every reminder this
 * sends says so and links here; a reminder that cannot be switched off is not a
 * reminder, and an unsubscribe that requires support is the reason mail ends up
 * marked as spam.
 *
 * Not audited. This is a student's own preference about their own inbox, and
 * the audit log exists for actions someone may later have to account for —
 * password changes, track moves, an administrator disabling an account. Filling
 * it with preference flips would bury those.
 */
const bodySchema = z.object({
  emailReminders: z.boolean().optional(),
  pushReminders: z.boolean().optional(),
});

export const POST = route(async (request) => {
  assertSameOrigin(request);

  const auth = await apiUser();
  if (!auth.ok) return unauthorized(auth);
  const { user } = auth;

  const limit = rateLimit(clientKey(request, `reminders:${user.id}`), 30, 60_000);
  if (!limit.allowed) return tooManyRequests(limit.retryAfter);

  const body = await parseBody(request, bodySchema);

  await db.user.update({
    where: { id: user.id },
    data: {
      ...(body.emailReminders !== undefined ? { emailReminders: body.emailReminders } : {}),
      ...(body.pushReminders !== undefined ? { pushReminders: body.pushReminders } : {}),
    },
  });

  return ok({ saved: true });
});
