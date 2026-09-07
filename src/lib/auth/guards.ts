import { setMeterUser } from '@/lib/ai/meter-context';
import 'server-only';

import { redirect } from 'next/navigation';

import { getSession, type ActiveSession, type SessionUser } from '@/lib/auth/session';

/**
 * Authorization guards.
 *
 * Two families, because the failure mode differs:
 *   * `require*` — for server components/pages. Redirects.
 *   * `api*`     — for route handlers. Returns a typed result the handler turns
 *                  into a 401/403 response.
 *
 * Per the exec plan: hiding admin links in the sidebar is a UX nicety, not a
 * security boundary. Every admin page AND every /api/admin handler calls one of
 * these independently. There is no "the middleware already checked it" path.
 */

export async function requireSession(): Promise<ActiveSession> {
  const session = await getSession();
  if (!session) redirect('/login');
  return session;
}

export async function requireUser(): Promise<SessionUser> {
  return (await requireSession()).user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.user.role !== 'admin') redirect('/dashboard');
  return session.user;
}

export type ApiAuthResult =
  | { ok: true; session: ActiveSession; user: SessionUser }
  | { ok: false; status: 401 | 403; error: string };

export async function apiUser(): Promise<ApiAuthResult> {
  const session = await getSession();
  if (!session) return { ok: false, status: 401, error: 'Authentication required.' };
  // Name the student on the request's meter, so a model call made anywhere
  // beneath this is charged to them without the call site knowing.
  setMeterUser(session.user.id);
  return { ok: true, session, user: session.user };
}

export async function apiAdmin(): Promise<ApiAuthResult> {
  const session = await getSession();
  if (!session) return { ok: false, status: 401, error: 'Authentication required.' };
  if (session.user.role !== 'admin') {
    return { ok: false, status: 403, error: 'Administrator privileges required.' };
  }
  return { ok: true, session, user: session.user };
}
