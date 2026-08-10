import { z } from 'zod';

import { assertSameOrigin, fail, ok, parseBody, parseQuery, route, unauthorized } from '@/lib/api';
import { AuditAction, recordAudit } from '@/lib/audit';
import { apiAdmin } from '@/lib/auth/guards';
import { revokeAllSessionsForUser } from '@/lib/auth/session';
import { db } from '@/lib/db';
import { LOCALES } from '@/lib/i18n/config';

/**
 * The "contact us to change it" path.
 *
 * Track and language are locked at signup because changing a student's track
 * invalidates their entire mastery history — every chapter they have practised
 * belongs to a curriculum they are no longer sitting. That is a decision a
 * human should look at, which is why there is no self-service control for it
 * and why every change here is audit-logged with the administrator's identity.
 *
 * Deactivation revokes live sessions immediately rather than waiting for them
 * to expire. An account being disabled mid-exam is exactly the case the
 * server-side session store exists for.
 */
const querySchema = z.object({
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const GET = route(async (request) => {
  const auth = await apiAdmin();
  if (!auth.ok) return unauthorized(auth);

  const query = parseQuery(request, querySchema);

  const users = await db.user.findMany({
    where: query.q
      ? {
          OR: [
            { email: { contains: query.q, mode: 'insensitive' } },
            { displayName: { contains: query.q, mode: 'insensitive' } },
          ],
        }
      : undefined,
    select: {
      id: true,
      email: true,
      displayName: true,
      role: true,
      preferredLanguage: true,
      isActive: true,
      lastLoginAt: true,
      createdAt: true,
      track: { select: { id: true, code: true, name: true } },
      _count: { select: { attempts: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: query.limit,
  });

  return ok({
    users: users.map((user) => ({
      ...user,
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
      attemptCount: user._count.attempts,
    })),
  });
});

const patchSchema = z
  .object({
    id: z.string().uuid(),
    trackId: z.string().uuid().nullish(),
    preferredLanguage: z.enum(LOCALES).optional(),
    role: z.enum(['student', 'admin']).optional(),
    isActive: z.boolean().optional(),
    /** Required free-text justification — this is a support action on someone's record. */
    reason: z.string().trim().min(3).max(500),
  })
  .refine(
    (body) =>
      body.trackId !== undefined ||
      body.preferredLanguage !== undefined ||
      body.role !== undefined ||
      body.isActive !== undefined,
    { message: 'Nothing to change.' },
  );

export const PATCH = route(async (request) => {
  assertSameOrigin(request);

  const auth = await apiAdmin();
  if (!auth.ok) return unauthorized(auth);

  const body = await parseBody(request, patchSchema);

  const target = await db.user.findUnique({
    where: { id: body.id },
    select: {
      id: true,
      email: true,
      role: true,
      isActive: true,
      trackId: true,
      preferredLanguage: true,
    },
  });
  if (!target) return fail(404, 'NOT_FOUND');

  // An administrator removing their own admin rights, or disabling their own
  // account, locks everyone out of the review queue if they are the last one.
  if (target.id === auth.user.id && (body.role === 'student' || body.isActive === false)) {
    return fail(409, 'CANNOT_DEMOTE_SELF');
  }

  if (body.trackId) {
    const track = await db.track.findUnique({ where: { id: body.trackId }, select: { id: true } });
    if (!track) return fail(422, 'UNKNOWN_TRACK');
  }

  await db.user.update({
    where: { id: target.id },
    data: {
      ...(body.trackId !== undefined ? { trackId: body.trackId } : {}),
      ...(body.preferredLanguage !== undefined ? { preferredLanguage: body.preferredLanguage } : {}),
      ...(body.role !== undefined ? { role: body.role } : {}),
      ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
    },
  });

  // One audit event per field changed, so the log answers "who changed this
  // student's track, when, and why" without anyone parsing a diff.
  const events: { action: string; metadata: Record<string, unknown> }[] = [];

  if (body.trackId !== undefined && body.trackId !== target.trackId) {
    events.push({
      action: AuditAction.USER_TRACK_CHANGED,
      metadata: { from: target.trackId, to: body.trackId },
    });
  }
  if (body.preferredLanguage !== undefined && body.preferredLanguage !== target.preferredLanguage) {
    events.push({
      action: AuditAction.USER_LANGUAGE_CHANGED,
      metadata: { from: target.preferredLanguage, to: body.preferredLanguage },
    });
  }
  if (body.role !== undefined && body.role !== target.role) {
    events.push({
      action: AuditAction.USER_ROLE_CHANGED,
      metadata: { from: target.role, to: body.role },
    });
  }
  if (body.isActive !== undefined && body.isActive !== target.isActive) {
    events.push({
      action: body.isActive ? AuditAction.USER_REACTIVATED : AuditAction.USER_DEACTIVATED,
      metadata: {},
    });
  }

  for (const event of events) {
    await recordAudit({
      actorUserId: auth.user.id,
      action: event.action,
      targetType: 'user',
      targetId: target.id,
      metadata: { ...event.metadata, reason: body.reason },
    });
  }

  // A deactivated account must lose its live sessions now, not at TTL.
  let revoked = 0;
  if (body.isActive === false) {
    revoked = await revokeAllSessionsForUser(target.id);
    await recordAudit({
      actorUserId: auth.user.id,
      action: AuditAction.SESSIONS_REVOKED,
      targetType: 'user',
      targetId: target.id,
      metadata: { count: revoked, reason: body.reason },
    });
  }

  return ok({ id: target.id, changed: events.map((e) => e.action), sessionsRevoked: revoked });
});
