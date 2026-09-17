import { z } from 'zod';

import { assertSameOrigin, created, fail, parseBody, route, unauthorized } from '@/lib/api';
import { apiUser } from '@/lib/auth/guards';
import { db } from '@/lib/db';

/**
 * Give a backlog item a date, which turns it into a study session.
 *
 * A todo is an intention with no date; a session is a commitment with one.
 * Moving between them is a real change of kind, not a field edit, so it
 * happens here rather than by the client posting a session and then deleting a
 * todo — two requests that can half-fail and leave the same piece of work
 * sitting in the plan twice.
 *
 * The todo is removed, not marked done. `isDone` means the student finished
 * the work; this item has not been finished, it has been scheduled, and
 * recording it as completed would put a tick against something nobody did.
 * The work is not lost — it is the session this returns.
 *
 * `source` is `manual` and cannot be anything else. The student decided this,
 * not the planner, and the provenance column is the only thing that can tell
 * those apart later.
 */

const bodySchema = z.object({
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  durationMinutes: z.number().int().min(5).max(600).nullish(),
});

export const POST = route(async (request, context: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(request);

  const auth = await apiUser();
  if (!auth.ok) return unauthorized(auth);
  const { user } = auth;

  const { id } = await context.params;
  const body = await parseBody(request, bodySchema);

  const todo = await db.todo.findFirst({
    where: { id, userId: user.id },
    select: { id: true, content: true, linkedChapterId: true },
  });
  if (!todo) return fail(404, 'NOT_FOUND');

  const session = await db.$transaction(async (tx) => {
    const row = await tx.studySession.create({
      data: {
        userId: user.id,
        title: todo.content.slice(0, 200),
        scheduledDate: new Date(`${body.scheduledDate}T00:00:00.000Z`),
        chapterId: todo.linkedChapterId,
        durationMinutes: body.durationMinutes ?? null,
        source: 'manual',
      },
      select: { id: true, title: true, scheduledDate: true },
    });

    await tx.todo.delete({ where: { id: todo.id } });
    return row;
  });

  return created({
    id: session.id,
    title: session.title,
    scheduledDate: session.scheduledDate.toISOString().slice(0, 10),
  });
});
