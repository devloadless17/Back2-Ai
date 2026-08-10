import { fail, ok, route, unauthorized } from '@/lib/api';
import { apiUser } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { getProgressForUser } from '@/lib/queries/progress';

/**
 * Chapter mastery and readiness for one student.
 *
 * The route is keyed by user id because the exec plan's map says so, but the id
 * in the path is authorization-irrelevant: a student may only ever read their
 * own, and an administrator reading a student's progress is an audited support
 * action, not routine browsing.
 */
export const GET = route(async (_request, context: { params: Promise<{ userId: string }> }) => {
  const auth = await apiUser();
  if (!auth.ok) return unauthorized(auth);

  const { userId } = await context.params;

  if (userId !== auth.user.id && auth.user.role !== 'admin') {
    // 404 rather than 403 — whether another account exists is not information
    // this endpoint should confirm.
    return fail(404, 'NOT_FOUND');
  }

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
      readiness: subject.readiness,
      chapters: subject.chapters.map((chapter) => ({
        chapterId: chapter.chapterId,
        chapterName: chapter.chapterName,
        unitName: chapter.unitName,
        masteryScore: chapter.masteryScore,
        attemptsCount: chapter.attemptsCount,
      })),
    })),
  });
});
