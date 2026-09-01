import 'server-only';

import { revalidateTag, unstable_cache } from 'next/cache';

/**
 * The cache boundary for curriculum data.
 *
 * One rule decides what belongs here: **is this answer the same for every
 * student, and does it only change when ingestion runs?** The subject list, the
 * chapter tree, and how many chapters in a track actually have questions are all
 * yes — they were being recomputed per user, per request, for an answer that had
 * not moved since the last book was loaded.
 *
 * What must never come in here, however tempting:
 *
 *   * anything scoped to a user — mastery, attempts, due counts. A cache keyed
 *     loosely enough to be useful would serve one student another's numbers.
 *   * the exam clock. `expiresAt` is the authority on whether a paper is still
 *     open and is read on every answer write; a stale read there is a student
 *     writing into a closed paper, or being cut off early.
 *   * anything on the write path. Caching a read that a write depends on is how
 *     a mark gets computed from a number that has already changed.
 *
 * Invalidation is explicit rather than time-based, because ingestion is the only
 * thing that moves this data and it knows when it has finished.
 */

export const CURRICULUM_TAG = 'curriculum';

/** Long, because the real invalidation signal is the tag, not the clock. */
const CURRICULUM_TTL_SECONDS = 60 * 60;

/**
 * Wraps a track-global read. `keyParts` must capture everything the result
 * depends on — a cache keyed on less than the query reads is a correctness bug
 * that only shows up for the second caller.
 */
export function cacheCurriculum<Args extends unknown[], Result>(
  keyParts: string[],
  fn: (...args: Args) => Promise<Result>,
): (...args: Args) => Promise<Result> {
  return unstable_cache(fn, keyParts, {
    tags: [CURRICULUM_TAG],
    revalidate: CURRICULUM_TTL_SECONDS,
  });
}

/**
 * Called at the end of an ingestion run, and after the taxonomy loader writes.
 * Anything that changes what subjects or chapters exist must call this, or the
 * app will keep serving the previous programme for up to an hour.
 */
export function invalidateCurriculum(): void {
  revalidateTag(CURRICULUM_TAG);
}
