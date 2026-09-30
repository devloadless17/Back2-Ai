import 'server-only';

import { Prisma } from '@prisma/client';
import { z } from 'zod';

import { ai } from '@/lib/ai';
import { db } from '@/lib/db';
import { isAiConfigured } from '@/lib/env';
import { parseBareme, type Bareme } from '@/lib/grading';
import { bodyToRender } from '@/lib/question-body';

/** How many real schemes the model is shown. */
const PATTERN_EXAMPLES = 4;
/** A Lebanese exercise is marked out of a handful of points, never dozens. */
const MAX_TOTAL = 20;

const LANGUAGE_NAME: Record<string, string> = { ar: 'Arabic', en: 'English', fr: 'French' };

/** An empty array is how the model says the exercise cannot be marked blind. */
const responseSchema = z.object({ bareme: z.array(z.object({ criterion: z.string(), points: z.number() })) });

const BAREME_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['bareme'],
  properties: {
    bareme: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['criterion', 'points'],
        properties: { criterion: { type: 'string' }, points: { type: 'number' } },
      },
    },
  },
};

export type ModelBaremeResult =
  | { status: 'ok'; bareme: Bareme; official: boolean; cached: boolean }
  | { status: 'declined' | 'not_configured' | 'not_found' | 'needs_budget' };

/**
 * The marking scheme shown to the model as the pattern to follow.
 *
 * A LEBANESE BARÈME IS A TEMPLATE, NOT AN ANSWER. It splits the marks by the
 * steps the programme expects — the equation, then the substitution, then the
 * result — and a scheme written without seeing real ones tends to invent
 * categories no examiner uses ("clarity", "presentation") and to spread marks
 * evenly, which is not how these papers are marked. Real schemes from the same
 * subject are what teach the shape.
 */
export function modelBaremePrompt(input: {
  language: string;
  subject: string;
  statedMarks: number | null;
  examples: Bareme[];
}): string {
  const lines = [
    `You are a Lebanese Baccalaureate ${input.subject} examiner. Write the marking scheme for the exercise below.`,
    `Write each criterion in ${LANGUAGE_NAME[input.language] ?? 'the language of the exercise'}.`,
    'Split the marks the way the Lebanese programme does: one criterion per step the candidate must show, in the order the exercise asks for them.',
    'A criterion names what the candidate must produce, not how well they write. Never mark presentation, clarity, effort or neatness.',
  ];
  if (input.examples.length) {
    lines.push(
      'Real marking schemes from this same subject are given below. Follow their shape, their granularity and their wording — not their content.',
    );
  }
  if (input.statedMarks && input.statedMarks > 0) {
    lines.push(`The exercise is printed as being out of ${input.statedMarks}. The points must add up to exactly that.`);
  } else {
    lines.push(`Choose a sensible total for one exercise, at most ${MAX_TOTAL}.`);
  }
  lines.push(
    'Reply with JSON only: {"bareme":[{"criterion":"...","points":n}]}.',
    'If the exercise cannot be marked without a figure, a table or a text you were not given, reply {"bareme":[]}.',
  );
  return lines.join('\n');
}

/**
 * The marking scheme for a question that came without one — written once, kept.
 *
 * WHY IT IS STORED RATHER THAN MADE EACH TIME. Marking already works without a
 * barème: `gradeWithoutBareme` proposes criteria per attempt. But proposing
 * them per attempt means two students who write the SAME answer to the same
 * question can be marked against different criteria and get different scores,
 * and neither can be shown why. Marks have to be the same for everyone, so the
 * scheme is decided once, stored, and used for every attempt after.
 *
 * IT IS NEVER WRITTEN INTO `bareme`. That column is the ministry's. This one is
 * separate so it can be labelled provisional, audited, or thrown away without
 * touching anything official.
 */
export async function modelBaremeFor(input: {
  questionId: string;
  userId: string;
  statedMarks?: number | null;
  canSpend: () => Promise<boolean>;
}): Promise<ModelBaremeResult> {
  const question = await db.question.findUnique({
    where: { id: input.questionId },
    select: {
      contentText: true,
      contentLatex: true,
      sourcePassage: true,
      officialSolution: true,
      bareme: true,
      modelBareme: true,
      modelBaremeAt: true,
      chapter: { select: { subjectId: true, subject: { select: { name: true, language: true } } } },
    },
  });
  if (!question) return { status: 'not_found' };

  const official = parseBareme(question.bareme);
  if (official) return { status: 'ok', bareme: official, official: true, cached: true };

  if (question.modelBaremeAt) {
    const stored = parseBareme(question.modelBareme);
    return stored ? { status: 'ok', bareme: stored, official: false, cached: true } : { status: 'declined' };
  }

  if (!isAiConfigured()) return { status: 'not_configured' };
  if (!(await input.canSpend())) return { status: 'needs_budget' };

  /*
   * The pattern to copy: real schemes from this subject, longest first, because
   * a one-line scheme teaches nothing about how marks are split.
   */
  const rows = await db.question.findMany({
    where: {
      chapter: { subjectId: question.chapter.subjectId },
      bareme: { not: Prisma.JsonNull },
      id: { not: input.questionId },
    },
    select: { bareme: true },
    take: 40,
  });
  const examples = rows
    .map((r) => parseBareme(r.bareme))
    .filter((b): b is Bareme => Boolean(b && b.length > 1))
    .sort((a, b) => b.length - a.length)
    .slice(0, PATTERN_EXAMPLES);

  const { subject } = question.chapter;
  const response = await ai().completeJson({
    system: modelBaremePrompt({
      language: subject.language,
      subject: subject.name,
      statedMarks: input.statedMarks ?? null,
      examples,
    }),
    messages: [{
      role: 'user',
      content: [
        examples.length
          ? `# Real marking schemes from this subject\n${examples
              .map((b, i) => `${i + 1}. ${b.map((c) => `${c.points} — ${c.criterion}`).join(' | ')}`)
              .join('\n')}`
          : '',
        question.sourcePassage?.trim() ? `# The text this exercise examines\n${question.sourcePassage.trim()}` : '',
        question.officialSolution?.trim() ? `# The official answer\n${question.officialSolution.trim()}` : '',
        `# Exercise\n${bodyToRender(question.contentLatex, question.contentText)}`,
      ].filter(Boolean).join('\n\n'),
    }],
    schema: BAREME_SCHEMA as unknown as Record<string, unknown>,
    schemaName: 'model_bareme',
    maxTokens: 1500,
    effort: 'medium',
    parse: (value) => responseSchema.parse(value),
  });

  const proposed = parseBareme(response.data.bareme);

  /*
   * Written even when nothing usable came back, so a question that cannot be
   * marked is not paid for again by the next student. `updateMany` on a
   * still-empty row: two students asking at once leave the first write standing.
   */
  await db.question.updateMany({
    where: { id: input.questionId, modelBaremeAt: null },
    data: {
      modelBareme: proposed ?? [],
      modelBaremeModel: response.modelUsed,
      modelBaremeAt: new Date(),
    },
  });

  const kept = parseBareme(
    (await db.question.findUnique({ where: { id: input.questionId }, select: { modelBareme: true } }))?.modelBareme ?? null,
  );
  return kept ? { status: 'ok', bareme: kept, official: false, cached: false } : { status: 'declined' };
}
