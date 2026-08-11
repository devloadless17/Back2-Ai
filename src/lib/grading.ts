import 'server-only';

import { z } from 'zod';

import { ai } from '@/lib/ai';
import { env } from '@/lib/env';

/**
 * Barème marking engine.
 *
 * One engine, two entry paths — typed answers and photographed handwriting —
 * exactly as specified. The photo path differs only in that it runs an OCR
 * self-consistency gate *before* marking; everything downstream is identical,
 * so a student cannot be marked differently for having written on paper.
 *
 * Design constraints that come from this being an official examination system:
 *   * The model never invents criteria. It is given the barème and may only
 *     award points against the criteria it was handed.
 *   * Points awarded are clamped to the criterion's maximum server-side. A
 *     model that returns 7 out of 4 must not be able to inflate a mark.
 *   * Every criterion carries a written justification, so a contested mark can
 *     be reviewed by a human without re-running the model.
 *   * A refusal or a malformed response is surfaced as "needs human marking",
 *     never as a zero.
 */

/** A criterion as stored on `questions.bareme` / `generated_problems.bareme`. */
export const baremeCriterionSchema = z.object({
  criterion: z.string().min(1),
  points: z.number().min(0),
});

export const baremeSchema = z.array(baremeCriterionSchema).min(1);

export type BaremeCriterion = z.infer<typeof baremeCriterionSchema>;
export type Bareme = z.infer<typeof baremeSchema>;

/** A marked criterion as stored on `exam_answers.bareme_result`. */
export const baremeResultItemSchema = z.object({
  criterion: z.string(),
  points_awarded: z.number(),
  points_possible: z.number(),
  justification: z.string(),
});

export const baremeResultSchema = z.array(baremeResultItemSchema);

export type BaremeResultItem = z.infer<typeof baremeResultItemSchema>;

export type GradingOutcome = {
  status: 'graded' | 'needs_human_review';
  results: BaremeResultItem[];
  totalScore: number;
  maxScore: number;
  modelUsed: string | null;
  /** Populated when status is 'needs_human_review'. */
  reason?: string;
};

export type GradeInput = {
  questionText: string;
  officialSolution: string | null;
  bareme: Bareme;
  studentAnswer: string;
  /** Language the justification should be written in, so feedback matches the student's UI. */
  language: 'fr' | 'en' | 'ar';
};

const GRADING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['criteria'],
  properties: {
    criteria: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['criterion', 'points_awarded', 'justification'],
        properties: {
          criterion: { type: 'string' },
          points_awarded: { type: 'number' },
          justification: { type: 'string' },
        },
      },
    },
  },
} as const;

const gradingResponseSchema = z.object({
  criteria: z.array(
    z.object({
      criterion: z.string(),
      points_awarded: z.number(),
      justification: z.string(),
    }),
  ),
});

const LANGUAGE_NAME = { fr: 'French', en: 'English', ar: 'Arabic' } as const;

function gradingSystemPrompt(language: GradeInput['language']): string {
  return [
    'You are marking a Lebanese Baccalaureate answer against an official barème.',
    '',
    'Rules you must follow exactly:',
    '- Mark ONLY against the criteria you are given. Do not invent, merge, or split criteria.',
    '- Return one entry per criterion, in the order given, with the criterion text copied verbatim.',
    '- points_awarded must be between 0 and that criterion\'s maximum. Partial credit is expected and',
    '  encouraged where the student has done part of the work correctly.',
    '- Award marks for correct method even when the final numeric answer is wrong, unless the criterion',
    '  is explicitly about the final answer.',
    '- A different but mathematically valid method earns full marks. Do not penalise a student for not',
    '  matching the official solution\'s approach.',
    '- Do not penalise spelling, handwriting, or notation choices unless the criterion is about them.',
    `- Write each justification in ${LANGUAGE_NAME[language]}, in one or two sentences, addressed to the`,
    '  student. Say what earned the marks or what was missing — never just restate the criterion.',
    '',
    'You are marking a real examination. Be accurate and consistent, not generous and not harsh.',
  ].join('\n');
}

