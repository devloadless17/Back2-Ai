import { z } from 'zod';

import { assertSameOrigin, clientKey, fail, ok, parseBody, rateLimit, route, tooManyRequests } from '@/lib/api';
import { AuditAction, recordAudit } from '@/lib/audit';
import { dummyVerify, hashPassword, needsRehash, verifyPassword } from '@/lib/auth/password';
import { createSession } from '@/lib/auth/session';
import { db } from '@/lib/db';

const bodySchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(1).max(400),
});

/**
 * Sign in.
 *
 * Every failure returns the same message and takes comparable time, so this
 * endpoint cannot be used to discover which email addresses have accounts —
 * which, for a system whose user list is a roster of exam candidates, is itself
 * sensitive.
 */
export const POST = route(async (request) => {
  assertSameOrigin(request);

  // Per-IP, and deliberately tight: 10 attempts in 5 minutes is far more than a
  // person needs and far less than credential stuffing wants.
  const limit = rateLimit(clientKey(request, 'login'), 10, 5 * 60_000);
  if (!limit.allowed) return tooManyRequests(limit.retryAfter);

  const { email, password } = await parseBody(request, bodySchema);
  const normalizedEmail = email.toLowerCase();

  const user = await db.user.findFirst({
    where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
    select: { id: true, email: true, passwordHash: true, isActive: true },
  });

  if (!user) {
    // Burn comparable time so a missing account is not faster than a wrong password.
    await dummyVerify();
    await recordAudit({
      action: AuditAction.LOGIN_FAILED,
      targetType: 'email',
      metadata: { email: normalizedEmail, reason: 'no_such_user' },
    });
    return fail(401, 'INVALID_CREDENTIALS');
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    await recordAudit({
      actorUserId: user.id,
      action: AuditAction.LOGIN_FAILED,
      targetType: 'user',
      targetId: user.id,
      metadata: { reason: 'bad_password' },
    });
    return fail(401, 'INVALID_CREDENTIALS');
  }

  if (!user.isActive) {
    await recordAudit({
      actorUserId: user.id,
      action: AuditAction.LOGIN_FAILED,
      targetType: 'user',
      targetId: user.id,
      metadata: { reason: 'inactive' },
    });
    return fail(403, 'ACCOUNT_DISABLED');
  }

  // Transparently upgrade a hash produced under weaker parameters.
  if (needsRehash(user.passwordHash)) {
    const upgraded = await hashPassword(password);
    await db.user.update({ where: { id: user.id }, data: { passwordHash: upgraded } });
  }

  await createSession(user.id);
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  await recordAudit({
    actorUserId: user.id,
    action: AuditAction.LOGIN_SUCCEEDED,
    targetType: 'user',
    targetId: user.id,
  });

  return ok({ ok: true });
});
