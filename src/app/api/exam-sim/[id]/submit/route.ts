import { assertSameOrigin, fail, ok, route, unauthorized } from '@/lib/api';
import { apiUser } from '@/lib/auth/guards';
import { ExamError, submitSimulation } from '@/lib/exam';

/**
 * Submits a paper and marks it.
 *
 * The request carries no answers — everything was saved during the sitting.
 * This is the moment of consequence, and it deliberately takes a while: every
 * answer is marked against its snapshotted barème on the verify model.
 *
 * A paper whose deadline has already passed is still submitted rather than
 * rejected. The clock ran, so the sitting happened; refusing to mark it would
 * punish a student for a lost connection.
 */
export const POST = route(async (request, context: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(request);

  const auth = await apiUser();
  if (!auth.ok) return unauthorized(auth);

  const { id } = await context.params;

  try {
    const result = await submitSimulation({
      simulationId: id,
      userId: auth.user.id,
      auto: false,
      locale: auth.user.preferredLanguage,
    });

    return ok(result);
  } catch (err) {
    if (err instanceof ExamError) return fail(err.code === 'NOT_FOUND' ? 404 : 409, err.code);
    throw err;
  }
});
