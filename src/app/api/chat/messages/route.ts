import { z } from 'zod';

import {
  assertSameOrigin,
  clientKey,
  fail,
  parseBody,
  rateLimit,
  route,
  tooManyRequests,
  unauthorized,
} from '@/lib/api';
import { apiUser } from '@/lib/auth/guards';
import { encodeEvent, runChatTurn, titleFromQuestion, type AnchorAttempt } from '@/lib/chat';
import { budgetState } from '@/lib/ai';
import { db } from '@/lib/db';
import { isAiConfigured, isEmbeddingConfigured } from '@/lib/env';
import { parseBareme } from '@/lib/grading';
import { subjectIdsForStudent } from '@/lib/queries/taxonomy';
import { ownerFromKey } from '@/lib/storage';

/**
 * One chat turn, streamed.
 *
 * The response is newline-delimited JSON rather than plain text, because the
 * client needs more than tokens: it needs to know which retrieval tier fired
 * and what was cited *before* the answer starts arriving, so the grounding
 * label is on screen while the answer is still being written rather than
 * appearing after it.
 *
 * Streaming here is not decoration. A multi-step derivation takes real seconds
 * to produce, and a student watching a blank box concludes the app is broken.
 */
const bodySchema = z.object({
  sessionId: z.string().uuid(),
  content: z.string().trim().min(1).max(4000),
  /*
   * The photo this question is about, if one was clipped to it.
   *
   * A key, never a URL: the client is telling the server which stored object it
   * just uploaded, and the ownership check below decides whether it may. The
   * upload route returned it moments earlier.
   */
  imageKey: z.string().max(400).optional().nullable(),
});

/**
 * Long enough for a grounded answer to finish streaming.
 *
 * Streaming does not exempt a function from the execution ceiling — the clock
 * runs until the response closes, so a default of a few seconds truncates a
 * multi-step derivation mid-sentence and the student sees a half-answer with no
 * error. Retrieval plus a reasoning model comfortably exceeds that.
 *
 * 60 is Vercel's Hobby ceiling, so it deploys everywhere; raise it if the plan
 * allows and answers are being cut off.
 */
export const maxDuration = 60;

