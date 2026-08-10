import { z } from 'zod';

import { assertSameOrigin, fail, noContent, ok, parseBody, route, unauthorized } from '@/lib/api';
import { apiUser } from '@/lib/auth/guards';
import { db } from '@/lib/db';

const patchSchema = z.object({
  content: z.string().trim().min(1).max(500).optional(),
  isDone: z.boolean().optional(),
});

export const PATCH = route(async (request, context: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(request);

  const auth = await apiUser();
  if (!auth.ok) return unauthorized(auth);

  const { id } = await context.params;
  const body = await parseBody(request, patchSchema);

  // updateMany with the ownership predicate: an id belonging to someone else
  // matches zero rows rather than updating theirs.
  const result = await db.todo.updateMany({
    where: { id, userId: auth.user.id },
    data: {
      ...(body.content !== undefined ? { content: body.content } : {}),
      ...(body.isDone !== undefined ? { isDone: body.isDone } : {}),
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
  const result = await db.todo.deleteMany({ where: { id, userId: auth.user.id } });

  if (result.count === 0) return fail(404, 'NOT_FOUND');
  return noContent();
});
