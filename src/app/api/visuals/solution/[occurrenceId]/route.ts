import { fail, route, unauthorized } from '@/lib/api';
import { apiUser } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { getObject } from '@/lib/storage';
import { revealedQuestionIds } from '@/lib/visual-evidence';

/**
 * Serves an official-solution visual — and only to a student who has already
 * submitted the exercise it belongs to.
 *
 * This is an academic-integrity boundary, not a display preference. The bytes
 * live under `solution-images/`, which the general file route refuses, and the
 * reveal is proven here from rows the server wrote at submission (an attempt,
 * or a submitted exam simulation), never from anything the browser says. A
 * guessed or leaked key opens nothing: the lookup is by occurrence, and every
 * refusal is the same 404 so the response does not confirm the visual exists.
 */
export const GET = route(async (_request, context: { params: Promise<{ occurrenceId: string }> }) => {
  const auth = await apiUser();
  if (!auth.ok) return unauthorized(auth);
  const { user } = auth;
  const { occurrenceId } = await context.params;

  if (!/^[0-9a-f-]{36}$/i.test(occurrenceId)) return fail(404, 'NOT_FOUND');

  const occurrence = await db.visualOccurrence.findUnique({
    where: { id: occurrenceId },
    select: {
      access: true,
      storageKey: true,
      asset: { select: { mediaType: true } },
      relations: {
        where: { role: 'solution_material', status: 'active' },
        select: { questionId: true },
      },
    },
  });
  if (!occurrence || occurrence.access !== 'solution' || occurrence.relations.length === 0) {
    return fail(404, 'NOT_FOUND');
  }

  if (user.role !== 'admin') {
    const questionIds = occurrence.relations.map((r) => r.questionId);
    const revealed = await revealedQuestionIds(user.id, questionIds);
    if (revealed.size === 0) return fail(404, 'NOT_FOUND');
  }

  let bytes: Buffer;
  try {
    bytes = await getObject(occurrence.storageKey);
  } catch {
    return fail(404, 'NOT_FOUND');
  }

  return new Response(new Uint8Array(bytes), {
    headers: {
      'content-type': occurrence.asset.mediaType,
      'content-length': String(bytes.byteLength),
      'cache-control': 'private, no-store',
      'content-disposition': 'inline',
      'x-content-type-options': 'nosniff',
    },
  });
});
