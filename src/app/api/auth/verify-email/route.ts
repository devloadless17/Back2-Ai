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
import { redeemToken, issueToken } from '@/lib/auth/tokens';
import { db } from '@/lib/db';
import { appLink, sendEmail } from '@/lib/email';

/**
 * Confirming an email address.
 *
 * POST with `{ token }` marks the address confirmed. POST with `{ email }`
 * sends a fresh link, because the first one expires in a day and lands in spam
 * often enough that "send it again" has to exist.
 *
 * The resend branch answers the same way whether or not the address is known.
 * Anything else turns this endpoint into a way to ask "does this person have an
 * account here", which for a product holding minors' exam results is not a
 * question a stranger gets to ask. The rate limit is per address for the same
 * reason — without it, the timing of a slow send answers what the body will not.
 */
const bodySchema = z.union([
  z.object({ token: z.string().min(20).max(200) }),
  z.object({ email: z.string().email().max(320) }),
]);

export const POST = route(async (request) => {
  assertSameOrigin(request);

  const body = await parseBody(request, bodySchema);

  if ('token' in body) {
    const redeemed = await redeemToken(body.token, 'email_verify');
    if (!redeemed) return fail(422, 'INVALID_TOKEN');

    await db.user.update({
      where: { id: redeemed.userId },
      data: { emailVerifiedAt: new Date() },
    });

    await recordAudit({
      actorUserId: redeemed.userId,
      action: AuditAction.EMAIL_VERIFIED,
      targetType: 'user',
      targetId: redeemed.userId,
    });

    return ok({ verified: true });
  }

  const email = body.email.trim().toLowerCase();

  const limit = rateLimit(clientKey(request, `verify:${email}`), 5, 60 * 60_000);
  if (!limit.allowed) return tooManyRequests(limit.retryAfter);

  const user = await db.user.findUnique({
    where: { email },
    select: { id: true, email: true, displayName: true, emailVerifiedAt: true, isActive: true },
  });

  // Already confirmed, disabled, or no such account: all answer the same.
  if (user && !user.emailVerifiedAt && user.isActive) {
    const token = await issueToken(user.id, 'email_verify');
    const link = appLink(`/verify-email?token=${encodeURIComponent(token)}`);
    await sendEmail({
      to: user.email,
      subject: 'Confirm your Bac II account',
      text:
        `${user.displayName ? `Hello ${user.displayName.split(' ')[0]},` : 'Hello,'}\n\n` +
        `Confirm your email address to start studying:\n\n${link}\n\n` +
        'The link works for 24 hours. If you did not create an account, ignore this message.',
    });
  }

  return ok({ sent: true });
});
