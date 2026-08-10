import 'server-only';

import { z } from 'zod';

import { ai, embed } from '@/lib/ai';
import { db } from '@/lib/db';
import { baremeMaxScore, baremeSchema, type Bareme } from '@/lib/grading';
import { findNearDuplicate, setEmbedding } from '@/lib/vector';
import { solverCheck } from '@/lib/verification';

/**
 * Problem generation.
 *
 * A generated problem passes through four gates before a student can see it:
 *
 *   1. Style grounding — it is written from real questions in the same chapter,
 *      not from the model's idea of what a Lebanese Bac question looks like.
 *   2. Diversity — numbers, scenario, approach and phrasing must differ from the
 *      references, enforced in the prompt AND by an embedding duplicate check.
 *   3. Solver — a second model solves it cold; its answer must match the stated
 *      one, or the problem is unsound and is marked solver_failed.
 *   4. Review queue — an administrator approves before `published_at` is set.
 *
 * Nothing student-facing may select a row with `published_at IS NULL`. That is
 * the trust decision from the exec plan, and this module never sets that column;
 * only the review-queue handler does.
 */

export const PROMPT_VERSION = 'gen-v1';

/** Above this cosine similarity to an existing problem, it is a paraphrase. */
export const DUPLICATE_THRESHOLD = 0.95;

const MAX_ATTEMPTS = 3;

const PROBLEM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['content_text', 'solution', 'final_answer', 'bareme', 'difficulty'],
  properties: {
    content_text: { type: 'string' },
    content_latex: { type: 'string' },
    solution: { type: 'string' },
    final_answer: { type: 'string' },
    difficulty: { type: 'number' },
    bareme: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['criterion', 'points'],
        properties: {
          criterion: { type: 'string' },
          points: { type: 'number' },
        },
      },
    },
  },
} as const;

const problemResponseSchema = z.object({
  content_text: z.string().min(20),
  content_latex: z.string().optional(),
  solution: z.string().min(20),
  final_answer: z.string().min(1),
  difficulty: z.number(),
  bareme: baremeSchema,
});

export type GenerationOutcome =
  | { status: 'created'; problemId: string; solverPassed: boolean; notes: string }
  | { status: 'rejected'; reason: string };

export type GenerateInput = {
  chapterId: string;
  /** 0..1. The generator is asked to hit this band; the reviewer confirms it. */
  targetDifficulty?: number;
  /** Recorded on the review-queue item so an admin knows what asked for this. */
  requestedBy?: string | null;
};

function systemPrompt(language: string): string {
  return [
    'You write examination problems for the Lebanese Baccalaureate.',
    '',
    `Write the problem in ${language}, using the notation and conventions of the Lebanese programme.`,
    'Mathematics in LaTeX: $...$ inline, $$...$$ displayed.',
    '',
    'You are given real questions from this chapter as style references. Match their level, structure,',
    'phrasing conventions and marking style. Do NOT match their content:',
    '',
    '- Change the numeric values and the scenario. A problem that is the reference with different numbers',
    '  is not a new problem.',
    '- Where the chapter admits more than one valid method, choose a different one from the references.',
    '- Vary the phrasing and the way the question is framed. Do not reuse the reference wording.',
    '',
    'The barème is the marking scheme, in the Lebanese style: one criterion per markable step, with the',
    'points for that step. Method steps carry marks, not only the final answer. Points should be whole or',
    'half marks and should total a sensible mark for a question of this size.',
    '',
    'final_answer: the final result alone, with units, in the form a marker would accept.',
    'difficulty: 0 to 1, where 0.5 is a typical mid-paper question for this chapter.',
    '',
    'The problem must be fully solvable from what you state. Every value needed must be given.',
  ].join('\n');
}

