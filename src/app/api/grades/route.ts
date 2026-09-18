import { z } from 'zod';

import { assertSameOrigin, created, fail, noContent, ok, parseBody, route, unauthorized } from '@/lib/api';
import { apiUser } from '@/lib/auth/guards';
import { dayOf, toStoredDate } from '@/lib/calendar';
import { db } from '@/lib/db';
import { MAX_GRADE_VALUE, gradeIsWithinMax, mergeGrade } from '@/lib/grades';

/**
 * The student's own grade log.
 *
 * Passive by design, per the v1 decision: nothing here feeds mastery, readiness
 * or scheduling. It is a private record a student keeps alongside their
 * practice. Wiring school marks into the readiness prediction would mean a bad
 * week at school silently changing what the system tells them about the Bac,
 * from data the system cannot verify.
 */
const createSchema = z.object({
  subjectId: z.string().uuid().nullish(),
  label: z.string().trim().max(120).nullish(),
  grade: z.number().min(0).max(MAX_GRADE_VALUE),
  maxGrade: z.number().min(1).max(MAX_GRADE_VALUE),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
});

/**
 * A grade may only be filed under a subject on the student's own track.
 *
 * Shared by POST and PATCH rather than written twice: an edit that could move a
 * mark onto another track's subject would be a way around the track lock that
 * signup deliberately applies.
 */
async function subjectIsInTrack(subjectId: string, trackId: string | null): Promise<boolean> {
  const subject = await db.subject.findFirst({
    where: { id: subjectId, trackId: trackId ?? undefined },
    select: { id: true },
  });
  return subject !== null;
}

export const GET = route(async () => {
  const auth = await apiUser();
  if (!auth.ok) return unauthorized(auth);

  const grades = await db.userGrade.findMany({
    where: { userId: auth.user.id },
    select: {
      id: true,
      label: true,
      grade: true,
      maxGrade: true,
      date: true,
      subject: { select: { id: true, name: true } },
    },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
  });

  return ok({
    grades: grades.map((g) => ({
      id: g.id,
      label: g.label,
      grade: g.grade === null ? null : Number(g.grade),
      maxGrade: g.maxGrade === null ? null : Number(g.maxGrade),
      date: g.date ? dayOf(g.date) : null,
      subject: g.subject,
    })),
  });
});

export const POST = route(async (request) => {
  assertSameOrigin(request);

  const auth = await apiUser();
  if (!auth.ok) return unauthorized(auth);
  const { user } = auth;

  const body = await parseBody(request, createSchema);

  if (body.grade > body.maxGrade) return fail(422, 'GRADE_ABOVE_MAX');

  if (body.subjectId && !(await subjectIsInTrack(body.subjectId, user.trackId))) {
    return fail(404, 'SUBJECT_NOT_FOUND');
  }

  const grade = await db.userGrade.create({
    data: {
      userId: user.id,
      subjectId: body.subjectId ?? null,
      label: body.label ?? null,
      grade: body.grade,
      maxGrade: body.maxGrade,
      date: body.date ? toStoredDate(body.date) : null,
    },
    select: { id: true },
  });

  return created({ id: grade.id });
});

/**
 * Editing a logged mark.
 *
 * A student mistypes 14/20 as 41/20, or logs a mark before the teacher hands
 * back the corrected paper. Delete-and-retype was the only route, which loses
 * the row's date and its place in the log for no reason.
 *
 * EVERY FIELD IS OPTIONAL AND ABSENT MEANS UNCHANGED, which is why the schema
 * cannot check `grade <= maxGrade` on its own: a request that raises only the
 * maximum has no grade in it to compare against. The comparison is done below,
 * against the merged row.
 *
 * `label`, `subjectId` and `date` accept null explicitly — clearing a label is
 * a real edit and has to be distinguishable from not mentioning it.
 */
const updateSchema = z
  .object({
    id: z.string().uuid(),
    subjectId: z.string().uuid().nullish(),
    label: z.string().trim().max(120).nullish(),
    grade: z.number().min(0).max(MAX_GRADE_VALUE).optional(),
    maxGrade: z.number().min(1).max(MAX_GRADE_VALUE).optional(),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullish(),
  })
  .strict();

export const PATCH = route(async (request) => {
  assertSameOrigin(request);

  const auth = await apiUser();
  if (!auth.ok) return unauthorized(auth);
  const { user } = auth;

  const body = await parseBody(request, updateSchema);

  /*
   * Scoped to the owner in the read, not only in the write.
   *
   * `findFirst` with the user id means another student's grade id is a 404
   * rather than a 403 — it does not confirm that the row exists.
   */
  const existing = await db.userGrade.findFirst({
    where: { id: body.id, userId: user.id },
    select: { id: true, grade: true, maxGrade: true },
  });
  if (!existing) return fail(404, 'NOT_FOUND');

  // The row as it would be after this edit, so a partial update is validated
  // against what it actually produces rather than against the request alone.
  const merged = mergeGrade(
    {
      grade: existing.grade === null ? null : Number(existing.grade),
      maxGrade: existing.maxGrade === null ? null : Number(existing.maxGrade),
    },
    { grade: body.grade, maxGrade: body.maxGrade },
  );

  if (!gradeIsWithinMax(merged)) return fail(422, 'GRADE_ABOVE_MAX');

  if (body.subjectId && !(await subjectIsInTrack(body.subjectId, user.trackId))) {
    return fail(404, 'SUBJECT_NOT_FOUND');
  }

  await db.userGrade.update({
    where: { id: existing.id },
    data: {
      ...(body.subjectId !== undefined ? { subjectId: body.subjectId ?? null } : {}),
      ...(body.label !== undefined ? { label: body.label ?? null } : {}),
      ...(body.grade !== undefined ? { grade: body.grade } : {}),
      ...(body.maxGrade !== undefined ? { maxGrade: body.maxGrade } : {}),
      ...(body.date !== undefined
        ? { date: body.date ? toStoredDate(body.date) : null }
        : {}),
    },
  });

  return ok({ id: existing.id });
});

const deleteSchema = z.object({ id: z.string().uuid() });

export const DELETE = route(async (request) => {
  assertSameOrigin(request);

  const auth = await apiUser();
  if (!auth.ok) return unauthorized(auth);

  const body = await parseBody(request, deleteSchema);
  const result = await db.userGrade.deleteMany({ where: { id: body.id, userId: auth.user.id } });

  if (result.count === 0) return fail(404, 'NOT_FOUND');
  return noContent();
});
