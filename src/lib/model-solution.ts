import 'server-only';

import { ai } from '@/lib/ai';
import { db } from '@/lib/db';
import { isAiConfigured } from '@/lib/env';
import { bodyToRender } from '@/lib/question-body';

const LANGUAGE_NAME: Record<string, string> = { ar: 'Arabic', en: 'English', fr: 'French' };

/** The model's reply when the question cannot be answered from its text alone. */
const DECLINE = 'NO_ANSWER';

export function modelSolutionPrompt(language: string, subject: string): string {
  return [
    `You are a Lebanese Baccalaureate ${subject} teacher. Answer in ${LANGUAGE_NAME[language] ?? 'the language of the question'}.`,
    'Write the full worked answer a strong student would hand in for the exercise below: every part, in order, with the steps and the final result of each.',
    'Use the notation and method of the Lebanese programme. Keep it exam-length: no extra theory, no alternative methods.',
    'Write mathematics in LaTeX between $...$ (inline) or $$...$$ (display).',
    'Do not mention that you are an AI, and do not call the answer official.',
    `If the exercise depends on a figure, table, graph, document or text that is not given to you, or refers to another exercise or page, reply exactly: ${DECLINE}`,
  ].join('\n');
}

export type ModelSolutionResult =
  | { status: 'ok'; solution: string; official: boolean; cached: boolean }
  | { status: 'declined' | 'not_configured' | 'not_found' | 'needs_budget' };

/**
 * The answer to a question that came without one — written once, kept for all.
 *
 * Book exercises arrive with no answer key, and paying to answer three thousand
 * of them in advance buys answers to questions nobody may open. So the first
 * student who asks pays for it, the question keeps it, and every student after
 * them reads the stored copy at no cost.
 *
 * `canSpend` is asked only when a model call is actually about to happen, so a
 * student whose month is used up can still read every answer already written.
 */
export async function modelSolutionFor(input: {
  questionId: string;
  trackId: string | null;
  canSpend: () => Promise<boolean>;
}): Promise<ModelSolutionResult> {
  const question = await db.question.findFirst({
    where: {
      id: input.questionId,
      questionType: { not: 'mcq' },
      // Same rule as submitting an answer: only what a chapter of this
      // student's track actually offers.
      alsoInChapters: { some: { chapter: { subject: { trackId: input.trackId ?? undefined } } } },
    },
    select: {
      contentText: true,
      contentLatex: true,
      officialSolution: true,
      officialSolutionLatex: true,
      modelSolution: true,
      modelSolutionAt: true,
      chapter: { select: { name: true, subject: { select: { name: true, language: true } } } },
    },
  });
  if (!question) return { status: 'not_found' };

  const official = bodyToRender(
    question.officialSolutionLatex,
    question.officialSolution ?? '',
  ).trim();
  if (official) return { status: 'ok', solution: official, official: true, cached: true };

  if (question.modelSolutionAt) {
    const stored = question.modelSolution?.trim();
    return stored
      ? { status: 'ok', solution: stored, official: false, cached: true }
      : { status: 'declined' };
  }

  if (!isAiConfigured()) return { status: 'not_configured' };
  if (!(await input.canSpend())) return { status: 'needs_budget' };

  const provider = ai();
  const { subject } = question.chapter;
  const response = await provider.complete({
    system: modelSolutionPrompt(subject.language, subject.name),
    messages: [{
      role: 'user',
      content: [
        `# Chapter\n${question.chapter.name}`,
        `# Exercise\n${bodyToRender(question.contentLatex, question.contentText)}`,
      ].join('\n\n'),
    }],
    maxTokens: 4000,
    effort: 'medium',
  });

  const text = response.text.trim();
  const declined = !text || text === DECLINE || text.startsWith(DECLINE);

  /*
   * Kept even when declined, so a figure-bound exercise is not paid for again
   * by every student who opens it. `updateMany` on a still-empty row: when two
   * students ask at the same moment, the first write stands and the second
   * reads it back rather than overwriting it with a different answer.
   */
  await db.question.updateMany({
    where: { id: input.questionId, modelSolutionAt: null },
    data: {
      modelSolution: declined ? '' : text,
      modelSolutionModel: response.modelUsed,
      modelSolutionAt: new Date(),
    },
  });
  const kept = await db.question.findUnique({
    where: { id: input.questionId },
    select: { modelSolution: true },
  });
  const solution = kept?.modelSolution?.trim();
  return solution
    ? { status: 'ok', solution, official: false, cached: false }
    : { status: 'declined' };
}
