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
} from '@/lib/api';
import { AuditAction, recordAudit } from '@/lib/audit';
import { hashPassword } from '@/lib/auth/password';
import { createSession, revokeAllSessionsForUser } from '@/lib/auth/session';
import { redeemToken } from '@/lib/auth/tokens';
import { db } from '@/lib/db';

/**
 * Setting a new password from an emailed link.
 *
 * Three things happen together, and the order matters.
 *
 * The token is spent first, so a link cannot set two passwords. `redeemToken`
 * settles that in the database rather than here, because a double click is two
 * requests and a check followed by a write lets both through.
 *
 * Every other session is then revoked. Someone resetting a password because
 * their account was taken has to end the intruder's session, or the reset moves
 * the lock while the intruder is still inside — which is the whole reason
 * sessions in this system are stored rather than signed.
 *
 * The address is marked confirmed at the same time. Redeeming this link proves
 * the person reads that mailbox, which is the only thing confirmation ever
 * established; leaving them unverified would lock out an account that has just
 * proven itself, at the login gate, using a password they only now set.
 *
 * The caller is given a fresh session, so a reset ends signed in rather than at
 * a login form they have just been made to think about.
 */
const MIN_PASSWORD_LENGTH = 10;

const bodySchema = z.object({
  token: z.string().min(20).max(200),
  password: z.string().min(MIN_PASSWORD_LENGTH).max(400),
});

export const POST = route(async (request) => {
  assertSameOrigin(request);

  // Keyed on the caller: the token is single use, so this is guarding against
  // someone trying many tokens rather than one token being tried many times.
  const limit = rateLimit(clientKey(request, 'reset-password'), 10, 60 * 60_000);
  if (!limit.allowed) return tooManyRequests(limit.retryAfter);

  const body = await parseBody(request, bodySchema);

  const redeemed = await redeemToken(body.token, 'password_reset');
  if (!redeemed) return fail(422, 'INVALID_TOKEN');

  const user = await db.user.findUnique({
    where: { id: redeemed.userId },
    select: { id: true, isActive: true },
  });
  if (!user) return fail(422, 'INVALID_TOKEN');
  if (!user.isActive) return fail(403, 'ACCOUNT_DISABLED');

  await db.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hashPassword(body.password),
      emailVerifiedAt: new Date(),
    },
  });

  const revoked = await revokeAllSessionsForUser(user.id);
  await createSession(user.id);

  await recordAudit({
    actorUserId: user.id,
    action: AuditAction.PASSWORD_RESET,
    targetType: 'user',
    targetId: user.id,
    metadata: { sessionsRevoked: revoked },
  });

  return ok({ reset: true });
});
