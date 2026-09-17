import type { NextUp } from '@/lib/queries/next-up';
import type { RecurringLoss } from '@/lib/queries/recurring-losses';
import { MIN_ATTEMPTS_FOR_WEAKNESS } from '@/lib/scoring/mastery';

/**
 * Which reason the dashboard is entitled to give for its next action.
 *
 * THE LADDER IS ORDERED BY STRENGTH OF EVIDENCE, not by how good the sentence
 * sounds. A criterion a student has failed three times is a stronger claim than
 * a low mastery score, which is stronger than "you have not started this", which
 * is stronger than nothing — and `none` is a real rung, not a failure. A new
 * account has no evidence and the honest output is the action with no argument
 * attached, never a personalised-sounding line that is true of everybody.
 *
 * SEPARATED FROM THE WORDING on purpose. The decision is about data and is
 * tested here; the sentence is about language and lives in the dictionaries, in
 * three of them. Fusing the two is how a product ends up with an English
 * sentence that is true and a French one that quietly is not.
 *
 * `pointsLost` IS MARKS ALREADY FORGONE, not marks recoverable. The brief's
 * mockups say "you could recover ~3 marks"; nothing in this schema supports a
 * counterfactual about marks a student would have got. What is stored is what
 * they did lose, and that is what the wording must claim.
 */

export type NextMoveReason =
  /** A barème criterion missed repeatedly. The strongest thing we know. */
  | { kind: 'recurringLoss'; criterion: string; times: number; pointsLost: number; subjectName: string }
  /** A chapter with enough attempts behind it to call weak. */
  | { kind: 'weakChapter'; chapterName: string; percent: number }
  /** Cards are due. True, timely, and the student's own backlog. */
  | { kind: 'flashcards'; count: number }
  /** Untouched material. Weak evidence, but honest. */
  | { kind: 'notStarted'; chapterName: string }
  /** Nothing is known yet. The action stands on its own. */
  | { kind: 'none' };

/**
 * How many times a criterion must have cost marks before it outranks a low
 * mastery score.
 *
 * Two, matching `recurringLosses` itself — that query already refuses to report
 * anything seen once, so a value below two here would silently widen a
 * threshold that was set deliberately somewhere else.
 */
const LOSS_TIMES_TO_LEAD = 2;

export function nextMoveReason(input: {
  next: NextUp;
  losses: RecurringLoss[];
  weakest: { chapterName: string; masteryScore: number; attemptsCount: number } | null;
}): NextMoveReason {
  const { next, losses, weakest } = input;

  /*
   * A repeated barème loss leads whenever one exists, even if the action itself
   * is flashcards — the student's most specific known weakness is worth saying
   * out loud regardless of which door we are pointing at. Ordered by marks
   * forgone, matching how `recurringLosses` ranks them.
   */
  const worst = losses.find((loss) => loss.times >= LOSS_TIMES_TO_LEAD);
  if (worst) {
    return {
      kind: 'recurringLoss',
      criterion: worst.criterion,
      times: worst.times,
      pointsLost: worst.pointsLost,
      subjectName: worst.subjectName,
    };
  }

  if (
    weakest &&
    weakest.attemptsCount >= MIN_ATTEMPTS_FOR_WEAKNESS &&
    // A chapter cannot be called weak on a perfect score, whatever the ranking
    // says about it relative to the others.
    weakest.masteryScore < 1
  ) {
    return {
      kind: 'weakChapter',
      chapterName: weakest.chapterName,
      percent: Math.round(weakest.masteryScore * 100),
    };
  }

  if (next.kind === 'flashcards' && next.count > 0) {
    return { kind: 'flashcards', count: next.count };
  }

  if (next.kind === 'newChapter') {
    return { kind: 'notStarted', chapterName: next.chapterName };
  }

  return { kind: 'none' };
}
