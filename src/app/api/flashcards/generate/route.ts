import { z } from 'zod';

import {
  assertSameOrigin,
  clientKey,
  fail,
  ok,
  parseBody,
  rateLimit,
  route,
  tooManyRequests,
  unauthorized,
} from '@/lib/api';
import { apiUser } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { seedChapterDeck } from '@/lib/flashcard-bank';

/**
 * Seeds a chapter's deck with cards written from its textbook passages.
 *
 * The deck could previously only be filled by practising, which made it emptiest
 * for the student who had done least — and gave them no way out but to go and
 * sit a practice session first. This is the way out.
 *
 * Three things guard it, in this order:
 *
 *   Authorisation. The chapter must belong to a subject in the student's own
 *   track. A chapter id is a uuid a client supplies, and without this check
 *   anyone could seed their deck from any track's material and read another
 *   syllabus through their own flashcards.
 *
 *   Rate. One request is roughly eleven model calls — one to draft, one to check
 *   each surviving card — so this is among the most expensive endpoints in the
 *   product. Six an hour is enough to seed six chapters in a sitting and not
 *   enough to be worth abusing.
 *
 *   Cost of a repeat. `seedChapterDeck` drops drafts that repeat cards the
 *   student already holds, so pressing the button twice on the same chapter
 *   tops it up instead of doubling it.
 */

/**
 * The platform's execution ceiling for this route.
 *
 * Node functions default to a handful of seconds, which this endpoint has never
 * fitted inside: it is one drafting call plus a check per surviving card. Those
 * checks now run concurrently — see `fillFlashcardBank` — which took a ten-card
 * request from about 48 seconds to roughly the cost of two calls, but "roughly
 * two calls" against a reasoning model is still far past any default.
 *
 * 60 rather than 300 on purpose: 60 is the ceiling on Vercel's Hobby plan, so
 * this number deploys everywhere. If the plan allows more and cards are being
 * generated in larger batches, this is the one number to raise.
 */
export const maxDuration = 60;

const bodySchema = z.object({
  chapterId: z.string().uuid(),
  /**
   * Capped at 20. The generator is asked for `count` and returns fewer once the
   * checks have run; asking for a hundred would spend a hundred verify calls to
   * discover the chapter only had material for nine.
   */
  count: z.coerce.number().int().min(1).max(20).default(10),
});

export const POST = route(async (request) => {
  assertSameOrigin(request);

  const auth = await apiUser();
  if (!auth.ok) return unauthorized(auth);
  const { user } = auth;

  const limit = rateLimit(clientKey(request, `cards:${user.id}`), 6, 60 * 60_000);
  if (!limit.allowed) return tooManyRequests(limit.retryAfter);

  const body = await parseBody(request, bodySchema);

  const chapter = await db.chapter.findFirst({
    where: {
      id: body.chapterId,
      subject: { trackId: user.trackId ?? undefined },
    },
    select: { id: true },
  });
  if (!chapter) return fail(404, 'CHAPTER_NOT_FOUND');

  const result = await seedChapterDeck({
    userId: user.id,
    chapterId: chapter.id,
    count: body.count,
  });

  // `status` is returned rather than folded into an error, because "no cards"
  // has three quite different causes and the screen says a different thing for
  // each: no API key configured, no passages loaded for this chapter, or
  // passages that yielded nothing a card could be made of.
  return ok({ added: result.added, status: result.status });
});
