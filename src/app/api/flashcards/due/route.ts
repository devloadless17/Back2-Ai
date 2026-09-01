import { z } from 'zod';

import { ok, parseQuery, route, unauthorized } from '@/lib/api';
import { apiUser } from '@/lib/auth/guards';
import { getDueCards, type ReviewScope } from '@/lib/queries/flashcards';

const querySchema = z.object({
  scope: z.enum(['all', 'subject', 'unit', 'chapter', 'chapters', 'weak']).default('all'),
  id: z.string().uuid().optional(),
  /** Comma-separated chapter ids, for revising several chapters together. */
  ids: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(60).default(40),
  /**
   * Review a chosen scope even when nothing in it is due. The student asked;
   * the scheduler's opinion about next Tuesday is not a reason to refuse.
   */
  anyway: z.coerce.boolean().default(false),
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Cards due today for this student, in the requested scope. */
export const GET = route(async (request) => {
  const auth = await apiUser();
  if (!auth.ok) return unauthorized(auth);

  const query = parseQuery(request, querySchema);

  const chapterIds = (query.ids ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => UUID.test(id));

  const scope: ReviewScope =
    query.scope === 'chapters' && chapterIds.length > 0
      ? { kind: 'chapters', chapterIds }
      : query.scope === 'chapter' && query.id
        ? { kind: 'chapter', chapterId: query.id }
        : query.scope === 'unit' && query.id
          ? { kind: 'unit', unitId: query.id }
          : query.scope === 'subject' && query.id
            ? { kind: 'subject', subjectId: query.id }
            : query.scope === 'weak'
              ? { kind: 'weak' }
              : { kind: 'all' };

  const cards = await getDueCards(
    auth.user.id,
    auth.user.trackId,
    scope,
    query.limit,
    query.anyway,
  );
  return ok({ cards });
});
