import 'server-only';

import { ai } from '@/lib/ai';
import { db } from '@/lib/db';
import { isAiConfigured } from '@/lib/env';
import { bodyToRender } from '@/lib/question-body';

const LANGUAGE_NAME: Record<string, string> = { ar: 'Arabic', en: 'English', fr: 'French' };

export function flashcardAnswerPrompt(language: string): string {
  return [
    `Answer in ${LANGUAGE_NAME[language] ?? 'the source language'}.`,
    'Write the short exam-ready answer to the flashcard question using ONLY the textbook passages below.',
    'Use the textbook\'s terminology and preserve any definition, date, name, list, or stated conclusion exactly.',
    'Do not mention the passages, retrieval, missing official corrections, or that you are an AI.',
    'Do not add general knowledge. If the passages do not answer the question, reply exactly: NO_ANSWER',
    'Return only the answer a student should learn.',
  ].join('\n');
}

export type FlashcardAnswerResult =
  | { status: 'ok'; answer: string; cached: boolean }
  | { status: 'not_configured' | 'no_material' | 'not_found' };

export async function answerFlashcardFromBook(input: {
  userId: string;
  questionId: string;
}): Promise<FlashcardAnswerResult> {
  const state = await db.flashcardState.findUnique({
    where: { userId_questionId: { userId: input.userId, questionId: input.questionId } },
    select: {
      generatedAnswer: true,
      question: {
        select: {
          contentText: true,
          contentLatex: true,
          officialSolution: true,
          officialSolutionLatex: true,
          chapterId: true,
          chapter: { select: { subject: { select: { language: true } } } },
        },
      },
    },
  });

  if (!state?.question) return { status: 'not_found' };
  const official = bodyToRender(
    state.question.officialSolutionLatex,
    state.question.officialSolution ?? '',
  ).trim();
  if (official) {
    return { status: 'ok', answer: official, cached: true };
  }
  if (state.generatedAnswer?.trim()) {
    return { status: 'ok', answer: state.generatedAnswer.trim(), cached: true };
  }
  if (!isAiConfigured()) return { status: 'not_configured' };

  const chunks = await db.contentChunk.findMany({
    where: { chapters: { some: { chapterId: state.question.chapterId } } },
    select: { title: true, contentText: true },
    orderBy: { id: 'asc' },
    take: 8,
  });
  const material = chunks.filter((chunk) => chunk.contentText.trim().length > 80);
  if (material.length === 0) return { status: 'no_material' };

  const provider = ai();
  const response = await provider.complete({
    system: flashcardAnswerPrompt(state.question.chapter.subject.language),
    messages: [{
      role: 'user',
      content: [
        `# Question\n${bodyToRender(state.question.contentLatex, state.question.contentText)}`,
        '# Textbook passages',
        ...material.map((chunk, index) =>
          `## Passage ${index + 1}${chunk.title ? ` — ${chunk.title}` : ''}\n${chunk.contentText.slice(0, 2600)}`),
      ].join('\n\n'),
    }],
    maxTokens: 700,
    effort: 'medium',
  });
  const answer = response.text.trim();
  if (!answer || answer === 'NO_ANSWER') return { status: 'no_material' };

  await db.flashcardState.update({
    where: { userId_questionId: { userId: input.userId, questionId: input.questionId } },
    data: {
      generatedAnswer: answer,
      generatedAnswerModel: provider.defaultModel,
      generatedAnswerAt: new Date(),
    },
  });
  return { status: 'ok', answer, cached: false };
}
