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
import { AuditAction, recordAudit } from '@/lib/audit';
import { apiUser } from '@/lib/auth/guards';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { createSession, revokeAllSessionsForUser } from '@/lib/auth/session';
import { db } from '@/lib/db';

/**
 * Password change.
 *
 * Every other session is revoked on success and the caller is issued a fresh
 * one. If someone is changing their password because their account was
 * accessed, leaving the intruder's session alive would make the change
 * pointless — which is the entire reason sessions in this system are stored
 * rather than signed.
 */
const MIN_PASSWORD_LENGTH = 10;

const bodySchema = z.object({
  currentPassword: z.string().min(1).max(400),
  newPassword: z.string().min(MIN_PASSWORD_LENGTH).max(400),
});

export const POST = route(async (request) => {
  assertSameOrigin(request);

  const auth = await apiUser();
  if (!auth.ok) return unauthorized(auth);
  const { user } = auth;

  const limit = rateLimit(clientKey(request, `password:${user.id}`), 5, 60 * 60_000);
  if (!limit.allowed) return tooManyRequests(limit.retryAfter);

  const body = await parseBody(request, bodySchema);

  const record = await db.user.findUnique({
    where: { id: user.id },
    select: { passwordHash: true },
  });
  if (!record) return fail(404, 'NOT_FOUND');

  const valid = await verifyPassword(body.currentPassword, record.passwordHash);
  if (!valid) return fail(403, 'INVALID_CREDENTIALS');

  if (body.newPassword === body.currentPassword) return fail(422, 'PASSWORD_UNCHANGED');

  await db.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(body.newPassword) },
  });

  const revoked = await revokeAllSessionsForUser(user.id);
  await createSession(user.id);

  await recordAudit({
    actorUserId: user.id,
    action: AuditAction.PASSWORD_CHANGED,
    targetType: 'user',
    targetId: user.id,
    metadata: { sessionsRevoked: revoked },
  });

  return ok({ sessionsRevoked: revoked });
});
