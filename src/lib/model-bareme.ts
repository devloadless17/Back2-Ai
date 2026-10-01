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

/** Beyond this a "criterion" is a passage, not something to tick. */
const CRITERION_MAX = 200;
/** How much of the question's opening a criterion may echo before it is the question. */
const ECHO = 60;

/**
 * Whether a stored marking scheme can actually mark anything.
 *
 * 3,745 official barèmes hold a single criterion; 2,252 of those run past 200
 * characters and 1,792 begin with the question's own opening words. The average
 * is 777 characters long. They are whole exam prompts saved as one criterion
 * worth all the marks — History and English are entirely like this.
 *
 * WHY THAT IS NOT A SCHEME. `gradeAgainstBareme` awards or withholds each
 * criterion, so a single undifferentiated blob gives a student one verdict on
 * the whole answer and nothing about WHICH part cost them. The marks cannot be
 * taken apart afterwards either, so the record is lost for good.
 *
 * IT IS STILL NOT TOUCHED. This decides only whether a usable scheme has to be
 * written ALONGSIDE it, in `model_bareme`; the ministry's text stays exactly as
 * it was. A real one-criterion barème — short, naming one thing — is left to do
 * its job.
 */
export function isUsableBareme(bareme: Bareme, questionText: string): boolean {
  if (bareme.length > 1) return true;
  const only = bareme[0];
  if (!only) return false;
  const criterion = only.criterion.trim();
  if (criterion.length > CRITERION_MAX) return false;
  const opening = (questionText ?? '').trim().slice(0, ECHO).toLowerCase();
  return !(opening.length >= ECHO && criterion.slice(0, ECHO).toLowerCase() === opening);
}

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

  /*
   * TWO FAILURES SEEN ON THE FIRST LIVE RUN, both on an essay question.
   *
   * It returned ONE criterion worth all nine marks whose text was the exercise
   * pasted back verbatim. That is not a marking scheme — nothing can be awarded
   * or withheld against it, and a student told "you lost marks on: <the
   * question>" has learnt nothing.
   *
   * And the exercise itself carried the ministry's own split — "Score: 05 for
   * ideas, 03 for language and style, 01 for tidiness" — which was ignored in
   * favour of inventing a total. Where the paper states how its marks divide,
   * that division IS the barème and must be followed.
   */
  lines.push(
    'NEVER return a single criterion covering the whole exercise, and never use the exercise’s own wording as a criterion. Give at least two, each naming one thing the candidate must produce.',
    'If the exercise states how its marks divide — "5 for ideas, 3 for language", "2 pts" beside a part — follow that division exactly rather than inventing one.',
  );
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
  if (official && isUsableBareme(official, question.contentText)) {
    return { status: 'ok', bareme: official, official: true, cached: true };
  }

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
