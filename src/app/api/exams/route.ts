import { z } from 'zod';

import { assertSameOrigin, created, fail, noContent, ok, parseBody, route, unauthorized } from '@/lib/api';
import { apiUser } from '@/lib/auth/guards';
import { db } from '@/lib/db';

/**
 * Student-entered exam dates.
 *
 * These are what the scheduler plans towards. Every account starts with the
 * official Bac sitting already present (written at signup); school exams and
 * mock papers are added here.
 *
 * The Bac entry itself cannot be deleted — it is the fixed point the whole
 * product is oriented around, and an account with no exam date is an account
 * the planner has nothing to say to.
 */
const createSchema = z.object({
  subjectId: z.string().uuid().nullish(),
  examDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  label: z.string().trim().max(120).nullish(),
});

export const GET = route(async () => {
  const auth = await apiUser();
  if (!auth.ok) return unauthorized(auth);

  const exams = await db.upcomingExam.findMany({
    where: { userId: auth.user.id },
    select: {
      id: true,
      examDate: true,
      label: true,
      isBacExam: true,
      subject: { select: { id: true, name: true } },
    },
    orderBy: { examDate: 'asc' },
  });

  return ok({
    exams: exams.map((e) => ({ ...e, examDate: e.examDate.toISOString().slice(0, 10) })),
  });
});

export const POST = route(async (request) => {
  assertSameOrigin(request);

  const auth = await apiUser();
  if (!auth.ok) return unauthorized(auth);
  const { user } = auth;

  const body = await parseBody(request, createSchema);

  if (body.subjectId) {
    const subject = await db.subject.findFirst({
      where: { id: body.subjectId, trackId: user.trackId ?? undefined },
      select: { id: true },
    });
    if (!subject) return fail(404, 'SUBJECT_NOT_FOUND');
  }

  const exam = await db.upcomingExam.create({
    data: {
      userId: user.id,
      subjectId: body.subjectId ?? null,
      examDate: new Date(`${body.examDate}T00:00:00.000Z`),
      label: body.label ?? null,
      isBacExam: false,
    },
    select: { id: true },
  });

  return created({ id: exam.id });
});

const deleteSchema = z.object({ id: z.string().uuid() });

export const DELETE = route(async (request) => {
  assertSameOrigin(request);

  const auth = await apiUser();
  if (!auth.ok) return unauthorized(auth);

  const body = await parseBody(request, deleteSchema);

  const result = await db.upcomingExam.deleteMany({
    where: { id: body.id, userId: auth.user.id, isBacExam: false },
  });

  if (result.count === 0) return fail(404, 'NOT_FOUND');
  return noContent();
});
