import { z } from 'zod';

import { assertSameOrigin, fail, ok, parseBody, parseQuery, route, unauthorized } from '@/lib/api';
import { AuditAction, recordAudit } from '@/lib/audit';
import { apiAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';

/**
 * The review queue — the gate every piece of generated content passes through.
 *
 * Approving a generated problem is the single action in this system that makes
 * machine-written material visible to students. It sets `published_at`, and
 * nothing else in the codebase does. The exec plan calls that a deliberate
 * trust decision rather than a placeholder, so approval is audit-logged with
 * the reviewer's identity attached.
 */
const querySchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected']).default('pending'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const GET = route(async (request) => {
  const auth = await apiAdmin();
  if (!auth.ok) return unauthorized(auth);

  const query = parseQuery(request, querySchema);

  const items = await db.reviewQueueItem.findMany({
    where: { status: query.status },
    select: {
      id: true,
      itemType: true,
      itemId: true,
      flagReason: true,
      status: true,
      reviewNotes: true,
      createdAt: true,
      reviewedAt: true,
      flaggedBy: { select: { id: true, email: true, displayName: true } },
      reviewedBy: { select: { id: true, email: true, displayName: true } },
    },
    orderBy: { createdAt: 'asc' },
    take: query.limit,
  });

  // Hydrate the referenced content so a reviewer can decide without opening
  // another screen per item.
  const generatedIds = items.filter((i) => i.itemType === 'generated_problem').map((i) => i.itemId);
  const questionIds = items.filter((i) => i.itemType === 'tagged_question').map((i) => i.itemId);
  const messageIds = items.filter((i) => i.itemType === 'flagged_content').map((i) => i.itemId);
  const cardIds = items.filter((i) => i.itemType === 'generated_flashcard').map((i) => i.itemId);

  const [problems, questions, messages, cards] = await Promise.all([
    generatedIds.length
      ? db.generatedProblem.findMany({
          where: { id: { in: generatedIds } },
          select: {
            id: true,
            contentText: true,
            generatedSolution: true,
            finalAnswer: true,
            bareme: true,
            difficulty: true,
            verificationStatus: true,
            verificationNotes: true,
            modelUsed: true,
            promptVersion: true,
            publishedAt: true,
            chapter: { select: { name: true, subject: { select: { name: true } } } },
          },
        })
      : [],
    questionIds.length
      ? db.question.findMany({
          where: { id: { in: questionIds } },
          select: {
            id: true,
            contentText: true,
            officialSolution: true,
            verifiedStatus: true,
            chapter: { select: { name: true, subject: { select: { name: true } } } },
          },
        })
      : [],
    messageIds.length
      ? db.chatMessage.findMany({
          where: { id: { in: messageIds } },
          select: { id: true, content: true, groundingTier: true, createdAt: true },
        })
      : [],
    cardIds.length
      ? db.generatedCard.findMany({
          where: { id: { in: cardIds } },
          select: {
            id: true,
            front: true,
            back: true,
            modelUsed: true,
            retiredAt: true,
            chapter: { select: { name: true, subject: { select: { name: true } } } },
            sourceChunk: { select: { title: true, contentText: true } },
          },
        })
      : [],
  ]);

  const problemById = new Map(problems.map((p) => [p.id, p]));
  const questionById = new Map(questions.map((q) => [q.id, q]));
  const messageById = new Map(messages.map((m) => [m.id, m]));
  const cardById = new Map(cards.map((c) => [c.id, c]));

  return ok({
    items: items.map((item) => ({
      id: item.id,
      itemType: item.itemType,
      itemId: item.itemId,
      flagReason: item.flagReason,
      status: item.status,
      reviewNotes: item.reviewNotes,
      createdAt: item.createdAt.toISOString(),
      reviewedAt: item.reviewedAt?.toISOString() ?? null,
      flaggedBy: item.flaggedBy,
      reviewedBy: item.reviewedBy,
      content:
        item.itemType === 'generated_problem'
          ? serializeProblem(problemById.get(item.itemId))
          : item.itemType === 'tagged_question'
            ? (questionById.get(item.itemId) ?? null)
            : item.itemType === 'generated_flashcard'
              ? (cardById.get(item.itemId) ?? null)
              : (messageById.get(item.itemId) ?? null),
    })),
  });
});

function serializeProblem(problem: { difficulty: unknown; publishedAt: Date | null } | undefined) {
  if (!problem) return null;
  return {
    ...problem,
    difficulty: problem.difficulty === null ? null : Number(problem.difficulty),
    publishedAt: problem.publishedAt?.toISOString() ?? null,
  };
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

const decisionSchema = z.object({
  id: z.string().uuid(),
  decision: z.enum(['approve', 'reject']),
  notes: z.string().trim().max(2000).optional(),
});

export const POST = route(async (request) => {
  assertSameOrigin(request);

  const auth = await apiAdmin();
  if (!auth.ok) return unauthorized(auth);

  const body = await parseBody(request, decisionSchema);

  const item = await db.reviewQueueItem.findUnique({
    where: { id: body.id },
    select: { id: true, itemType: true, itemId: true, status: true },
  });

  if (!item) return fail(404, 'NOT_FOUND');
  if (item.status !== 'pending') return fail(409, 'ALREADY_REVIEWED');

  const approving = body.decision === 'approve';
  const now = new Date();

  await db.reviewQueueItem.update({
    where: { id: item.id },
    data: {
      status: approving ? 'approved' : 'rejected',
      reviewedByUserId: auth.user.id,
      reviewNotes: body.notes ?? null,
      reviewedAt: now,
    },
  });

  // --- Apply the decision to the content itself ---------------------------
  if (item.itemType === 'generated_problem') {
    await db.generatedProblem.update({
      where: { id: item.itemId },
      data: approving
        ? { verificationStatus: 'approved', publishedAt: now, verificationNotes: body.notes ?? undefined }
        : { verificationStatus: 'rejected', publishedAt: null, verificationNotes: body.notes ?? undefined },
    });

    if (approving) {
      await recordAudit({
        actorUserId: auth.user.id,
        action: AuditAction.GENERATED_PROBLEM_PUBLISHED,
        targetType: 'generated_problem',
        targetId: item.itemId,
        metadata: { reviewQueueItemId: item.id, notes: body.notes ?? null },
      });
    }
  }

  if (item.itemType === 'generated_flashcard') {
    /*
     * Inverted relative to a generated problem, because the card is already in
     * a student's deck by the time anyone sees this screen.
     *
     * "Approve" therefore changes nothing — it records that a human looked and
     * was content. "Reject" retires the card, which stops it being dealt from
     * the next page load without deleting the row this queue entry points at.
     */
    await db.generatedCard
      .update({
        where: { id: item.itemId },
        data: { retiredAt: approving ? null : now },
      })
      .catch(() => undefined);
  }

  if (item.itemType === 'tagged_question') {
    // "Approve" here means the flag was upheld — the question has a problem and
    // is withdrawn. Rejecting the flag leaves the question verified.
    await db.question
      .update({
        where: { id: item.itemId },
        data: { verifiedStatus: approving ? 'rejected' : 'verified' },
      })
      .catch(() => undefined);
  }

  await recordAudit({
    actorUserId: auth.user.id,
    action: approving ? AuditAction.REVIEW_ITEM_APPROVED : AuditAction.REVIEW_ITEM_REJECTED,
    targetType: item.itemType,
    targetId: item.itemId,
    metadata: { reviewQueueItemId: item.id, notes: body.notes ?? null },
  });

  return ok({ id: item.id, status: approving ? 'approved' : 'rejected' });
});
