import { z } from 'zod';

import { assertSameOrigin, fail, ok, parseBody, route, unauthorized } from '@/lib/api';
import { apiUser } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { subjectIdsForStudent } from '@/lib/queries/taxonomy';

/**
 * Which subject a conversation is about.
 *
 * `null` means "all of my subjects" — the general-help choice, and what every
 * conversation was before this existed. It is a real answer, not the absence of
 * one, so it is sent explicitly rather than by omitting the field.
 *
 * THE SUBJECT IS CHECKED AGAINST THE STUDENT'S OWN SCOPE, never taken on trust.
 * Scoping retrieval is the point of this column, so a client that could name any
 * subject id could read another track's material simply by naming it — the exact
 * hole `subjectIdsForStudent` exists to close on the retrieval side. Checking it
 * here as well means the guarantee does not depend on which call site reads the
 * column next.
 */
const schema = z.object({
  subjectId: z.string().uuid().nullable(),
});

export const PATCH = route(async (request, context: { params: Promise<{ sessionId: string }> }) => {
  assertSameOrigin(request);

  const auth = await apiUser();
  if (!auth.ok) return unauthorized(auth);
  const { user } = auth;

  const { sessionId } = await context.params;
  const body = await parseBody(request, schema);

  const session = await db.chatSession.findFirst({
    where: { id: sessionId, userId: user.id },
    select: { id: true },
  });
  if (!session) return fail(404, 'SESSION_NOT_FOUND');

  if (body.subjectId !== null) {
    const allowed = await subjectIdsForStudent(user.trackId, user.preferredLanguage);
    if (!allowed.includes(body.subjectId)) {
      return fail(403, 'SUBJECT_NOT_ON_PROGRAMME');
    }
  }

  await db.chatSession.update({
    where: { id: session.id },
    data: { subjectId: body.subjectId },
  });

  return ok({ subjectId: body.subjectId });
});