export async function generateProblem(input: GenerateInput): Promise<GenerationOutcome> {
  const chapter = await db.chapter.findUnique({
    where: { id: input.chapterId },
    select: {
      id: true,
      name: true,
      subject: { select: { name: true, language: true } },
      unit: { select: { name: true } },
    },
  });

  if (!chapter) return { status: 'rejected', reason: 'Unknown chapter.' };

  // Style references: real, verified questions from this chapter. Without them
  // there is nothing to ground the style in, and we do not generate blind.
  const references = await db.question.findMany({
    where: { chapterId: chapter.id, verifiedStatus: 'verified' },
    select: { id: true, contentText: true, officialSolution: true, bareme: true, difficulty: true },
    orderBy: { createdAt: 'desc' },
    take: 3,
  });

  if (references.length === 0) {
    return {
      status: 'rejected',
      reason: 'No verified questions exist in this chapter to use as style references.',
    };
  }

  // Course material for the chapter, so the generator stays inside what the
  // syllabus actually covers rather than inventing an off-programme variant.
  const material = await db.contentChunk.findMany({
    where: { chapterId: chapter.id },
    select: { kind: true, title: true, contentText: true },
    take: 6,
  });

  const target = input.targetDifficulty ?? averageDifficulty(references) ?? 0.5;

  const languageName =
    chapter.subject.language === 'fr' ? 'French' : chapter.subject.language === 'ar' ? 'Arabic' : 'English';

  const userPrompt = [
    `# Chapter\n${chapter.subject.name} — ${chapter.unit?.name ? `${chapter.unit.name} — ` : ''}${chapter.name}`,
    '',
    `# Target difficulty\n${target.toFixed(2)}`,
    '',
    ...(material.length > 0
      ? [
          '# Course material for this chapter (the syllabus boundary — stay inside it)',
          ...material.map((m) => `## ${m.title ?? m.kind}\n${m.contentText}`),
          '',
        ]
      : []),
    '# Style references (match the style, not the content)',
    ...references.map(
      (r, i) =>
        `## Reference ${i + 1}\n${r.contentText}` +
        (r.officialSolution ? `\n\n### Its solution\n${r.officialSolution}` : ''),
    ),
    '',
    'Write ONE new problem for this chapter.',
  ].join('\n');

  const provider = ai();
  let lastRejection = 'Generation produced no usable problem.';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let generated: z.infer<typeof problemResponseSchema>;
    let modelUsed: string;

    try {
      const response = await provider.completeJson({
        system: systemPrompt(languageName),
        messages: [
          {
            role: 'user',
            content:
              attempt === 1
                ? userPrompt
                : `${userPrompt}\n\nYour previous attempt was rejected: ${lastRejection}\nWrite a genuinely different problem.`,
          },
        ],
        schema: PROBLEM_SCHEMA as unknown as Record<string, unknown>,
        schemaName: 'generated_problem',
        effort: 'high',
        parse: (value) => problemResponseSchema.parse(value),
      });
      generated = response.data;
      modelUsed = response.modelUsed;
    } catch (err) {
      console.error('[generation] model call failed', err);
      lastRejection = 'The model call failed.';
      continue;
    }

    // --- Duplicate check, before anything is written --------------------
    let embedding: number[];
    try {
      embedding = await embed(generated.content_text, 'document');
    } catch (err) {
      console.error('[generation] embedding failed', err);
      return { status: 'rejected', reason: 'Could not embed the generated problem for duplicate checking.' };
    }

    const duplicate = await findNearDuplicate(embedding, chapter.id, DUPLICATE_THRESHOLD);
    if (duplicate) {
      lastRejection = `It was a near-duplicate of an existing problem (similarity ${duplicate.similarity.toFixed(3)}).`;
      continue;
    }

    // --- Persist as pending ---------------------------------------------
    const bareme: Bareme = generated.bareme;

    const problem = await db.generatedProblem.create({
      data: {
        chapterId: chapter.id,
        styleReferenceIds: references.map((r) => r.id),
        contentText: generated.content_text,
        contentLatex: generated.content_latex ?? null,
        generatedSolution: generated.solution,
        bareme,
        finalAnswer: generated.final_answer,
        difficulty: clamp01(generated.difficulty),
        verificationStatus: 'pending',
        modelUsed,
        promptVersion: PROMPT_VERSION,
      },
      select: { id: true },
    });

    await setEmbedding('generated_problems', problem.id, embedding);

    // --- Solver gate -----------------------------------------------------
    const solver = await solverCheck(generated.content_text, generated.final_answer);

    await db.generatedProblem.update({
      where: { id: problem.id },
      data: {
        verificationStatus: solver.passed ? 'solver_passed' : 'solver_failed',
        verificationNotes: solver.notes,
      },
    });

    // Queue for review either way. A solver_failed problem is not silently
    // dropped: seeing what the generator gets wrong is how the prompt improves.
    await db.reviewQueueItem.create({
      data: {
        itemType: 'generated_problem',
        itemId: problem.id,
        flagReason: solver.passed
          ? `Awaiting approval. Solver agreed (${baremeMaxScore(bareme)} marks).`
          : `Solver check FAILED — do not approve without checking. ${solver.notes}`,
        flaggedByUserId: input.requestedBy ?? null,
      },
    });

    return {
      status: 'created',
      problemId: problem.id,
      solverPassed: solver.passed,
      notes: solver.notes,
    };
  }

  return { status: 'rejected', reason: lastRejection };
}

function averageDifficulty(rows: { difficulty: unknown }[]): number | null {
  const values = rows
    .map((r) => (r.difficulty === null || r.difficulty === undefined ? null : Number(r.difficulty)))
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}

/**
 * Problems a student is allowed to be served: approved by a human and published.
 * Every student-facing selection of generated content goes through this filter.
 */
export const PUBLISHED_FILTER = {
  verificationStatus: 'approved',
  publishedAt: { not: null },
} as const;
