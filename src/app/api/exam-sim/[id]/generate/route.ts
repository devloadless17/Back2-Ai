import { assertSameOrigin, fail, ok, route, unauthorized } from '@/lib/api';
import { apiUser } from '@/lib/auth/guards';
import { ExamError, composeGeneratedPaper } from '@/lib/exam';

/**
 * Composes the question set for an AI-generated paper.
 *
 * "Grounded-only" in the exec plan's sense, and enforced two layers down: the
 * pool this draws from is `verification_status = 'approved' AND published_at IS
 * NOT NULL`, so every question on the paper was written from real questions in
 * the same chapter, passed an independent solver check, and was approved by a
 * human. Nothing is generated at request time — a student sitting a paper is
 * not the moment to be inventing questions.
 *
 * Idempotent. Composing a paper that already has questions returns the existing
 * set rather than reshuffling it under a student mid-sitting.
 */
export const POST = route(async (request, context: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(request);

  const auth = await apiUser();
  if (!auth.ok) return unauthorized(auth);

  const { id } = await context.params;

  try {
    const result = await composeGeneratedPaper(id, auth.user.id);
    return ok(result);
  } catch (err) {
    if (err instanceof ExamError) {
      const status = err.code === 'NOT_FOUND' ? 404 : err.code === 'NO_CONTENT' ? 422 : 409;
      return fail(status, err.code);
    }
    throw err;
  }
});
