import 'server-only';

import { db } from '@/lib/db';

/**
 * Whether a new student has actually used the three things the product does.
 *
 * Onboarding ends by asking six questions and then handing over a dashboard of
 * empty rings and zeroes, which is the least legible screen in the product for
 * exactly the person who has never seen it. This is the bridge: three real
 * actions, each landing in a real page, not a tour of tooltips.
 *
 * Every field is derived from work the student has done. There is no "dismissed"
 * flag and no completion record, because both would be state that can disagree
 * with reality — a student who has answered a question does not need to be told
 * they have, and one who has not is not helped by a card they dismissed on
 * another device. It retires itself the moment all three are true.
 */
export type FirstSteps = {
  askedTutor: boolean;
  answeredQuestion: boolean;
  reviewedCard: boolean;
  /**
   * Whether the student has a card to review at all.
   *
   * Not every exercise becomes one — `ensureCard` keeps only the card-shaped
   * questions, and a long past-paper problem is not one. So a student can
   * practise for a week and still have an empty deck, and suggesting they review
   * a card would leave a step they cannot complete sitting on their dashboard
   * for as long as they stay. When there is no deck, there is no third step.
   */
  hasCards: boolean;
  /** True once there is nothing left to suggest, and the card should not render. */
  done: boolean;
};

export async function getFirstSteps(userId: string): Promise<FirstSteps> {
  /*
   * A session is not enough for the tutor step: opening the chat creates one
   * before a word is typed, so counting sessions would tick the box for someone
   * who has done nothing. The student's own message is the evidence.
   */
  const [messages, attempts, cards, reviews] = await Promise.all([
    db.chatMessage.count({ where: { session: { userId }, role: 'user' } }),
    db.attempt.count({ where: { userId } }),
    db.flashcardState.count({ where: { userId } }),
    db.flashcardState.count({ where: { userId, lastReviewedAt: { not: null } } }),
  ]);

  const askedTutor = messages > 0;
  const answeredQuestion = attempts > 0;
  const hasCards = cards > 0;
  const reviewedCard = reviews > 0;

  return {
    askedTutor,
    answeredQuestion,
    reviewedCard,
    hasCards,
    // A step the student cannot reach does not count against them.
    done: askedTutor && answeredQuestion && (!hasCards || reviewedCard),
  };
}
