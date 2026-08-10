import { fail, ok, route, unauthorized } from '@/lib/api';
import { apiUser } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { getProgressForUser } from '@/lib/queries/progress';

/**
 * Predicted readiness per subject.
 *
 * Computed live rather than read from `readiness_scores`. That table is the
 * cache the nightly job writes for reporting and trend history; serving it here
 * would mean a student who just finished a chapter is told tomorrow's number.
 * The components are returned alongside the score so the UI can explain it —
 * an unexplained percentage about a national exam is not a kindness.
 */
export const GET = route(async (_request, context: { params: Promise<{ userId: string }> }) => {
  const auth = await apiUser();
  if (!auth.ok) return unauthorized(auth);

  const { userId } = await context.params;
  if (userId !== auth.user.id && auth.user.role !== 'admin') return fail(404, 'NOT_FOUND');

  const target =
    userId === auth.user.id
      ? { id: auth.user.id, trackId: auth.user.trackId }
      : await db.user.findUnique({ where: { id: userId }, select: { id: true, trackId: true } });

  if (!target) return fail(404, 'NOT_FOUND');

  const progress = await getProgressForUser(target.id, target.trackId);

  return ok({
    subjects: progress.map((subject) => ({
      subjectId: subject.subjectId,
      subjectName: subject.subjectName,
      ...subject.readiness,
    })),
  });
});
