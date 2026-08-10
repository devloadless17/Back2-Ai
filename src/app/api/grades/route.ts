import { z } from 'zod';

import { assertSameOrigin, created, fail, noContent, ok, parseBody, route, unauthorized } from '@/lib/api';
import { apiUser } from '@/lib/auth/guards';
import { db } from '@/lib/db';

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
  grade: z.number().min(0).max(1000),
  maxGrade: z.number().min(1).max(1000),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
});

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
      date: g.date ? g.date.toISOString().slice(0, 10) : null,
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

  if (body.subjectId) {
    const subject = await db.subject.findFirst({
      where: { id: body.subjectId, trackId: user.trackId ?? undefined },
      select: { id: true },
    });
    if (!subject) return fail(404, 'SUBJECT_NOT_FOUND');
  }

  const grade = await db.userGrade.create({
    data: {
      userId: user.id,
      subjectId: body.subjectId ?? null,
      label: body.label ?? null,
      grade: body.grade,
      maxGrade: body.maxGrade,
      date: body.date ? new Date(`${body.date}T00:00:00.000Z`) : null,
    },
    select: { id: true },
  });

  return created({ id: grade.id });
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
