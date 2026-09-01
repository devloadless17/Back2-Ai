import type { Metadata } from 'next';

import { ReviewQueue, type ReviewItem } from '@/components/admin/review-queue';
import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';

export const metadata: Metadata = { title: 'Review queue' };

/**
 * The publication gate, and the audit bench beside it.
 *
 * Approving a generated *problem* here is the only action in the system that
 * makes machine-written practice material visible to students. Nothing changes
 * about that.
 *
 * Generated *flashcards* arrive on this screen having already been dealt, and
 * the distinction is deliberate rather than sloppy. A card is one student's
 * private revision prompt, written from a passage it cites and rejected unless
 * a second model call could answer it from that passage alone; a problem is
 * marked work that enters the shared corpus. Holding a card behind a human
 * queue would mean a student who wants ten cards tonight gets them whenever an
 * administrator next logs in, which is the same as not having the feature. So
 * the review is after the fact, and "reject" retires the card instead of
 * withholding it.
 */
export default async function ReviewQueuePage() {
  await requireAdmin();

  const items = await db.reviewQueueItem.findMany({
    where: { status: 'pending' },
    select: {
      id: true,
      itemType: true,
      itemId: true,
      flagReason: true,
      createdAt: true,
      flaggedBy: { select: { email: true, displayName: true } },
    },
    orderBy: { createdAt: 'asc' },
    take: 50,
  });

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
            difficulty: true,
            verificationStatus: true,
            verificationNotes: true,
            modelUsed: true,
            bareme: true,
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
            chapter: { select: { name: true, subject: { select: { name: true } } } },
          },
        })
      : [],
    messageIds.length
      ? db.chatMessage.findMany({
          where: { id: { in: messageIds } },
          select: { id: true, content: true, groundingTier: true },
        })
      : [],
    // The passage comes along. A card is only reviewable against the text it
    // claims to have been written from — without it a reviewer is being asked
    // whether the answer sounds right, which is the judgement the second model
    // call already made and the one a human adds nothing to.
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

  const prepared: ReviewItem[] = items.map((item) => {
    const problem = problemById.get(item.itemId);
    const question = questionById.get(item.itemId);
    const message = messageById.get(item.itemId);
    const card = cardById.get(item.itemId);

    return {
      id: item.id,
      itemType: item.itemType,
      flagReason: item.flagReason,
      createdAt: item.createdAt.toISOString(),
      flaggedBy: item.flaggedBy?.displayName ?? item.flaggedBy?.email ?? null,
      context: problem
        ? `${problem.chapter.subject.name} — ${problem.chapter.name}`
        : question
          ? `${question.chapter.subject.name} — ${question.chapter.name}`
          : card
            ? `${card.chapter.subject.name} — ${card.chapter.name}`
            : message?.groundingTier ?? null,
      body: problem?.contentText ?? question?.contentText ?? card?.front ?? message?.content ?? null,
      solution: problem?.generatedSolution ?? question?.officialSolution ?? card?.back ?? null,
      finalAnswer: problem?.finalAnswer ?? null,
      solverStatus: problem?.verificationStatus ?? null,
      solverNotes: problem?.verificationNotes ?? null,
      modelUsed: problem?.modelUsed ?? null,
      bareme: Array.isArray(problem?.bareme)
        ? (problem.bareme as { criterion?: unknown; points?: unknown }[]).map((c) => ({
            criterion: String(c?.criterion ?? ''),
            points: Number(c?.points ?? 0),
          }))
        : [],
    };
  });

  return <ReviewQueue items={prepared} />;
}
