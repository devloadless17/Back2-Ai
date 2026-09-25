import { z } from 'zod';

import { assertSameOrigin, fail, ok, parseBody, route, unauthorized } from '@/lib/api';
import { AuditAction, recordAudit } from '@/lib/audit';
import { apiAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';

/**
 * How long a paper is sat for.
 *
 * `exam_cycles.duration_minutes` defaults to 180 and `duration_is_official`
 * says whether that number came from the paper or from us. Across this corpus
 * 1,656 cycles carry the default and NONE is official, so a student sitting the
 * civics paper — printed «المدّة: ساعة واحدة» — is given three hours, and a
 * Mathematics SG paper that really runs four is given three. The timer is the
 * one part of an exam simulation that has to be true, because practising at the
 * wrong length is worse than not practising under time at all.
 *
 * The number is not read off the paper here. `extract_exams.py` could look for
 * "المدّة" and often find it, but a duration it guessed wrong is indistinguishable
 * from one it got right, and this is a claim about the real examination. A
 * person decides, and the decision is audited.
 *
 * SETTING A DURATION MAKES IT OFFICIAL, and clearing it takes that back rather
 * than leaving a number nobody stands behind. Those are the only two states
 * that mean anything: a duration with `official = false` is the fallback, and
 * the UI says so.
 *
 * Every handler under /api/admin re-checks the role for itself. The sidebar
 * hiding the link and the page guard redirecting are UX; this is the boundary.
 */
const patchSchema = z
  .object({
    examCycleId: z.string().uuid(),
    /**
     * Minutes, or null to hand the cycle back to the standard length.
     *
     * The ceiling is four hours because the longest paper the Lebanese Bac sets
     * is Mathematics SG at four, and the floor is fifteen minutes because
     * anything shorter is a typo rather than a paper. Neither is a rule about
     * examinations; both are a guard against a slip that would be invisible
     * afterwards.
     */
    durationMinutes: z.number().int().min(15).max(240).nullable(),
  })
  .strict();

export const PATCH = route(async (request) => {
  assertSameOrigin(request);

  const auth = await apiAdmin();
  if (!auth.ok) return unauthorized(auth);

  const body = await parseBody(request, patchSchema);

  const cycle = await db.examCycle.findUnique({
    where: { id: body.examCycleId },
    select: {
      id: true,
      year: true,
      session: true,
      durationMinutes: true,
      durationIsOfficial: true,
      subject: { select: { name: true, track: { select: { code: true } } } },
      /*
       * How many sittings already point at this cycle, counted before the
       * write. Changing the length of a paper students have already sat does
       * not rewrite their attempts, and the audit record should say how many
       * runs the old number produced.
       */
      _count: { select: { examSimulations: true } },
    },
  });
  if (!cycle) return fail(404, 'NOT_FOUND');

  const official = body.durationMinutes !== null;
  const minutes = body.durationMinutes ?? 180;

  if (minutes === cycle.durationMinutes && official === cycle.durationIsOfficial) {
    return ok({ durationMinutes: minutes, durationIsOfficial: official });
  }

  await db.examCycle.update({
    where: { id: cycle.id },
    data: { durationMinutes: minutes, durationIsOfficial: official },
  });

  await recordAudit({
    action: AuditAction.EXAM_DURATION_SET,
    actorUserId: auth.user.id,
    targetType: 'exam_cycle',
    targetId: cycle.id,
    metadata: {
      subject: cycle.subject.name,
      track: cycle.subject.track?.code ?? null,
      year: cycle.year,
      session: cycle.session,
      from: { minutes: cycle.durationMinutes, official: cycle.durationIsOfficial },
      to: { minutes, official },
      simulationsAlreadySat: cycle._count.examSimulations,
    },
  });

  return ok({ durationMinutes: minutes, durationIsOfficial: official });
});
