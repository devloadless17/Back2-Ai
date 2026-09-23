import 'server-only';

import { z } from 'zod';

import { ai, type AiImage } from '@/lib/ai';
import { isAiConfigured } from '@/lib/env';
import { transcribeImage } from '@/lib/ocr';
import { retrieveGrounding } from '@/lib/retrieval';
import { shouldRetract, verifyAgainstContext } from '@/lib/verification';

/**
 * "I'm stuck on this" — a photographed problem, answered from the programme.
 *
 * The shape of this feature is what makes it safe or dangerous. A student
 * photographs a question they cannot do; the obvious implementation hands the
 * photo to a multimodal model and shows whatever comes back. That answers
 * everything, including questions the Lebanese Bac will never ask, in a
 * confident voice, with no way for the student to tell the difference.
 *
 * So it runs through the same grounding the chat pipeline uses:
 *
 *   transcribe -> retrieve against the student's own subjects -> answer only
 *   from what was retrieved -> verify the answer against that material
 *
 * and when retrieval finds nothing that clears the tier gate, it says the
 * programme does not cover this rather than answering anyway. For an exam
 * candidate that is the more useful reply: knowing a question is off-programme
 * is worth more than a plausible paragraph about it.
 *
 * Nothing here is a second retrieval implementation. `retrieveGrounding` makes
 * the decision, on the thresholds measured for the configured embedding model,
 * so the photo path and the chat path refuse the same questions. A separate
 * copy would drift, and the copy that drifted would be the one nobody tested.
 */

const ANSWER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['answer', 'used_passages'],
  properties: {
    answer: { type: 'string' },
    used_passages: { type: 'array', items: { type: 'number' } },
  },
} as const;

const answerSchema = z.object({
  answer: z.string(),
  used_passages: z.array(z.number()),
});

export type PhotoAnswer = {
  /** False when nothing retrieved supports an answer. `answer` is then the refusal. */
  covered: boolean;
  /** What the photo said, as transcribed. Shown back so a bad photo is obvious. */
  transcription: string;
  answer: string;
  /** Chapter the question was matched to, for tagging the attempt. */
  chapterId: string | null;
  chapterName: string | null;
  /** The passages actually drawn on, for the citation the student can check. */
  sources: { id: string; label: string }[];
  /** True when the answer failed verification and was withdrawn. */
  withdrawn: boolean;
  status: 'ok' | 'not_configured' | 'unreadable';
};

const NOT_COVERED = {
  fr: "Ce n'est pas couvert par le programme de ta section. Je préfère te le dire plutôt que de te donner une réponse qui ne t'aidera pas à l'examen.",
  en: "This is not covered by your section's programme. I would rather tell you that than give you an answer that will not help you in the exam.",
  ar: 'هذا غير مشمول في منهج فرعك. أفضّل أن أقول لك ذلك بدلاً من أن أعطيك جواباً لا يفيدك في الامتحان.',
} as const;

/**
 * A photograph of a comprehension question that did not catch the passage.
 *
 * The transcription usually does contain it — a student photographing a French
 * paper gets the extract and the questions in one frame, and retrieval answers
 * straight from what is on the page. When the frame caught only the questions,
 * the honest reply is that the text is missing, not that the topic is off the
 * programme.
 */
const NEEDS_PASSAGE = {
  fr: "Cette question porte sur un texte que je ne vois pas sur la photo. Reprends-la en incluant le passage, et on la fait ensemble.",
  en: 'This question is about a text that is not in the photo. Take it again with the passage included, and we will work through it.',
  ar: 'هذا السؤال يتعلّق بنصّ لا أراه في الصورة. أعد التقاطها بحيث يظهر المقطع، ولنحلّها معاً.',
} as const;

const WITHDRAWN = {
  fr: "J'ai commencé une réponse que je n'ai pas pu vérifier dans le programme. Je la retire plutôt que de te laisser avec quelque chose d'incertain.",
  en: 'I started an answer I could not verify against the programme. I am withdrawing it rather than leaving you with something uncertain.',
  ar: 'بدأت بجواب لم أستطع التحقق منه في المنهج. أسحبه بدلاً من أن أتركك مع شيء غير موثوق.',
} as const;

