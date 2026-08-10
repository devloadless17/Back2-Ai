import { z } from 'zod';

import { ok, parseQuery, route, unauthorized } from '@/lib/api';
import { apiUser } from '@/lib/auth/guards';
import { getDueCards, type ReviewScope } from '@/lib/queries/flashcards';

const querySchema = z.object({
  scope: z.enum(['all', 'subject', 'unit', 'chapter']).default('all'),
  id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(60).default(40),
});

/** Cards due today for this student, in the requested scope. */
export const GET = route(async (request) => {
  const auth = await apiUser();
  if (!auth.ok) return unauthorized(auth);

  const query = parseQuery(request, querySchema);

  const scope: ReviewScope =
    query.scope === 'chapter' && query.id
      ? { kind: 'chapter', chapterId: query.id }
      : query.scope === 'unit' && query.id
        ? { kind: 'unit', unitId: query.id }
        : query.scope === 'subject' && query.id
          ? { kind: 'subject', subjectId: query.id }
          : { kind: 'all' };

  const cards = await getDueCards(auth.user.id, auth.user.trackId, scope, query.limit);
  return ok({ cards });
});
