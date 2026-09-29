import { assertSameOrigin, fail, noContent, route, unauthorized } from '@/lib/api';
import { apiUser } from '@/lib/auth/guards';
import { db } from '@/lib/db';

/**
 * Deleting a conversation.
 *
 * The student's own, and only their own: the session is looked up BY id AND
 * user, so an id belonging to somebody else is a 404 and not a 403 — which
 * would confirm the id exists.
 *
 * The messages go with it, by the cascade already declared on
 * `ChatMessage.session`. Nothing else does: `questionId`, `attemptId` and
 * `subjectId` are `SetNull` relations to rows that belong to the corpus or to
 * the student's practice history, and a conversation about a question is not a
 * claim on the question. Deleting a chat must never take an attempt with it.
 *
 * Not soft-deleted. A chapter is hidden rather than removed because a student's
 * mastery hangs off it and the ministry reverses its cuts; a conversation is
 * the student's own writing, and someone who asks for it to be gone is owed
 * exactly that.
 */
export const DELETE = route(async (request, context: { params: Promise<{ sessionId: string }> }) => {
  assertSameOrigin(request);

  const auth = await apiUser();
  if (!auth.ok) return unauthorized(auth);

  const { sessionId } = await context.params;

  const session = await db.chatSession.findFirst({
    where: { id: sessionId, userId: auth.user.id },
    select: { id: true },
  });
  if (!session) return fail(404, 'NOT_FOUND');

  await db.chatSession.delete({ where: { id: session.id } });

  return noContent();
});