export type PhotoQaInput = {
  userId: string;
  image: AiImage;
  /** Subjects the student may be answered from — derived from their locked track. */
  subjectIds: string[];
  locale: 'fr' | 'en' | 'ar';
  /** What the student typed alongside the photo, if anything. */
  note?: string;
};

export async function answerPhotoQuestion(input: PhotoQaInput): Promise<PhotoAnswer> {
  const blank: PhotoAnswer = {
    covered: false,
    transcription: '',
    answer: '',
    chapterId: null,
    chapterName: null,
    sources: [],
    withdrawn: false,
    status: 'ok',
  };

  if (!isAiConfigured()) return { ...blank, status: 'not_configured' };

  const ocr = await transcribeImage(input.image);
  const transcription = ocr.text.trim();

  /*
   * A photo that transcribed to nothing is a photo problem, not a curriculum
   * one, and must not be reported as "off-programme" — the student would go
   * away believing their question is not on the syllabus when in fact the
   * picture was too dark to read.
   */
  if (transcription.length < 15) {
    return { ...blank, transcription, status: 'unreadable' };
  }

  const query = [transcription, input.note?.trim()].filter(Boolean).join('\n\n');
  const grounding = await retrieveGrounding({
    query,
    subjectIds: input.subjectIds,
    userId: input.userId,
  });

  if (grounding.tier === 'ungrounded_refused' || !grounding.context.trim()) {
    return {
      ...blank,
      transcription,
      covered: false,
      answer:
        grounding.classification.kind === 'comprehension'
          ? NEEDS_PASSAGE[input.locale]
          : NOT_COVERED[input.locale],
    };
  }

  const numbered = grounding.sources.map((source, index) => ({ index: index + 1, source }));

  const response = await ai().completeJson({
    system: [
      'A student has photographed a problem they are stuck on. You are given the transcription and',
      'numbered passages from their own programme.',
      '',
      'Answer using only what those passages support. Work through the problem the way their',
      'textbook does. If the passages support only part of the question, answer that part and say',
      'plainly which part you cannot support.',
      '',
      'used_passages: the numbers of the passages you actually drew on. Not all of them — only the',
      'ones your answer rests on, so the student can check you.',
      '',
      'Never introduce a formula, constant or method that is not in the passages. If you find',
      'yourself needing one, say so instead of supplying it from memory.',
    ].join('\n'),
    messages: [
      {
        role: 'user',
        content: [
          '# The photographed problem',
          transcription,
          ...(input.note?.trim() ? ['', '# What the student asked', input.note.trim()] : []),
          '',
          '# Passages from the programme',
          ...numbered.map(({ index, source }) => `## Passage ${index} — ${source.label}\n${source.text}`),
        ].join('\n'),
      },
    ],
    schema: ANSWER_SCHEMA as unknown as Record<string, unknown>,
    schemaName: 'photo_answer',
    effort: 'high',
    parse: (value) => answerSchema.parse(value),
  });

  const used = numbered
    .filter(({ index }) => response.data.used_passages.includes(index))
    .map(({ source }) => ({ id: source.id, label: source.label }));

  /*
   * Verified against the same material it was told to use, and withdrawn if it
   * fails — the chat pipeline's rule, applied here for the same reason. An
   * answer to a photographed problem is the most likely place for a model to
   * quietly supply a missing step from memory, because the problem in the photo
   * often needs one.
   */
  if (grounding.requiresVerification) {
    const verdict = await verifyAgainstContext({
      query: transcription,
      answer: response.data.answer,
      context: grounding.context,
    });
    if (shouldRetract(verdict)) {
      return {
        ...blank,
        transcription,
        covered: true,
        withdrawn: true,
        answer: WITHDRAWN[input.locale],
      };
    }
  }

  const top = grounding.sources[0];
  return {
    covered: true,
    transcription,
    answer: response.data.answer,
    chapterId: null,
    chapterName: top?.label ?? null,
    sources: used.length > 0 ? used : grounding.sources.map((s) => ({ id: s.id, label: s.label })),
    withdrawn: false,
    status: 'ok',
  };
}
