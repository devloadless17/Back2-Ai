import { z } from 'zod';

import { assertSameOrigin, created, fail, ok, parseBody, route, unauthorized } from '@/lib/api';
import { apiUser } from '@/lib/auth/guards';
import { db } from '@/lib/db';

/**
 * To-dos.
 *
 * Two shapes in one table: a freeform note, and a task linked to a chapter with
 * an action (`quiz`, `flashcards`, `practice`, `exam_sim`). The linked kind is
 * the useful one — "revise integrals" that taps straight through into practice
 * for that chapter closes the loop between deciding to study and studying.
 */
const createSchema = z.object({
  content: z.string().trim().min(1).max(500),
  linkedChapterId: z.string().uuid().nullish(),
  linkedAction: z.enum(['quiz', 'flashcards', 'practice', 'exam_sim']).nullish(),
});

export const GET = route(async () => {
  const auth = await apiUser();
  if (!auth.ok) return unauthorized(auth);

  const todos = await db.todo.findMany({
    where: { userId: auth.user.id },
    select: {
      id: true,
      content: true,
      isDone: true,
      linkedAction: true,
      createdAt: true,
      linkedChapter: { select: { id: true, name: true, subjectId: true } },
    },
    orderBy: [{ isDone: 'asc' }, { createdAt: 'desc' }],
  });

  return ok({ todos: todos.map((t) => ({ ...t, createdAt: t.createdAt.toISOString() })) });
});

export const POST = route(async (request) => {
  assertSameOrigin(request);

  const auth = await apiUser();
  if (!auth.ok) return unauthorized(auth);
  const { user } = auth;

  const body = await parseBody(request, createSchema);

  if (body.linkedChapterId) {
    const chapter = await db.chapter.findFirst({
      where: { id: body.linkedChapterId, subject: { trackId: user.trackId ?? undefined } },
      select: { id: true },
    });
    if (!chapter) return fail(404, 'CHAPTER_NOT_FOUND');
  }

  const todo = await db.todo.create({
    data: {
      userId: user.id,
      content: body.content,
      linkedChapterId: body.linkedChapterId ?? null,
      // An action without a chapter has nowhere to navigate to.
      linkedAction: body.linkedChapterId ? (body.linkedAction ?? null) : null,
    },
    select: {
      id: true,
      content: true,
      isDone: true,
      linkedAction: true,
      createdAt: true,
      linkedChapter: { select: { id: true, name: true, subjectId: true } },
    },
  });

  return created({ ...todo, createdAt: todo.createdAt.toISOString() });
});
