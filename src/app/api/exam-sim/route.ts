import { z } from 'zod';

import { assertSameOrigin, created, fail, ok, parseBody, route, unauthorized } from '@/lib/api';
import { apiUser } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { ExamError, remainingSeconds, startSimulation } from '@/lib/exam';

/**
 * Starting a paper, and reporting whether one is already running.
 *
 * Composition happens here rather than on a separate `/generate` call: a
 * simulation and its question set are created in one transaction, so a paper
 * can never exist in a half-composed state that a student could open.
 */
const startSchema = z
  .object({
    subjectId: z.string().uuid(),
    sourceMode: z.enum(['real_cycle', 'ai_generated', 'real_mixed']),
    examCycleId: z.string().uuid().optional(),
  })
  .refine((body) => body.sourceMode !== 'real_cycle' || Boolean(body.examCycleId), {
    message: 'A real-cycle simulation needs an examCycleId.',
  });

export const POST = route(async (request) => {
  assertSameOrigin(request);

  const auth = await apiUser();
  if (!auth.ok) return unauthorized(auth);
  const { user } = auth;

  const body = await parseBody(request, startSchema);

  const subject = await db.subject.findFirst({
    where: { id: body.subjectId, trackId: user.trackId ?? undefined },
    select: { id: true },
  });
  if (!subject) return fail(404, 'SUBJECT_NOT_FOUND');

  try {
    const simulation = await startSimulation({
      userId: user.id,
      subjectId: subject.id,
      sourceMode: body.sourceMode,
      examCycleId: body.examCycleId ?? null,
    });
    return created({ id: simulation.id });
  } catch (err) {
    if (err instanceof ExamError) return fail(err.code === 'IN_PROGRESS_EXISTS' ? 409 : 422, err.code);
    throw err;
  }
});

/** The student's live paper, if any, plus their recent results. */
export const GET = route(async () => {
  const auth = await apiUser();
  if (!auth.ok) return unauthorized(auth);

  const [inProgress, recent] = await Promise.all([
    db.examSimulation.findFirst({
      where: { userId: auth.user.id, status: 'in_progress' },
      select: {
        id: true,
        expiresAt: true,
        status: true,
        subject: { select: { name: true } },
      },
    }),
    db.examSimulation.findMany({
      where: { userId: auth.user.id, status: 'graded' },
      select: {
        id: true,
        totalScore: true,
        maxScore: true,
        submittedAt: true,
        sourceMode: true,
        subject: { select: { name: true } },
      },
      orderBy: { submittedAt: 'desc' },
      take: 10,
    }),
  ]);

  return ok({
    inProgress: inProgress
      ? {
          id: inProgress.id,
          subjectName: inProgress.subject.name,
          remainingSeconds: remainingSeconds(inProgress),
        }
      : null,
    recent: recent.map((r) => ({
      id: r.id,
      subjectName: r.subject.name,
      sourceMode: r.sourceMode,
      totalScore: r.totalScore === null ? null : Number(r.totalScore),
      maxScore: r.maxScore === null ? null : Number(r.maxScore),
      submittedAt: r.submittedAt?.toISOString() ?? null,
    })),
  });
});
