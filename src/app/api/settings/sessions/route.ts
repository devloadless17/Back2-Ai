import { assertSameOrigin, ok, route, unauthorized } from '@/lib/api';
import { AuditAction, recordAudit } from '@/lib/audit';
import { apiUser } from '@/lib/auth/guards';
import { createSession, revokeAllSessionsForUser } from '@/lib/auth/session';

/**
 * "Sign out all other devices."
 *
 * Revokes every session for this user and immediately issues a fresh one for
 * the caller, so the person who pressed the button is not signed out by their
 * own action. This is the self-service half of the revocation capability the
 * session store exists for — a student on a shared school machine who realises
 * they never signed out should not have to wait fourteen days for a TTL, or
 * open a support request.
 */
export const POST = route(async (request) => {
  assertSameOrigin(request);

  const auth = await apiUser();
  if (!auth.ok) return unauthorized(auth);

  const revoked = await revokeAllSessionsForUser(auth.user.id);
  await createSession(auth.user.id);

  await recordAudit({
    actorUserId: auth.user.id,
    action: AuditAction.SESSIONS_REVOKED,
    targetType: 'user',
    targetId: auth.user.id,
    // Minus one: the caller's own session was revoked and replaced.
    metadata: { count: Math.max(0, revoked - 1), initiatedBy: 'self' },
  });

  return ok({ revoked: Math.max(0, revoked - 1) });
});