export async function gradeAgainstBareme(input: GradeInput): Promise<GradingOutcome> {
  const maxScore = input.bareme.reduce((sum, c) => sum + c.points, 0);

  // An empty answer is a zero, and does not need a model call to establish.
  if (input.studentAnswer.trim().length === 0) {
    return {
      status: 'graded',
      results: input.bareme.map((c) => ({
        criterion: c.criterion,
        points_awarded: 0,
        points_possible: c.points,
        justification: 'No answer was submitted for this question.',
      })),
      totalScore: 0,
      maxScore,
      modelUsed: null,
    };
  }

  const userPrompt = [
    '# Question',
    input.questionText,
    '',
    ...(input.officialSolution ? ['# Official solution (reference only)', input.officialSolution, ''] : []),
    '# Barème',
    ...input.bareme.map((c, i) => `${i + 1}. [${c.points} point(s)] ${c.criterion}`),
    '',
    "# Student's answer",
    input.studentAnswer,
  ].join('\n');

  try {
    const provider = ai();
    const response = await provider.completeJson({
      system: gradingSystemPrompt(input.language),
      messages: [{ role: 'user', content: userPrompt }],
      schema: GRADING_SCHEMA as unknown as Record<string, unknown>,
      schemaName: 'bareme_marking',
      effort: 'high',
      // Marking runs on the verify model: correctness matters more than latency.
      model: provider.verifyModel,
      parse: (value) => gradingResponseSchema.parse(value),
    });

    // Re-anchor on OUR barème, not the model's echo of it. If the model dropped,
    // reordered, or renamed a criterion, the authoritative list still wins.
    const byCriterion = new Map(response.data.criteria.map((c) => [normalize(c.criterion), c]));

    const results: BaremeResultItem[] = input.bareme.map((criterion) => {
      const marked = byCriterion.get(normalize(criterion.criterion));
      const awarded = clamp(marked?.points_awarded ?? 0, 0, criterion.points);

      return {
        criterion: criterion.criterion,
        points_awarded: round2(awarded),
        points_possible: criterion.points,
        justification: marked?.justification ?? 'This criterion could not be assessed automatically.',
      };
    });

    const unmatched = results.filter((r) => !byCriterion.has(normalize(r.criterion)));
    if (unmatched.length > 0) {
      return {
        status: 'needs_human_review',
        results,
        totalScore: round2(results.reduce((s, r) => s + r.points_awarded, 0)),
        maxScore,
        modelUsed: response.modelUsed,
        reason: `${unmatched.length} of ${input.bareme.length} criteria were not returned by the marker.`,
      };
    }

    return {
      status: 'graded',
      results,
      totalScore: round2(results.reduce((s, r) => s + r.points_awarded, 0)),
      maxScore,
      modelUsed: response.modelUsed,
    };
  } catch (err) {
    // A marking failure must never become a zero on a student's record.
    console.error('[grading] marking failed', err);
    return {
      status: 'needs_human_review',
      results: input.bareme.map((c) => ({
        criterion: c.criterion,
        points_awarded: 0,
        points_possible: c.points,
        justification: 'Automatic marking was unavailable for this answer.',
      })),
      totalScore: 0,
      maxScore,
      modelUsed: null,
      reason: err instanceof Error ? err.message : 'Unknown marking error.',
    };
  }
}

// ---------------------------------------------------------------------------
// OCR self-consistency gate (photo path only)
// ---------------------------------------------------------------------------

const CONSISTENCY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['legible', 'relevant', 'confidence', 'notes'],
  properties: {
    legible: { type: 'boolean' },
    relevant: { type: 'boolean' },
    confidence: { type: 'number' },
    notes: { type: 'string' },
  },
} as const;

const consistencyResponseSchema = z.object({
  legible: z.boolean(),
  relevant: z.boolean(),
  confidence: z.number(),
  notes: z.string(),
});

export type ConsistencyOutcome = {
  passed: boolean;
  confidence: number;
  notes: string;
};

/**
 * Checks that OCR output is a coherent, legible attempt at *this* question
 * before any of it reaches the marker.
 *
 * Without this gate, a blurry photo produces garbled text, the marker awards
 * zero against every criterion, and the student is told they failed a question
 * they may have answered correctly. Failing this check is not a mark — it is a
 * request to re-take the photo.
 */
export async function checkOcrConsistency(
  questionText: string,
  extractedText: string,
): Promise<ConsistencyOutcome> {
  if (extractedText.trim().length < 10) {
    return {
      passed: false,
      confidence: 0,
      notes: 'Almost no text could be read from the photo.',
    };
  }

  try {
    const response = await ai().completeJson({
      system: [
        'You check whether text extracted from a photo of handwritten exam work is usable for marking.',
        'You are NOT marking it. A wrong answer that is clearly written passes this check.',
        '',
        'legible  = the text reads as coherent written work, not OCR noise or fragments.',
        'relevant = the work is an attempt at the question given, not a different question or unrelated notes.',
        'confidence = 0..1, how confident you are that marking this text would be fair to the student.',
        'notes = one short sentence for the student if this fails; empty string if it passes.',
      ].join('\n'),
      messages: [
        {
          role: 'user',
          content: `# Question\n${questionText}\n\n# Text extracted from the photo\n${extractedText}`,
        },
      ],
      schema: CONSISTENCY_SCHEMA as unknown as Record<string, unknown>,
      schemaName: 'ocr_consistency',
      effort: 'medium',
      maxTokens: 1000,
      parse: (value) => consistencyResponseSchema.parse(value),
    });

    const { legible, relevant, confidence, notes } = response.data;
    return {
      passed: legible && relevant && confidence >= 0.6,
      confidence: clamp(confidence, 0, 1),
      notes,
    };
  } catch (err) {
    console.error('[grading] OCR consistency check failed', err);
    // Fail closed: if we cannot confirm the photo is readable, do not mark it.
    return {
      passed: false,
      confidence: 0,
      notes: 'The photo could not be checked. Please submit it again.',
    };
  }
}

/** Total marks available for a barème — the authoritative max_score for a question. */
export function baremeMaxScore(bareme: Bareme): number {
  return round2(bareme.reduce((sum, c) => sum + c.points, 0));
}

/** Safely reads a barème out of a JSONB column, returning null if it is absent or malformed. */
export function parseBareme(value: unknown): Bareme | null {
  const parsed = baremeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parseBaremeResult(value: unknown): BaremeResultItem[] {
  const parsed = baremeResultSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
