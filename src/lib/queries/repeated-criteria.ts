import 'server-only';

import { recurringLosses } from '@/lib/queries/recurring-losses';

/**
 * How often this student has lost marks on the criteria they just lost.
 *
 * FED FROM THE SERVER, NOT COMPUTED IN THE BROWSER. The persisted marking is
 * the authority: it spans every attempt the student has ever made, across
 * practice and exam simulations, and the runner holds only the handful of
 * questions currently on screen. A count derived from those would be smaller
 * than the truth and would change depending on which chapter they opened.
 *
 * THE THRESHOLD IS TWO, and it is the same two `recurringLosses` already uses
 * — that query refuses to report anything seen once, so a lower value here
 * would silently widen a rule set deliberately somewhere else. One prior slip
 * is not "this keeps costing you marks"; it is a coincidence, and telling a
 * student otherwise is the personalised-claim failure the dashboard work was
 * careful about.
 *
 * WHAT THE DATA SUPPORTS. A count of occasions and a total of marks forgone.
 * Not a time window, not marks "recoverable", not a prediction about the exam.
 * The attempt that just happened is included, because it is persisted before
 * this runs — so a criterion failed for the second time reports two.
 */

export type RepeatedCriterion = { times: number; pointsLost: number };

/** Below this, a repetition is a coincidence rather than a pattern. */
export const REPEAT_THRESHOLD = 2;

/**
 * Keyed by the criterion text, trimmed — the same key the marking result
 * carries, so the client can look up a row it already has without matching on
 * anything fuzzier.
 */
export async function repeatedCriteria(
  userId: string,
  criteria: string[],
): Promise<Record<string, RepeatedCriterion>> {
  if (criteria.length === 0) return {};

  /*
   * The whole history, then narrowed to the criteria on this page. Asking for
   * all of it is one query; asking per criterion would be one per row, and the
   * set is small — `recurringLosses` already caps and ranks what it returns.
   */
  const losses = await recurringLosses(userId, { limit: 50 });
  const wanted = new Set(criteria.map((c) => c.trim()));

  const out: Record<string, RepeatedCriterion> = {};
  for (const loss of losses) {
    const key = loss.criterion.trim();
    if (!wanted.has(key)) continue;
    if (loss.times < REPEAT_THRESHOLD) continue;
    out[key] = { times: loss.times, pointsLost: loss.pointsLost };
  }
  return out;
}
