import { z } from 'zod';

import { assertSameOrigin, fail, noContent, ok, parseBody, route, unauthorized } from '@/lib/api';
import { apiUser } from '@/lib/auth/guards';
import { db } from '@/lib/db';

const patchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.enum(['planned', 'done', 'skipped']).optional(),
  durationMinutes: z.number().int().min(5).max(600).nullish(),
});

export const PATCH = route(async (request, context: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(request);

  const auth = await apiUser();
  if (!auth.ok) return unauthorized(auth);

  const { id } = await context.params;
  const body = await parseBody(request, patchSchema);

  const result = await db.studySession.updateMany({
    where: { id, userId: auth.user.id },
    data: {
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.durationMinutes !== undefined ? { durationMinutes: body.durationMinutes } : {}),
      ...(body.scheduledDate !== undefined
        ? { scheduledDate: new Date(`${body.scheduledDate}T00:00:00.000Z`) }
        : {}),
    },
  });

  if (result.count === 0) return fail(404, 'NOT_FOUND');
  return ok({ id, ...body });
});

export const DELETE = route(async (request, context: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(request);

  const auth = await apiUser();
  if (!auth.ok) return unauthorized(auth);

  const { id } = await context.params;
  const result = await db.studySession.deleteMany({ where: { id, userId: auth.user.id } });

  if (result.count === 0) return fail(404, 'NOT_FOUND');
  return noContent();
});
