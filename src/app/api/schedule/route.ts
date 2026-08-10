import { z } from 'zod';

import { assertSameOrigin, created, fail, ok, parseBody, parseQuery, route, unauthorized } from '@/lib/api';
import { apiUser } from '@/lib/auth/guards';
import { db } from '@/lib/db';

/**
 * Study sessions — the planner.
 *
 * Both hand-made entries and accepted AI suggestions land here. The `source`
 * column keeps them distinguishable, which matters for evaluating whether the
 * suggested plans are any good: a plan whose sessions are all marked `skipped`
 * is a plan that was wrong about this student.
 */
const sessionSchema = z.object({
  title: z.string().trim().min(1).max(200),
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  chapterId: z.string().uuid().nullish(),
  durationMinutes: z.number().int().min(5).max(600).nullish(),
  source: z.enum(['manual', 'ai_suggested']).default('manual'),
});

/** Accepts one session or a whole accepted plan in a single request. */
const createSchema = z.union([sessionSchema, z.object({ sessions: z.array(sessionSchema).min(1).max(200) })]);

const querySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const GET = route(async (request) => {
  const auth = await apiUser();
  if (!auth.ok) return unauthorized(auth);

  const query = parseQuery(request, querySchema);

  const sessions = await db.studySession.findMany({
    where: {
      userId: auth.user.id,
      ...(query.from || query.to
        ? {
            scheduledDate: {
              ...(query.from ? { gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
              ...(query.to ? { lte: new Date(`${query.to}T00:00:00.000Z`) } : {}),
            },
          }
        : {}),
    },
    select: {
      id: true,
      title: true,
      scheduledDate: true,
      durationMinutes: true,
      source: true,
      status: true,
      chapter: { select: { id: true, name: true, subjectId: true } },
    },
    orderBy: [{ scheduledDate: 'asc' }, { createdAt: 'asc' }],
  });

  return ok({
    sessions: sessions.map((s) => ({
      ...s,
      scheduledDate: s.scheduledDate.toISOString().slice(0, 10),
    })),
  });
});

export const POST = route(async (request) => {
  assertSameOrigin(request);

  const auth = await apiUser();
  if (!auth.ok) return unauthorized(auth);
  const { user } = auth;

  const body = await parseBody(request, createSchema);
  const incoming = 'sessions' in body ? body.sessions : [body];

  // Validate every referenced chapter against the student's track in one query
  // rather than one per session — an accepted plan can be a hundred rows.
  const chapterIds = [...new Set(incoming.map((s) => s.chapterId).filter((id): id is string => Boolean(id)))];

  if (chapterIds.length > 0) {
    const allowed = await db.chapter.findMany({
      where: { id: { in: chapterIds }, subject: { trackId: user.trackId ?? undefined } },
      select: { id: true },
    });
    if (allowed.length !== chapterIds.length) return fail(404, 'CHAPTER_NOT_FOUND');
  }

  const result = await db.studySession.createMany({
    data: incoming.map((session) => ({
      userId: user.id,
      title: session.title,
      scheduledDate: new Date(`${session.scheduledDate}T00:00:00.000Z`),
      chapterId: session.chapterId ?? null,
      durationMinutes: session.durationMinutes ?? null,
      source: session.source,
    })),
  });

  return created({ created: result.count });
});
