import { z } from 'zod';

import { assertSameOrigin, created, fail, ok, parseBody, route, unauthorized } from '@/lib/api';
import { AuditAction, recordAudit } from '@/lib/audit';
import { apiAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { detectLanguage, translateAnnouncement } from '@/lib/announcements';

/**
 * Announcements.
 *
 * Every handler under /api/admin re-checks the role for itself. The sidebar
 * hiding the link and the page guard redirecting are UX; this is the boundary.
 *
 * TARGETING IS A SET OF TRACKS, and an empty set means the whole cohort. It was
 * one nullable track, which forced an admin announcing a changed exam date to
 * GS and LS to post it twice — and two posts drift, because one gets edited and
 * one does not.
 */
const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(5000),
  /**
   * Empty (or absent) reaches every track. Duplicates are harmless in the
   * request but would violate the join table's primary key, so they are
   * collapsed before the write rather than rejected — an admin ticking a box
   * twice through a resubmit has not made a mistake worth an error page.
   */
  targetTrackIds: z.array(z.string().uuid()).max(32).optional(),
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
      tracks: { select: { track: { select: { id: true, code: true, name: true } } } },
      targetSubject: { select: { id: true, name: true } },
      author: { select: { id: true, displayName: true, email: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  return ok({
    announcements: announcements.map((a) => ({
      ...a,
      tracks: a.tracks.map((t) => t.track),
      createdAt: a.createdAt.toISOString(),
    })),
  });
});

export const POST = route(async (request) => {
  assertSameOrigin(request);

  const auth = await apiAdmin();
  if (!auth.ok) return unauthorized(auth);

  const body = await parseBody(request, createSchema);

  const trackIds = [...new Set(body.targetTrackIds ?? [])];

  /*
   * Every named track has to exist.
   *
   * The form only ever submits ids it was handed, so this is not defending
   * against the UI. It is defending against a stale tab: a track deleted by
   * `db:prune` between page load and submit would otherwise fail on the
   * foreign key, and a constraint violation is a 500 where this is a 404.
   */
  if (trackIds.length > 0) {
    const found = await db.track.count({ where: { id: { in: trackIds } } });
    if (found !== trackIds.length) return fail(404, 'TRACK_NOT_FOUND');
  }

  /*
   * A subject-targeted announcement narrows to that subject's track, so the
   * notification audience matches what the dashboard will actually show.
   */
  const subjectTrackId = body.targetSubjectId
    ? (
        await db.subject.findUnique({
          where: { id: body.targetSubjectId },
          select: { trackId: true },
        })
      )?.trackId ?? null
    : null;

  if (body.targetSubjectId && subjectTrackId === null) return fail(404, 'SUBJECT_NOT_FOUND');

  /*
   * A CONTRADICTION IS REFUSED RATHER THAN SILENTLY NARROWED.
   *
   * "GS and LS" plus a subject that belongs to LH addresses nobody: the
   * dashboard applies both filters with AND, so the row would be written,
   * notify nobody, and appear on no dashboard. Picking the subject's track for
   * them would be a guess at which half of the form they meant. Saying so is
   * the only option that cannot be wrong.
   */
  if (subjectTrackId && trackIds.length > 0 && !trackIds.includes(subjectTrackId)) {
    return fail(422, 'TARGET_CONFLICT');
  }

  /*
   * Which language it was written in, read from the text rather than asked for.
   *
   * An admin posting a notice is thinking about the notice, not about a
   * language field, and the answer is in the words they just typed. It is
   * stored so the translations below know what they are translating FROM, and
   * so a student reading that language is never shown a translation of it.
   */
  const language = detectLanguage(`${body.title}
${body.body}`);

  const announcement = await db.announcement.create({
    data: {
      title: body.title,
      body: body.body,
      language,
      targetSubjectId: body.targetSubjectId ?? null,
      createdBy: auth.user.id,
      tracks: { createMany: { data: trackIds.map((trackId) => ({ trackId })) } },
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
  // The subject's own track counts as a target even when no box was ticked,
  // which is what keeps the notified set equal to the set that can see it.
  const effectiveTrackIds = trackIds.length > 0 ? trackIds : subjectTrackId ? [subjectTrackId] : [];

  const audience = await db.user.findMany({
    where: {
      isActive: true,
      ...(effectiveTrackIds.length > 0 ? { trackId: { in: effectiveTrackIds } } : {}),
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
      targetTrackIds: trackIds,
      targetSubjectId: body.targetSubjectId ?? null,
      effectiveTrackIds,
      notified: audience.length,
    },
  });

  /*
   * Translated before the response, so the first student to open the dashboard
   * already reads it in their own language. One admin action pays for it once;
   * doing it on read would pay per student and put a model call in front of a
   * page load. A failure is logged inside and never fails the post — the
   * announcement exists, in the language it was written in.
   */
  const translated = await translateAnnouncement(announcement.id);

  return created({ id: announcement.id, notified: audience.length, translated });
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
