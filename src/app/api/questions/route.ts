import { z } from 'zod';

import { fail, ok, parseQuery, route, unauthorized } from '@/lib/api';
import { apiUser } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { visualKeysFor } from '@/lib/visual-evidence';

/**
 * Question listing.
 *
 * Filtered to the student's track at the query level and stripped of anything
 * that would give the answer away: no `official_solution`, no
 * `correct_option_id`. Those are returned by /api/attempts *after* an answer is
 * submitted. A practice screen that ships the answer key in its own payload is
 * not a practice screen.
 */
const querySchema = z.object({
  chapterId: z.string().uuid().optional(),
  subjectId: z.string().uuid().optional(),
  type: z.enum(['mcq', 'open', 'problem']).optional(),
  /** Exclude questions the student has already attempted. */
  unattempted: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const GET = route(async (request) => {
  const auth = await apiUser();
  if (!auth.ok) return unauthorized(auth);
  const { user } = auth;

  const query = parseQuery(request, querySchema);
  if (!query.chapterId && !query.subjectId) return fail(422, 'CHAPTER_OR_SUBJECT_REQUIRED');

  const questions = await db.question.findMany({
    where: {
      verifiedStatus: { not: 'rejected' },
      ...(query.type ? { questionType: query.type } : {}),
      ...(query.unattempted === 'true' ? { attempts: { none: { userId: user.id } } } : {}),
      chapter: {
        subject: { trackId: user.trackId ?? undefined },
        ...(query.chapterId ? { id: query.chapterId } : {}),
        ...(query.subjectId ? { subjectId: query.subjectId } : {}),
      },
    },
    select: {
      id: true,
      questionType: true,
      difficulty: true,
      contentText: true,
      contentLatex: true,
      contentImages: true,
      options: true,
      bareme: true,
      sourceType: true,
      orderIndex: true,
      chapter: { select: { id: true, name: true } },
      sourceExam: { select: { id: true, year: true, session: true, title: true } },
      _count: { select: { attempts: { where: { userId: user.id } } } },
    },
    orderBy: [{ orderIndex: 'asc' }, { createdAt: 'asc' }],
    take: query.limit,
    skip: query.offset,
  });

  // The one visual selector — the same call Nour's retrieval makes.
  const visualKeys = await visualKeysFor(questions);

  return ok({
    questions: questions.map((question) => ({
      id: question.id,
      questionType: question.questionType,
      difficulty: question.difficulty === null ? null : Number(question.difficulty),
      contentText: question.contentText,
      contentLatex: question.contentLatex,
      contentImages: visualKeys.get(question.id) ?? [],
      options: question.options,
      /** Criteria only — the point values are the marking scheme, shown after marking. */
      baremeCriteriaCount: Array.isArray(question.bareme) ? question.bareme.length : 0,
      sourceType: question.sourceType,
      chapter: question.chapter,
      sourceExam: question.sourceExam,
      attemptedByYou: question._count.attempts > 0,
    })),
  });
});
