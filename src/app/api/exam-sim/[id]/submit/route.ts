import { assertSameOrigin, fail, ok, route, unauthorized } from '@/lib/api';
import { apiUser } from '@/lib/auth/guards';
import { ExamError, markSimulation, submitSimulation } from '@/lib/exam';

/**
 * Closes a paper. Returns immediately; marking happens after.
 *
 * The request carries no answers — everything was saved during the sitting.
 * Marking used to run here, one model call per question in series, which held
 * the connection for a minute or more and put the most consequential action in
 * the product behind whatever timeout sat in front of it. It now runs in the
 * `mark` job, and the results page shows each criterion as awaiting marking
 * until it lands.
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
    });

    /*
     * Start marking now, but do not make the student wait for it.
     *
     * The `mark` cron job is the guarantee that every paper is marked; this is
     * the reason a student does not sit watching an empty results page until the
     * next tick. Deliberately not awaited — awaiting it would put the model
     * calls back inside the request, which is the whole thing we just removed.
     *
     * Safe to fire twice. Marking skips slots that already carry `gradedAt`, so
     * if the cron tick and this call meet on the same paper the second one costs
     * a read and finds nothing to do.
     *
     * This continues after the response returns, which holds on a long-running
     * Node server — the same assumption ingestion already makes, and recorded in
     * the README's known gaps. On a platform that freezes the process after the
     * response this simply does nothing and the cron job marks the paper, which
     * is why the job is the guarantee and this is only the fast path.
     */
    if (result.status === 'submitted') {
      void markSimulation({ simulationId: id, userId: auth.user.id, auto: false }).catch((err) => {
        console.error('[exam-sim] inline marking failed; cron will retry', id, err);
      });
    }

    return ok(result);
  } catch (err) {
    if (err instanceof ExamError) return fail(err.code === 'NOT_FOUND' ? 404 : 409, err.code);
    throw err;
  }
});
