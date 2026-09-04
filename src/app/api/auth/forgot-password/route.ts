import { z } from 'zod';

import {
  assertSameOrigin,
  clientKey,
  ok,
  parseBody,
  rateLimit,
  route,
  tooManyRequests,
} from '@/lib/api';
import { issueToken } from '@/lib/auth/tokens';
import { db } from '@/lib/db';
import { appLink, sendEmail } from '@/lib/email';

/**
 * Asking for a password reset link.
 *
 * Always answers `{ sent: true }`, whether or not the address has an account.
 * The alternative tells anyone who asks which email addresses are registered
 * here, and the people registered here are secondary-school students whose exam
 * results are attached to those addresses. "No account with that email" is a
 * small convenience and a permanent disclosure.
 *
 * The same reasoning drives the rest of the shape. The rate limit is keyed on
 * the address, not only the caller, so someone cannot walk a list from many
 * connections. Nothing is written to the audit log here — a row per request
 * would record precisely the distinction the response refuses to make; only a
 * completed reset is logged, in the route that completes it.
 *
 * A disabled account is not sent a link. It is also not told that it is
 * disabled: same response, no mail.
 */
const bodySchema = z.object({ email: z.string().email().max(320) });

export const POST = route(async (request) => {
  assertSameOrigin(request);

  const { email: raw } = await parseBody(request, bodySchema);
  const email = raw.trim().toLowerCase();

  // Six an hour per address: enough for someone who mistypes and retries,
  // little enough that the endpoint is not a way to send mail to a stranger.
  const limit = rateLimit(clientKey(request, `forgot:${email}`), 6, 60 * 60_000);
  if (!limit.allowed) return tooManyRequests(limit.retryAfter);

  const user = await db.user.findUnique({
    where: { email },
    select: { id: true, email: true, displayName: true, isActive: true },
  });

  if (user && user.isActive) {
    const token = await issueToken(user.id, 'password_reset');
    const link = appLink(`/reset-password?token=${encodeURIComponent(token)}`);
    await sendEmail({
      to: user.email,
      subject: 'Reset your Bac II password',
      text:
        `${user.displayName ? `Hello ${user.displayName.split(' ')[0]},` : 'Hello,'}\n\n` +
        `Someone asked to reset the password for this account. To set a new one:\n\n${link}\n\n` +
        'The link works for one hour and can be used once.\n\n' +
        'If this was not you, nothing has changed and you can ignore this message.',
    });
  }

  return ok({ sent: true });
});
