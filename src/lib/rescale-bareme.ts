import 'server-only';

import { z } from 'zod';

import { ai } from '@/lib/ai';
import { isAiConfigured } from '@/lib/env';
import { baremeMaxScore, type Bareme } from '@/lib/grading';

/**
 * Puts an assembled paper back on the Baccalaureate's scale.
 *
 * A mock paper is cut from real questions that were printed on different
 * papers, so their marks were never meant to add up together: three exercises
 * worth 6, 6 and 5 make a paper out of 17. Every figure in this product is
 * expressed out of 20 — `markOutOf20`, the predicted mark, readiness, the
 * dashboard — so a paper on its own private scale quietly feeds a different
 * unit into all of them, and `14 / 17` is not a Bac mark.
 *
 * ---------------------------------------------------------------------------
 * What this is allowed to touch, and what it is not.
 *
 * Only `exam_simulation_questions.bareme_snapshot`, which is the copy taken
 * when a paper is composed and the only thing marking reads. The question's own
 * barème — the one the ministry printed — is never written to. That separation
 * already existed for a different reason (editing a question must not re-mark a
 * paper already sat), and it is exactly what makes rescaling safe: the corpus
 * keeps the official marks, and one mock paper carries adjusted ones.
 *
 * It is never used on a `real_cycle` paper. Sitting an official paper means
 * sitting it as printed, marks included.
 * ---------------------------------------------------------------------------
 *
 * The model proposes and the code disposes, which is the pattern the rest of
 * this system uses for anything that decides marks. The model is asked to
 * redistribute because it can see which criterion in an exercise carries the
 * central idea and should keep its weight; but its answer is accepted only if
 * it returns the same criteria, all positive, totalling the target exactly. A
 * reply that fails any of those is discarded in favour of the arithmetic
 * fallback below — a model is not permitted to invent a criterion, drop one, or
 * hand back a paper that is not out of 20.
 */

const rescaleSchema = z.object({
  exercises: z.array(
    z.object({
      index: z.number().int(),
      points: z.array(z.number()),
    }),
  ),
});

const RESCALE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['exercises'],
  properties: {
    exercises: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['index', 'points'],
        properties: {
          index: { type: 'number' },
          points: { type: 'array', items: { type: 'number' } },
        },
      },
    },
  },
} as const;

/** Marks are printed in half-points on these papers, never finer. */
const STEP = 0.5;

function roundToStep(value: number): number {
  return Math.round(value / STEP) * STEP;
}

function total(baremes: Bareme[]): number {
  return Math.round(baremes.reduce((sum, b) => sum + baremeMaxScore(b), 0) * 100) / 100;
}

/**
 * Proportional rescaling, with the rounding drift pushed onto one criterion.
 *
 * The deterministic answer, used when no model is configured and whenever the
 * model's reply fails its checks. It is not as good — it has no view on which
 * criterion should absorb half a mark — but it always produces a paper that
 * totals exactly the target, which is the property that actually matters.
 */
export function rescaleArithmetically(baremes: Bareme[], target: number): Bareme[] {
  const current = total(baremes);
  if (current <= 0) return baremes;

  const factor = target / current;

  const scaled = baremes.map((bareme) =>
    bareme.map((criterion) => ({
      ...criterion,
      // Never zero: a criterion worth nothing is a criterion the marker is told
      // to assess and the student cannot earn anything for.
      points: Math.max(STEP, roundToStep(criterion.points * factor)),
    })),
  );

  /*
   * Rounding leaves the paper a little over or under. The difference is put on
   * the single largest criterion, because moving half a mark on a six-mark
   * criterion changes its weight least — spreading it would nudge every
   * criterion away from the proportion just calculated.
   */
  let drift = Math.round((target - total(scaled)) * 100) / 100;
  while (Math.abs(drift) >= STEP) {
    const step = drift > 0 ? STEP : -STEP;

    let bestExercise = 0;
    let bestCriterion = 0;
    let bestPoints = -Infinity;
    scaled.forEach((bareme, i) =>
      bareme.forEach((criterion, j) => {
        // Never take a criterion below one step.
        if (step < 0 && criterion.points <= STEP) return;
        if (criterion.points > bestPoints) {
          bestPoints = criterion.points;
          bestExercise = i;
          bestCriterion = j;
        }
      }),
    );
    if (bestPoints === -Infinity) break;

    scaled[bestExercise]![bestCriterion]!.points = Math.round(
      (scaled[bestExercise]![bestCriterion]!.points + step) * 100,
    ) / 100;
    drift = Math.round((drift - step) * 100) / 100;
  }

  return scaled;
}

/** Same criteria, in the same order, all positive, adding to the target. */
function isAcceptable(original: Bareme[], candidate: Bareme[], target: number): boolean {
  if (candidate.length !== original.length) return false;

  for (const [i, bareme] of candidate.entries()) {
    const source = original[i]!;
    if (bareme.length !== source.length) return false;
    for (const [j, criterion] of bareme.entries()) {
      if (criterion.criterion !== source[j]!.criterion) return false;
      if (!(criterion.points > 0)) return false;
    }
  }

  return Math.abs(total(candidate) - target) < 0.001;
}

/**
 * Redistributes an assembled paper's marks so it is worth exactly `target`.
 *
 * Falls back to arithmetic whenever the model is unavailable or its answer does
 * not survive the checks, so this function always returns a paper on the right
 * scale — it has no failure mode that leaves the caller with the wrong total.
 */
export async function rescaleBaremes(baremes: Bareme[], target: number): Promise<Bareme[]> {
  if (baremes.length === 0) return baremes;
  if (Math.abs(total(baremes) - target) < 0.001) return baremes;

  const fallback = rescaleArithmetically(baremes, target);
  if (!isAiConfigured()) return fallback;

  try {
    const response = await ai().completeJson({
      system: [
        `You are re-weighting a mock examination paper so that it is worth exactly ${target} marks.`,
        '',
        'You are given its exercises, each with its marking criteria and the marks those criteria',
        'carried on the original paper they came from. Those originals were written for different',
        'papers, so together they do not add up correctly.',
        '',
        'Rules:',
        '- Return the same exercises, in the same order, with the same number of marks as criteria.',
        '- Every mark must be a positive multiple of 0.5.',
        `- The marks across the whole paper must add up to exactly ${target}.`,
        '- Keep the relative weight of each exercise roughly as it was: an exercise that was worth',
        '  twice another should stay worth about twice it.',
        '- Within an exercise, keep the criterion that carries the central result the heaviest.',
        '- Do not rewrite, reorder, add or remove any criterion. You are only choosing numbers.',
      ].join('\n'),
      messages: [
        {
          role: 'user',
          content: baremes
            .map((bareme, index) =>
              [
                `## Exercise ${index} (currently ${baremeMaxScore(bareme)} marks)`,
                ...bareme.map((c) => `- [${c.points}] ${c.criterion}`),
              ].join('\n'),
            )
            .join('\n\n'),
        },
      ],
      schema: RESCALE_SCHEMA as unknown as Record<string, unknown>,
      schemaName: 'bareme_rescale',
      effort: 'low',
      parse: (value) => rescaleSchema.parse(value),
    });

    const byIndex = new Map(response.data.exercises.map((e) => [e.index, e.points]));
    const candidate: Bareme[] = baremes.map((bareme, index) => {
      const points = byIndex.get(index);
      if (!points || points.length !== bareme.length) return bareme;
      return bareme.map((criterion, j) => ({ ...criterion, points: points[j] ?? criterion.points }));
    });

    return isAcceptable(baremes, candidate, target) ? candidate : fallback;
  } catch {
    return fallback;
  }
}
