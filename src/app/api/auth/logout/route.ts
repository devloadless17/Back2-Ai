import { NextResponse } from 'next/server';

import { assertSameOrigin, route } from '@/lib/api';
import { AuditAction, recordAudit } from '@/lib/audit';
import { getSession, destroyCurrentSession } from '@/lib/auth/session';

/**
 * Sign out.
 *
 * Submitted as a plain form POST from the sidebar, so signing out works with
 * JavaScript disabled. The session row is revoked server-side, not merely
 * cleared from the browser — clearing a cookie you no longer control is not
 * logging out.
 */
export const POST = route(async (request) => {
  assertSameOrigin(request);

  const session = await getSession();
  await destroyCurrentSession();

  if (session) {
    await recordAudit({
      actorUserId: session.user.id,
      action: AuditAction.LOGOUT,
      targetType: 'session',
      targetId: session.sessionId,
    });
  }

  return NextResponse.redirect(new URL('/login', request.url), { status: 303 });
});
