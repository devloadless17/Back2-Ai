import 'server-only';

import { ai } from '@/lib/ai';
import { db } from '@/lib/db';
import { isAiConfigured } from '@/lib/env';
import { paperPartsOf, partsWithoutAnswer } from '@/lib/paper-parts';
import { bodyToRender } from '@/lib/question-body';
import { retrieveGrounding } from '@/lib/retrieval';

const LANGUAGE_NAME: Record<string, string> = { ar: 'Arabic', en: 'English', fr: 'French' };

/** The model's reply when the question cannot be answered from its text alone. */
const DECLINE = 'NO_ANSWER';

/**
 * What the answering model is told.
 *
 * `hasFigure` says a figure, graph or table is printed with this exercise and
 * the student is looking at it. The model is not: it gets the words only.
 *
 * IT MUST NOT GO BLANK OVER A FIGURE IT CANNOT SEE. The first version of this
 * prompt refused the whole exercise whenever it depended on anything not handed
 * over, which left a student staring at nothing — and a figure is printed
 * alongside a large share of the science papers. Refusing is only right when
 * there is nothing useful to say. When a quantity has to be read off a graph,
 * the method, the formula and the reasoning are all still teachable; what must
 * never happen is a NUMBER INVENTED to stand in for one that was never seen.
 * So the model is told to work symbolically and name the reading it needs.
 */
export function modelSolutionPrompt(input: {
  language: string;
  subject: string;
  hasPassage: boolean;
  hasFigure: boolean;
  hasCourseMaterial: boolean;
}): string {
  const lines = [
    `You are a Lebanese Baccalaureate ${input.subject} teacher. Answer in ${LANGUAGE_NAME[input.language] ?? 'the language of the question'}.`,
    'Write the full worked answer a strong student would hand in for the exercise below: every part, in order, with the steps and the final result of each.',
    'Use the notation and method of the Lebanese programme. Keep it exam-length: no extra theory, no alternative methods.',
    'Write mathematics in LaTeX between $...$ (inline) or $$...$$ (display).',
    'Do not mention that you are an AI, and do not call the answer official.',
  ];

  if (input.hasCourseMaterial) {
    lines.push(
      'Numbered extracts from this student\'s own course book are given below. Use their definitions, their notation and their method: the answer must look like the book they were taught from, not like a general textbook.',
    );
  }
  if (input.hasPassage) {
    lines.push('The text the exercise examines is given below it. Answer from that text, quoting it where the question asks you to.');
  }
  if (input.hasFigure) {
    lines.push(
      'A figure, graph or table is printed with this exercise. The student can see it; you cannot.',
      'Answer everything that does not depend on reading it, and set out the method for the parts that do, symbolically.',
      'Where a value has to be read off the figure, say exactly which reading is needed and carry it as a symbol. NEVER invent a number, a coordinate or a measurement you were not given.',
    );
  }
  lines.push(
    `Reply exactly ${DECLINE} only if the exercise text is too damaged or too incomplete to teach anything from at all. Being short of a figure is not a reason to refuse.`,
  );
  return lines.join('\n');
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
  /** Whose programme to ground the answer in. Needed for the course retrieval. */
  userId?: string;
  canSpend: () => Promise<boolean>;
  /**
   * Answer even though an official answer exists — for a past-paper exercise
   * some of whose parts the official key leaves without an answer the page can
   * show. Checked here against the stored parts, not taken on trust.
   */
  beyondOfficial?: boolean;
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
      sourcePassage: true,
      officialSolution: true,
      officialSolutionLatex: true,
      modelSolution: true,
      modelSolutionAt: true,
      paperParts: true,
      contentImages: true,
      _count: { select: { visuals: { where: { status: 'active' } } } },
      chapter: { select: { name: true, subjectId: true, subject: { select: { name: true, language: true } } } },
    },
  });
  if (!question) return { status: 'not_found' };

  const official = bodyToRender(
    question.officialSolutionLatex,
    question.officialSolution ?? '',
  ).trim();
  const parts = paperPartsOf(question.paperParts);
  const gap = Boolean(input.beyondOfficial && parts && !parts.fullKey && partsWithoutAnswer(parts.parts) > 0);
  if (official && !gap) return { status: 'ok', solution: official, official: true, cached: true };

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
  const exercise = bodyToRender(question.contentLatex, question.contentText);
  const passage = question.sourcePassage?.trim() ?? '';
  const hasFigure = question._count.visuals > 0 || (question.contentImages?.length ?? 0) > 0;

  /*
   * THE ANSWER IS GROUNDED IN THIS STUDENT'S OWN BOOK, not in whatever the model
   * remembers about the subject. A Lebanese barème marks the programme's method,
   * so an answer that solves the problem correctly by another route still loses
   * marks. Retrieval is the same path the tutor uses, scoped to this question's
   * subject, so it can only reach material this student is taught.
   *
   * A failure here costs the grounding, not the answer: an ungrounded answer is
   * worth more to a student than an error page, so this never throws upward.
   */
  let course = '';
  if (input.userId) {
    try {
      const grounding = await retrieveGrounding({
        query: [exercise, passage].filter(Boolean).join('\n\n').slice(0, 4000),
        subjectIds: [question.chapter.subjectId],
        userId: input.userId,
      });
      if (grounding.tier !== 'ungrounded_refused') course = grounding.context.trim();
    } catch {
      course = '';
    }
  }

  const response = await provider.complete({
    system: modelSolutionPrompt({
      language: subject.language,
      subject: subject.name,
      hasPassage: Boolean(passage),
      hasFigure,
      hasCourseMaterial: Boolean(course),
    }),
    messages: [{
      role: 'user',
      content: [
        `# Chapter\n${question.chapter.name}`,
        course ? `# From the course book\n${course}` : '',
        passage ? `# The text this exercise examines\n${passage}` : '',
        `# Exercise\n${exercise}`,
      ].filter(Boolean).join('\n\n'),
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
