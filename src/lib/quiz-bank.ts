import 'server-only';

import { z } from 'zod';

import { ai } from '@/lib/ai';
import { db } from '@/lib/db';
import { isAiConfigured } from '@/lib/env';

/**
 * Multiple-choice items, written from the textbook and checked before anyone
 * sees them.
 *
 * Runs per chapter as a background job, not on a student's click. Two reasons,
 * and the second is the one that matters: generation is slow enough to be worth
 * doing ahead of time, and an item nobody has checked should never reach a
 * student. Everything here comes back `pending_approval`.
 *
 * Four gates, the same shape `generation.ts` applies to written problems:
 *
 *   1. Grounded — written from real passages of the chapter, and each item names
 *      the passage its answer rests on. An item whose citation does not resolve
 *      is dropped, which catches the model inventing a source.
 *
 *   2. Answerable from that passage — a second call, given only the passage and
 *      the question, must independently choose the same option. This is the gate
 *      that earns its cost: it catches the two failures that matter and that
 *      reading the item does not reveal — a "correct" answer the passage does
 *      not support, and a distractor that is also correct.
 *
 *   3. Distinct — items whose questions are near-duplicates of each other are
 *      dropped, so a bank of twenty is twenty questions rather than five asked
 *      four ways.
 *
 *   4. Human approval — outside this module. Nothing here publishes.
 *
 * The solver runs on the cheap model deliberately. It is not being asked to be
 * clever; it is being asked whether a competent reader of that passage would
 * reach the stated answer. A strong model would paper over a badly grounded
 * item by knowing the answer anyway, which is the opposite of the test.
 */

const DRAFT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['passage', 'question', 'options', 'correct_index', 'explanation'],
        properties: {
          passage: { type: 'number' },
          question: { type: 'string' },
          options: { type: 'array', items: { type: 'string' } },
          correct_index: { type: 'number' },
          explanation: { type: 'string' },
        },
      },
    },
  },
} as const;

const draftSchema = z.object({
  items: z.array(
    z.object({
      passage: z.number(),
      question: z.string().min(10),
      options: z.array(z.string()).min(3).max(5),
      correct_index: z.number().int().min(0),
      explanation: z.string(),
    }),
  ),
});

const SOLVE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['chosen_index', 'supported'],
  properties: {
    chosen_index: { type: 'number' },
    supported: { type: 'boolean' },
  },
} as const;

const solveSchema = z.object({ chosen_index: z.number().int(), supported: z.boolean() });

export type QuizDraft = {
  chapterId: string;
  /** The passage the answer rests on — provenance a reviewer can open. */
  sourceChunkId: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
};

export type QuizBankResult = {
  drafts: QuizDraft[];
  /** Why items were discarded, so a chapter that produces nothing is explicable. */
  rejected: { reason: string; question: string }[];
  status: 'ok' | 'not_configured' | 'no_material';
};

const LANGUAGE_NAME = { fr: 'French', en: 'English', ar: 'Arabic' } as const;

