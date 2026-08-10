import { z } from 'zod';

import { assertSameOrigin, created, fail, ok, parseBody, route, unauthorized } from '@/lib/api';
import { AuditAction, recordAudit } from '@/lib/audit';
import { apiAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';

/**
 * Announcements.
 *
 * Every handler under /api/admin re-checks the role for itself. The sidebar
 * hiding the link and the page guard redirecting are UX; this is the boundary.
 */
const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(5000),
  targetTrackId: z.string().uuid().nullish(),
  targetSubjectId: z.string().uuid().nullish(),
});

export const GET = route(async () => {
  const auth = await apiAdmin();
  if (!auth.ok) return unauthorized(auth);

  const announcements = await db.announcement.findMany({
    select: {
      id: true,
      title: true,
      body: true,
      createdAt: true,
      targetTrack: { select: { id: true, code: true, name: true } },
      targetSubject: { select: { id: true, name: true } },
      author: { select: { id: true, displayName: true, email: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  return ok({
    announcements: announcements.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })),
  });
});

export const POST = route(async (request) => {
  assertSameOrigin(request);

  const auth = await apiAdmin();
  if (!auth.ok) return unauthorized(auth);

  const body = await parseBody(request, createSchema);

  const announcement = await db.announcement.create({
    data: {
      title: body.title,
      body: body.body,
      targetTrackId: body.targetTrackId ?? null,
      targetSubjectId: body.targetSubjectId ?? null,
      createdBy: auth.user.id,
    },
    select: { id: true },
  });

  /*
   * Fan out to the audience.
   *
   * The dashboard shows announcements, but only to students who happen to open
   * it. An announcement about a changed exam date is worth nothing if it waits
   * for the next visit, so it also lands in the notification list where the
   * sidebar badge will surface it.
   *
   * Targeting is applied here, not at read time: a student who transfers track
   * later should not retroactively receive notifications aimed at their old
   * one. Inactive accounts are skipped — nobody needs an unread badge waiting
   * on a suspended account.
   */
  // A subject-targeted announcement narrows to that subject's track, so the
  // notification audience matches what the dashboard will actually show.
  const subjectTrackId = body.targetSubjectId
    ? (
        await db.subject.findUnique({
          where: { id: body.targetSubjectId },
          select: { trackId: true },
        })
      )?.trackId ?? null
    : null;

  const effectiveTrackId = body.targetTrackId ?? subjectTrackId;

  const audience = await db.user.findMany({
    where: {
      isActive: true,
      ...(effectiveTrackId ? { trackId: effectiveTrackId } : {}),
    },
    select: { id: true },
  });

  if (audience.length > 0) {
    await db.notification.createMany({
      data: audience.map((student) => ({
        userId: student.id,
        type: 'announcement' as const,
        message: body.title,
        href: '/dashboard',
      })),
    });
  }

  await recordAudit({
    actorUserId: auth.user.id,
    action: AuditAction.ANNOUNCEMENT_CREATED,
    targetType: 'announcement',
    targetId: announcement.id,
    metadata: {
      title: body.title,
      targetTrackId: body.targetTrackId ?? null,
      targetSubjectId: body.targetSubjectId ?? null,
      effectiveTrackId,
      notified: audience.length,
    },
  });

  return created({ id: announcement.id, notified: audience.length });
});

const deleteSchema = z.object({ id: z.string().uuid() });

export const DELETE = route(async (request) => {
  assertSameOrigin(request);

  const auth = await apiAdmin();
  if (!auth.ok) return unauthorized(auth);

  const body = await parseBody(request, deleteSchema);

  const existing = await db.announcement.findUnique({
    where: { id: body.id },
    select: { id: true, title: true },
  });
  if (!existing) return fail(404, 'NOT_FOUND');

  await db.announcement.delete({ where: { id: existing.id } });

  await recordAudit({
    actorUserId: auth.user.id,
    action: AuditAction.ANNOUNCEMENT_DELETED,
    targetType: 'announcement',
    targetId: existing.id,
    metadata: { title: existing.title },
  });

  return ok({ deleted: existing.id });
});
