/**
 * Deciding which printed exercise a flattened row came from.
 *
 * Kept apart from `place-flattened-rows.ts` so it can be tested without a
 * database or the corpus artifacts, the same way `book-exercise-guards.ts` is.
 *
 * The rows these rules serve lost their mathematics to the PDF text layer —
 * `2f(x) x lnx= +` where the paper prints `f(x) = x² + ln x`. Nothing can
 * rebuild the glyphs, so the exercise is located on its own paper and
 * photographed. Locating it wrongly would put a different exercise in front of
 * a student, which is worse than the flattened text, so the rules below are
 * deliberately hard to satisfy.
 */

/** Words only, three letters or more. The mangled symbols drop out with them. */
export const words = (s: string): string[] => s.toLowerCase().match(/[\p{L}]{3,}/gu) ?? [];

export function bag(list: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const w of list) m.set(w, (m.get(w) ?? 0) + 1);
  return m;
}

/**
 * Symmetric overlap, NOT containment.
 *
 * Containment — how much of the row appears in the candidate — scores a perfect
 * 1.0 whenever the row is short, because a sub-question's handful of words sits
 * inside dozens of unrelated exercises. Ranking on it left 61 rows tied at 1.0
 * and unplaceable. F1 charges the candidate for its own unmatched words, so a
 * long exercise can no longer swallow a short row.
 */
export function overlap(a: Map<string, number>, b: Map<string, number>): number {
  let hit = 0;
  let ta = 0;
  let tb = 0;
  for (const [w, n] of a) {
    ta += n;
    hit += Math.min(n, b.get(w) ?? 0);
  }
  for (const n of b.values()) tb += n;
  return ta && tb ? (2 * hit) / (ta + tb) : 0;
}

/**
 * The longest run of words the two texts share, in order.
 *
 * WHY A SCORE IS NOT ENOUGH ON ITS OWN. Bag overlap says how much wording is
 * shared, not that it is the SAME PASSAGE: two maths exercises about a curve
 * and its asymptote share nearly all their vocabulary. A long run in order
 * cannot happen by accident, and it survives the mangling, because the mangling
 * eats the symbols and leaves the prose.
 */
export function longestRun(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  let prev = new Array<number>(b.length + 1).fill(0);
  let best = 0;
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        cur[j] = prev[j - 1]! + 1;
        if (cur[j]! > best) best = cur[j]!;
      }
    }
    prev = cur;
  }
  return best;
}

/** A clear winner needs this much daylight over the next candidate. */
export const CLEAR_GAP = 0.1;
/** Candidates this close to the top are treated as tied. */
export const TIE = 0.05;
/** Below this the wording is not close enough to call it the same exercise. */
export const MIN_SCORE = 0.55;
/** No placement at all without a shared run of at least this many words. */
export const MIN_RUN = 6;
/** Long enough to settle a close call on its own. */
export const DECISIVE_RUN = 12;

export type Candidate = { session: string; ordinal: number; words: string[] };
export type Ranked = { score: number; candidate: Candidate };
export type Decision =
  | { accept: true; tied: Ranked[]; run: number }
  | { accept: false; reason: 'no-match' | 'ambiguous' | 'weak-anchor'; run: number };

/**
 * Whether the best-scoring candidate may be shown to a student.
 *
 * `ranked` must be sorted by score, highest first.
 *
 * A TIE IS USUALLY NOT AN AMBIGUITY. The same paper is printed more than once:
 * LH and SE sit the same science paper, and every session also has
 * accommodation editions (`ehtiyejet`, `makfufin`, `tarbeya mu5tasa`). Those
 * score identically because they ARE the same exercise, and any of their bands
 * shows the student the same printed page.
 *
 * THE RIVAL IS THE BEST CANDIDATE THAT DISAGREES, wherever it ranks. Reprints
 * of one exercise are not rivals however many there are, and a genuinely
 * different exercise is a rival even when it is scoring high enough to sit
 * inside the tie. Three mistakes are pinned here, all found by measuring:
 *
 *   - Accepting whenever the tied candidates agree waves through a LONE
 *     candidate, because one candidate trivially agrees with itself. That let a
 *     0.55 match past with a 0.48 rival right behind it.
 *   - Looking for the rival only OUTSIDE the tie misses the dangerous case
 *     entirely: a different exercise scoring within a whisker of the winner
 *     lands inside the tie, so there is nothing outside it, and the anchor test
 *     then compares against a rival run of zero and passes everything.
 *   - Rejecting every close call throws away correct placements. A row holding
 *     only part A of an exercise scores badly against the whole of it, which is
 *     why that 0.55 match was in fact correct. So a close call is allowed
 *     through on the anchor instead: the winner's run must be long in itself
 *     and clearly longer than the rival's.
 */
export function decide(rowWords: string[], ranked: Ranked[]): Decision {
  const best = ranked[0];
  if (!best || best.score < MIN_SCORE) return { accept: false, reason: 'no-match', run: 0 };

  const sameExercise = (k: Ranked) =>
    k.candidate.session === best.candidate.session && k.candidate.ordinal === best.candidate.ordinal;

  const run = longestRun(rowWords, best.candidate.words);
  const tied = ranked.filter((k) => best.score - k.score < TIE && sameExercise(k));
  const rival = ranked.find((k) => !sameExercise(k));

  if (rival && best.score - rival.score < CLEAR_GAP) {
    const rivalRun = longestRun(rowWords, rival.candidate.words);
    if (run < DECISIVE_RUN || run < rivalRun * 1.5) return { accept: false, reason: 'ambiguous', run };
  }
  if (run < MIN_RUN) return { accept: false, reason: 'weak-anchor', run };
  return { accept: true, tied, run };
}