/** Word overlap, for spotting two items that ask the same thing. */
function overlap(a: string, b: string): number {
  const words = (text: string) =>
    new Set(
      text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .split(/[^\p{Letter}\p{Number}]+/u)
        .filter((w) => w.length > 3),
    );
  const left = words(a);
  const right = words(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / Math.min(left.size, right.size);
}

const NEAR_DUPLICATE = 0.7;

export async function fillQuizBank(input: {
  chapterId: string;
  count?: number;
}): Promise<QuizBankResult> {
  const wanted = input.count ?? 8;
  if (!isAiConfigured()) return { drafts: [], rejected: [], status: 'not_configured' };

  const chapter = await db.chapter.findUnique({
    where: { id: input.chapterId },
    select: { id: true, name: true, subject: { select: { name: true, language: true } } },
  });
  if (!chapter) return { drafts: [], rejected: [], status: 'no_material' };

  /*
   * Definitions and theorems first, exercises last. A multiple-choice question
   * wants a stated fact to test; an exercise page gives the model a problem to
   * restate, and a restated problem makes a bad four-option question.
   */
  const passages = await db.contentChunk.findMany({
    where: { chapters: { some: { chapterId: chapter.id } } },
    select: { id: true, kind: true, title: true, contentText: true },
    orderBy: { kind: 'asc' },
    take: 12,
  });
  const usable = passages
    .filter((p) => p.contentText.trim().length > 250)
    .sort((a, b) => {
      const rank = (kind: string) =>
        kind === 'definition' ? 0 : kind === 'theorem' ? 1 : kind === 'worked_example' ? 2 : 3;
      return rank(a.kind) - rank(b.kind);
    })
    .slice(0, 8);

  if (usable.length === 0) return { drafts: [], rejected: [], status: 'no_material' };

  const language = chapter.subject.language;
  const numbered = usable.map((passage, index) => ({ number: index + 1, passage }));

  const response = await ai().completeJson({
    system: [
      `Write multiple-choice revision questions for a Lebanese Baccalaureate student, in ${LANGUAGE_NAME[language]}.`,
      '',
      'Rules:',
      '- Every question and its correct answer must be supported by one of the numbered passages.',
      '  Give that passage number. Do not combine two passages into one question.',
      '- Do not use any fact, formula or figure that is not in the passage you cite.',
      '- Four options unless the material genuinely suits three. Exactly one is correct.',
      '- The wrong options must be wrong — not "less complete", not "also arguably right". A student',
      '  who knows the passage must be able to eliminate them.',
      '- Wrong options should be plausible: a common misreading, a confused term, a sign error. Never',
      '  filler, never "none of the above".',
      '- Do not ask about the passage as a text ("what does the passage say about..."). Ask about the',
      '  subject, as an examiner would.',
      '- explanation: one or two sentences saying why the correct option is correct.',
    ].join('\n'),
    messages: [
      {
        role: 'user',
        content: [
          `# Chapter\n${chapter.subject.name} — ${chapter.name}`,
          `# How many\n${wanted}`,
          '',
          '# Passages',
          ...numbered.map(
            ({ number, passage }) =>
              `## Passage ${number}${passage.title ? ` — ${passage.title}` : ''}\n${passage.contentText.slice(0, 2000)}`,
          ),
        ].join('\n'),
      },
    ],
    schema: DRAFT_SCHEMA as unknown as Record<string, unknown>,
    schemaName: 'quiz_drafts',
    effort: 'high',
    parse: (value) => draftSchema.parse(value),
  });

  const drafts: QuizDraft[] = [];
  const rejected: QuizBankResult['rejected'] = [];

  for (const item of response.data.items) {
    const cited = numbered.find((n) => n.number === item.passage);
    if (!cited) {
      rejected.push({ reason: 'cited a passage that was not provided', question: item.question });
      continue;
    }
    if (item.correct_index < 0 || item.correct_index >= item.options.length) {
      rejected.push({ reason: 'correct_index outside the options', question: item.question });
      continue;
    }
    if (new Set(item.options.map((o) => o.trim().toLowerCase())).size !== item.options.length) {
      rejected.push({ reason: 'duplicate options', question: item.question });
      continue;
    }
    if (drafts.some((d) => overlap(d.question, item.question) >= NEAR_DUPLICATE)) {
      rejected.push({ reason: 'near-duplicate of another item', question: item.question });
      continue;
    }

    // Gate 2: answered cold, from the passage alone.
    let solved;
    try {
      solved = await ai().completeJson({
        system: [
          'You are given one passage from a textbook and one multiple-choice question.',
          '',
          'Choose the option the passage supports, and say whether the passage really supports it.',
          'Judge only on the passage. If the passage does not settle the question, or if more than',
          'one option could be defended from it, set supported to false — that is the answer being',
          'asked for, not a failure.',
        ].join('\n'),
        messages: [
          {
            role: 'user',
            content: [
              '# Passage',
              cited.passage.contentText.slice(0, 2500),
              '',
              '# Question',
              item.question,
              ...item.options.map((option, index) => `${index}. ${option}`),
            ].join('\n'),
          },
        ],
        schema: SOLVE_SCHEMA as unknown as Record<string, unknown>,
        schemaName: 'quiz_solve',
        effort: 'low',
        model: ai().verifyModel,
        parse: (value) => solveSchema.parse(value),
      });
    } catch {
      rejected.push({ reason: 'the check could not be run', question: item.question });
      continue;
    }

    if (!solved.data.supported) {
      rejected.push({ reason: 'the passage does not settle the question', question: item.question });
      continue;
    }
    if (solved.data.chosen_index !== item.correct_index) {
      // Either the stated answer is wrong or a distractor is also defensible.
      // Both make the item unusable and neither is visible by reading it.
      rejected.push({ reason: 'independent read chose a different option', question: item.question });
      continue;
    }

    drafts.push({
      chapterId: chapter.id,
      sourceChunkId: cited.passage.id,
      question: item.question,
      options: item.options,
      correctIndex: item.correct_index,
      explanation: item.explanation,
    });
  }

  return { drafts, rejected, status: 'ok' };
}
