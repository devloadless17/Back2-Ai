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
 * Naming the tutor.
 *
 * The only field in this product a student can write to their own account, and
 * it exists because a tutor you have named is yours in a way a "Chat" button is
 * not. Everything on the profile page is locked — track and language decide
 * which curriculum they are shown, so they are admin-only and audit-logged. A
 * nickname decides nothing, which is exactly why it can be theirs.
 *
 * Not audited, for the same reason: `recordAudit` is for actions someone might
 * later need to account for. A student renaming their tutor twice in a minute
 * is not one of them, and writing it down would only add noise to the log that
 * password changes and track moves have to be findable in.
 *
 * An empty string clears the name rather than storing one. Null means "never
 * named it", and both states show the locale's default — but a stored empty
 * string would be a third state that renders as a blank header.
 */
const MAX_NAME_LENGTH = 24;

const bodySchema = z.object({
  name: z.string().max(MAX_NAME_LENGTH),
});

export const POST = route(async (request) => {
  assertSameOrigin(request);

  const auth = await apiUser();
  if (!auth.ok) return unauthorized(auth);
  const { user } = auth;

  // Generous, because renaming twice while deciding is normal. It is here at
  // all so a stolen session cannot use a free-text column as scratch space.
  const limit = rateLimit(clientKey(request, `tutor-name:${user.id}`), 20, 60_000);
  if (!limit.allowed) return tooManyRequests(limit.retryAfter);

  const body = await parseBody(request, bodySchema);

  // Collapse whitespace before storing: a name is one line, and " Sara " and
  // "Sara" are the same name typed by someone who was not being careful.
  const cleaned = body.name.replace(/\s+/g, ' ').trim();
  const tutorName = cleaned.length > 0 ? cleaned : null;

  await db.user.update({ where: { id: user.id }, data: { tutorName } });

  return ok({ tutorName });
});
