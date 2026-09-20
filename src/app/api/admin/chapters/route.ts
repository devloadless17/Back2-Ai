import { z } from 'zod';

import { assertSameOrigin, fail, ok, parseBody, route, unauthorized } from '@/lib/api';
import { AuditAction, recordAudit } from '@/lib/audit';
import { apiAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';

/**
 * Cancelling and restoring chapters.
 *
 * The ministry cuts chapters from the Lebanese programme some years, and the
 * cut is revised the next. Nothing is deleted: the questions, the passages and
 * any mastery a student already earned stay exactly where they are, and the
 * chapter stops being offered. See `LIVE_CHAPTER` for everywhere that applies.
 *
 * Every handler under /api/admin re-checks the role for itself. The sidebar
 * hiding the link and the page guard redirecting are UX; this is the boundary.
 */
const patchSchema = z
  .object({
    chapterId: z.string().uuid(),
    cancelled: z.boolean(),
    /**
     * Why, in the admin's own words. Kept because it is shown back on the admin
     * list — six months later "cancelled" alone does not say whether the
     * ministry cut it or somebody filed it in error, and those are undone
     * differently.
     */
    reason: z.string().trim().max(300).nullish(),
  })
  .strict();

export const PATCH = route(async (request) => {
  assertSameOrigin(request);

  const auth = await apiAdmin();
  if (!auth.ok) return unauthorized(auth);

  const body = await parseBody(request, patchSchema);

  const chapter = await db.chapter.findUnique({
    where: { id: body.chapterId },
    select: {
      id: true,
      name: true,
      cancelledAt: true,
      subject: { select: { name: true, track: { select: { code: true } } } },
    },
  });
  if (!chapter) return fail(404, 'NOT_FOUND');

  /*
   * What the student loses, counted before the write.
   *
   * Cancelling a chapter that 200 students have attempts against is a
   * different act from cancelling an empty one, and the admin gets no second
   * chance to notice. The numbers go into the audit record so the decision can
   * be reviewed afterwards with what was true at the time, not with what is
   * true whenever somebody reads the log.
   */
  const [attempts, questions] = await Promise.all([
    db.attempt.count({ where: { chapterId: chapter.id } }),
    db.question.count({
      where: { chapterId: chapter.id, verifiedStatus: { not: 'rejected' } },
    }),
  ]);

  const alreadyInTargetState = body.cancelled === (chapter.cancelledAt !== null);
  if (alreadyInTargetState) {
    // Not an error: two admins on the same list, or a double submit. Returning
    // the current state is more useful than a conflict nobody can act on.
    return ok({
      id: chapter.id,
      cancelled: chapter.cancelledAt !== null,
      unchanged: true,
    });
  }

  const updated = await db.chapter.update({
    where: { id: chapter.id },
    data: {
      cancelledAt: body.cancelled ? new Date() : null,
      cancelledReason: body.cancelled ? (body.reason ?? null) : null,
    },
    select: { id: true, cancelledAt: true, cancelledReason: true },
  });

  await recordAudit({
    actorUserId: auth.user.id,
    action: body.cancelled ? AuditAction.CHAPTER_CANCELLED : AuditAction.CHAPTER_RESTORED,
    targetType: 'chapter',
    targetId: chapter.id,
    metadata: {
      name: chapter.name,
      subject: chapter.subject.name,
      track: chapter.subject.track?.code ?? null,
      reason: body.reason ?? null,
      // What was behind it at the moment of the decision.
      attempts,
      questions,
    },
  });

  return ok({
    id: updated.id,
    cancelled: updated.cancelledAt !== null,
    cancelledAt: updated.cancelledAt?.toISOString() ?? null,
    cancelledReason: updated.cancelledReason,
  });
});
