import { z } from 'zod';

import { assertSameOrigin, fail, ok, parseBody, route, unauthorized } from '@/lib/api';
import { AuditAction, recordAudit } from '@/lib/audit';
import { apiAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';

/**
 * Sets how long one subject's Bac paper runs — every paper of that subject
 * falls back to it unless the paper carries a confirmed length of its own.
 * Null clears it, and the subject's papers go back to the standard length.
 */
const patchSchema = z
  .object({
    subjectId: z.string().uuid(),
    durationMinutes: z.number().int().min(15).max(300).nullable(),
  })
  .strict();

export const PATCH = route(async (request) => {
  assertSameOrigin(request);

  const auth = await apiAdmin();
  if (!auth.ok) return unauthorized(auth);

  const body = await parseBody(request, patchSchema);

  const subject = await db.subject.findUnique({
    where: { id: body.subjectId },
    select: { id: true, name: true, examDurationMinutes: true, track: { select: { code: true } } },
  });
  if (!subject) return fail(404, 'NOT_FOUND');

  if (subject.examDurationMinutes === body.durationMinutes) {
    return ok({ durationMinutes: body.durationMinutes });
  }

  await db.subject.update({
    where: { id: subject.id },
    data: { examDurationMinutes: body.durationMinutes },
  });

  await recordAudit({
    action: AuditAction.EXAM_DURATION_SET,
    actorUserId: auth.user.id,
    targetType: 'subject',
    targetId: subject.id,
    metadata: {
      subject: subject.name,
      track: subject.track?.code ?? null,
      from: subject.examDurationMinutes,
      to: body.durationMinutes,
    },
  });

  return ok({ durationMinutes: body.durationMinutes });
});
