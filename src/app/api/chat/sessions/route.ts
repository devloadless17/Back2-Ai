import { z } from 'zod';

import { assertSameOrigin, created, fail, ok, parseBody, route, unauthorized } from '@/lib/api';
import { apiUser } from '@/lib/auth/guards';
import { db } from '@/lib/db';

/**
 * Conversations.
 *
 * A session may be anchored to a question (the "Explain this" button on a
 * practice screen) or to an uploaded image (the photo pipeline). Both are
 * stored on the session rather than the message, because they frame the entire
 * conversation, not one turn of it.
 */
const createSchema = z.object({
  questionId: z.string().uuid().optional(),
  /**
   * A marked attempt of the student's own. Anchoring to it is what turns the
   * conversation from "explain this question" into "mark my answer against the
   * correction key". The question is taken from the attempt, so a client cannot
   * pair someone else's answer with an arbitrary question.
   */
  attemptId: z.string().uuid().optional(),
  uploadedImageKey: z.string().max(512).optional(),
  title: z.string().trim().max(160).optional(),
});

export const POST = route(async (request) => {
  assertSameOrigin(request);

  const auth = await apiUser();
  if (!auth.ok) return unauthorized(auth);
  const { user } = auth;

  const body = await parseBody(request, createSchema);

  // An attempt must be this student's own — ownership is the whole point, since
  // the conversation will be handed what they wrote.
  let attemptQuestionId: string | null = null;
  if (body.attemptId) {
    const attempt = await db.attempt.findFirst({
      where: { id: body.attemptId, userId: user.id },
      select: { id: true, questionId: true },
    });
    if (!attempt) return fail(404, 'ATTEMPT_NOT_FOUND');
    attemptQuestionId = attempt.questionId;
  }

  // Prefer the attempt's own question over anything the client asked for: the
  // pair has to be consistent or the tutor would mark one answer against
  // another question's correction key.
  const questionId = attemptQuestionId ?? body.questionId ?? null;

  // An anchor question must be one this student is entitled to see.
  if (questionId) {
    const question = await db.question.findFirst({
      where: { id: questionId, chapter: { subject: { trackId: user.trackId ?? undefined } } },
      select: { id: true },
    });
    if (!question) return fail(404, 'QUESTION_NOT_FOUND');
  }

  const session = await db.chatSession.create({
    data: {
      userId: user.id,
      questionId,
      attemptId: body.attemptId ?? null,
      uploadedImageUrl: body.uploadedImageKey ?? null,
      title: body.title ?? null,
    },
    select: { id: true },
  });

  return created({ id: session.id });
});

export const GET = route(async () => {
  const auth = await apiUser();
  if (!auth.ok) return unauthorized(auth);

  const sessions = await db.chatSession.findMany({
    where: { userId: auth.user.id },
    select: { id: true, title: true, updatedAt: true, questionId: true },
    orderBy: { updatedAt: 'desc' },
    take: 50,
  });

  return ok({
    sessions: sessions.map((s) => ({
      id: s.id,
      title: s.title,
      anchored: Boolean(s.questionId),
      updatedAt: s.updatedAt.toISOString(),
    })),
  });
});