export const POST = route(async (request) => {
  assertSameOrigin(request);

  const auth = await apiUser();
  if (!auth.ok) return unauthorized(auth);
  const { user } = auth;

  if (!isAiConfigured() || !isEmbeddingConfigured()) return fail(503, 'AI_NOT_CONFIGURED');

  // Model calls cost money and latency; a runaway client should hit a wall.
  const limit = rateLimit(clientKey(request, `chat:${user.id}`), 30, 10 * 60_000);
  if (!limit.allowed) return tooManyRequests(limit.retryAfter);

  /*
   * The month's ceiling, checked before the spend rather than after it, so
   * the request that would cross the line is the one refused.
   */
  const budget = await budgetState(user.id);
  if (budget.exhausted) return fail(402, 'AI_BUDGET_EXHAUSTED');

  const body = await parseBody(request, bodySchema);

  /*
   * A key the student does not own is dropped, not refused.
   *
   * The same check `/api/files` makes before serving bytes, made here before
   * the key is written down: a message row pointing at someone else's upload
   * would render as their photograph inside this conversation. Dropping it
   * rather than failing the request keeps the question answerable — the text
   * is the question, the picture is evidence beside it.
   */
  const imageKey =
    body.imageKey && ownerFromKey(body.imageKey) === user.id ? body.imageKey : null;

  const session = await db.chatSession.findFirst({
    where: { id: body.sessionId, userId: user.id },
    select: {
      id: true,
      title: true,
      subjectId: true,
      /*
       * The language this subject is SAT in, which is not the student's account
       * language and is the better instruction for the tutor. A candidate
       * revising أدب عربي writes that paper in Arabic whether or not they typed
       * their question in arabizi.
       */
      // `name` as well as `language`: some prompt rules are properties of the
      // subject itself rather than of the question — the Arabic humanities are
      // marked on the textbook's exact wording. See `definitionsAreVerbatim`.
      subject: { select: { language: true, name: true } },
      question: { select: { id: true, contentText: true, officialSolution: true, bareme: true } },
      attempt: { select: { submittedAnswer: true, score: true, maxScore: true } },
      messages: {
        select: { role: true, content: true },
        orderBy: { createdAt: 'asc' },
        take: 20,
      },
    },
  });

  if (!session) return fail(404, 'SESSION_NOT_FOUND');

  // First question in a conversation names it, so the list is navigable.
  if (!session.title) {
    await db.chatSession.update({
      where: { id: session.id },
      data: { title: titleFromQuestion(body.content) },
    });
  }

  /*
   * The subjects this question may be answered from.
   *
   * The student's whole programme by default, and ONE subject when they named
   * one before the first message. Narrowing matters more than it looks: asked
   * "quelle est la différence entre le doute et la philosophie ?" against a
   * whole track, retrieval ranks a French literature passage at 0.528 above the
   * Arabic philosophy chapter that answers it at 0.399 — a confident answer
   * from the wrong subject, which is the failure the tiers exist to prevent.
   *
   * The stored id is still intersected with the student's own scope rather than
   * trusted. It was checked when it was written, but a subject can leave a
   * track between then and now — re-seeding the taxonomy replaces subject rows —
   * and a stale id must narrow to nothing rather than widen to somebody else's
   * material. If it no longer resolves, the whole programme is the safe
   * fallback: a worse search, never a search outside the track.
   */
  const allSubjectIds = await subjectIdsForStudent(user.trackId, user.preferredLanguage);
  const subjectIds =
    session.subjectId && allSubjectIds.includes(session.subjectId)
      ? [session.subjectId]
      : allSubjectIds;

  // Correction-key mode. Assembled here rather than in the pipeline so that the
  // pipeline keeps taking plain data and stays testable without a database.
  const anchorAttempt: AnchorAttempt | null = session.attempt
    ? {
        submittedAnswer: session.attempt.submittedAnswer,
        score: session.attempt.score === null ? null : Number(session.attempt.score),
        maxScore: session.attempt.maxScore === null ? null : Number(session.attempt.maxScore),
        bareme: parseBareme(session.question?.bareme) ?? [],
      }
    : null;

  const anchorPassage = session.question
    ? (
        await db.$queryRaw<{ source_passage: string | null }[]>`
          SELECT source_passage FROM questions WHERE id = ${session.question.id}::uuid
        `
      )[0]?.source_passage ?? null
    : null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of runChatTurn({
          userId: user.id,
          sessionId: session.id,
          question: body.content,
          imageKey,
          subjectIds,
          trackId: user.trackId,
          locale: user.preferredLanguage,
          /*
           * Null until the student names a subject, which is every conversation
           * started before the picker existed and every one that chooses
           * general help. The prompt falls back to their account language there,
           * which is the old behaviour and the best available guess when nobody
           * has said what is being revised.
           */
          subjectLanguage:
            session.subjectId && subjectIds.length === 1
              ? (session.subject?.language ?? null)
              : null,
          // Same condition, and deliberately so: a per-subject rule may only be
          // applied when exactly one subject is in scope. Across a whole track it
          // would assert one subject's marking convention over all of them.
          subjectName:
            session.subjectId && subjectIds.length === 1
              ? (session.subject?.name ?? null)
              : null,
          history: session.messages.map((m) => ({ role: m.role, content: m.content })),
          anchorQuestion: session.question && {
            ...session.question,
            /*
             * The extract printed on the paper this question is asked about.
             *
             * Fetched separately rather than added to the `select` above,
             * because `prisma generate` cannot refresh the client's types while
             * a dev server holds the query engine, and a chat turn must not
             * depend on whether somebody restarted it. Fold it into the select
             * once the client knows the column.
             */
            sourcePassage: anchorPassage,
          },
          anchorAttempt,
        })) {
          controller.enqueue(encodeEvent(event));
        }
      } catch (err) {
        console.error('[chat] stream failed', err);
        controller.enqueue(encodeEvent({ type: 'error', message: 'The assistant stopped unexpectedly.' }));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      // Tells nginx and similar not to buffer the stream into one response.
      'x-accel-buffering': 'no',
    },
  });
});
