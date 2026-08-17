import 'server-only';

import { z } from 'zod';

import { ai } from '@/lib/ai';
import { db } from '@/lib/db';
import { env, isAiConfigured } from '@/lib/env';

/**
 * Flashcards written from the textbook, for chapters a student has not
 * practised yet.
 *
 * This does not replace the existing deck, and the distinction is the whole
 * design. `queries/flashcards.ts` builds a deck from questions the student has
 * already attempted — reviewing your own work, which is the stronger form of
 * spaced repetition because the card carries a memory of getting it wrong. That
 * remains the default.
 *
 * What it cannot do is cover a chapter the student has never touched, and that
 * is most of the syllabus in the weeks before an exam. There is nothing to
 * review, so the deck is empty exactly when a student most wants one. These
 * cards fill that gap: generated from the chapter's own passages, checked, and
 * approved before anyone sees them.
 *
 * So the two sources answer different questions. "What did I get wrong?" is
 * answered by attempts. "What does this chapter contain?" is answered here.
 * Anything selecting cards for a session should prefer an attempted question
 * when one exists and fall back to these.
 *
 * On storage: SM-2 state is keyed on (user, question), so a card is scheduled by
 * being a `Question` row. Persisting these as questions with `source_type =
 * generated` — front as the statement, back as the official solution — means
 * scheduling, mastery and the review queue all work untouched. A separate card
 * table would need its own copy of each.
 *
 * Gates, as for the quiz bank:
 *
 *   1. Grounded — written from a real passage, which it must name.
 *   2. Checked — a second call, given only the passage and the front, answers it
 *      and must agree with the back. This catches a card whose back is right in
 *      general but not supported by the passage, and a front the passage does
 *      not actually answer.
 *   3. Distinct fronts, so twenty cards are not five asked four ways.
 *   4. Human approval, outside this module. Nothing here publishes.
 */

const DRAFT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['cards'],
  properties: {
    cards: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['passage', 'front', 'back'],
        properties: {
          passage: { type: 'number' },
          front: { type: 'string' },
          back: { type: 'string' },
        },
      },
    },
  },
} as const;

const draftSchema = z.object({
  cards: z.array(
    z.object({
      passage: z.number(),
      front: z.string().min(5),
      back: z.string().min(5),
    }),
  ),
});

const CHECK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['agrees', 'answerable'],
  properties: {
    agrees: { type: 'boolean' },
    answerable: { type: 'boolean' },
  },
} as const;

const checkSchema = z.object({ agrees: z.boolean(), answerable: z.boolean() });

export type FlashcardDraft = {
  chapterId: string;
  sourceChunkId: string;
  front: string;
  back: string;
};

export type FlashcardBankResult = {
  drafts: FlashcardDraft[];
  rejected: { reason: string; front: string }[];
  status: 'ok' | 'not_configured' | 'no_material';
};

const LANGUAGE_NAME = { fr: 'French', en: 'English', ar: 'Arabic' } as const;

/** Longest a back can be and still be self-gradeable at a glance. */
const MAX_BACK = 320;

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

export async function fillFlashcardBank(input: {
  chapterId: string;
  count?: number;
}): Promise<FlashcardBankResult> {
  const wanted = input.count ?? 10;
  if (!isAiConfigured()) return { drafts: [], rejected: [], status: 'not_configured' };

  const chapter = await db.chapter.findUnique({
    where: { id: input.chapterId },
    select: { id: true, name: true, subject: { select: { name: true, language: true } } },
  });
  if (!chapter) return { drafts: [], rejected: [], status: 'no_material' };

  /*
   * Definitions and formulas first. A flashcard is recall of a stated thing, so
   * the passages that state things are worth more here than the ones that set
   * exercises — the opposite weighting would produce cards whose back is a
   * worked solution nobody can self-grade.
   */
  const passages = await db.contentChunk.findMany({
    where: { chapters: { some: { chapterId: chapter.id } } },
    select: { id: true, kind: true, title: true, contentText: true },
    take: 14,
  });
  const usable = passages
    .filter((p) => p.contentText.trim().length > 200)
    .sort((a, b) => {
      const rank = (kind: string) =>
        kind === 'definition' ? 0 : kind === 'formula' ? 1 : kind === 'theorem' ? 2 : 3;
      return rank(a.kind) - rank(b.kind);
    })
    .slice(0, 8);

  if (usable.length === 0) return { drafts: [], rejected: [], status: 'no_material' };

  const language = chapter.subject.language;
  const numbered = usable.map((passage, index) => ({ number: index + 1, passage }));

  const response = await ai().completeJson({
    system: [
      `Write flashcards for spaced repetition, in ${LANGUAGE_NAME[language]}, for a Lebanese`,
      'Baccalaureate student.',
      '',
      'Rules:',
      '- Each card comes from one of the numbered passages. Give that passage number.',
      '- front: a term to define, a formula to state, or one precise question. Short. Never',
      '  "explain everything about X", which cannot be self-graded.',
      '- back: the complete answer and nothing else. Two or three sentences at most, or the formula',
      '  with what its symbols mean. A student holding the card must be able to decide in a moment',
      '  whether they got it right — so no hedging, no "see the chapter", no partial answer.',
      '- Use nothing that is not in the passage you cite. No formula from memory, no constant you',
      '  were not given.',
      '- One fact per card. A card testing three things at once teaches none of them.',
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
    schemaName: 'flashcard_drafts',
    effort: 'high',
    parse: (value) => draftSchema.parse(value),
  });

  const drafts: FlashcardDraft[] = [];
  const rejected: FlashcardBankResult['rejected'] = [];

  for (const card of response.data.cards) {
    const cited = numbered.find((n) => n.number === card.passage);
    if (!cited) {
      rejected.push({ reason: 'cited a passage that was not provided', front: card.front });
      continue;
    }
    if (card.back.length > MAX_BACK) {
      rejected.push({ reason: 'back too long to self-grade', front: card.front });
      continue;
    }
    if (drafts.some((d) => overlap(d.front, card.front) >= NEAR_DUPLICATE)) {
      rejected.push({ reason: 'near-duplicate of another card', front: card.front });
      continue;
    }

    let checked;
    try {
      checked = await ai().completeJson({
        system: [
          'You are given one passage from a textbook, one flashcard front, and the back that was',
          'written for it.',
          '',
          'Answer the front from the passage alone, then report two things:',
          'answerable — whether the passage actually answers the front at all.',
          'agrees — whether the given back says the same thing as the passage does.',
          '',
          'Judge only on the passage. A back that is correct in general but not supported by this',
          'passage is not agreement: say false. Wording may differ; meaning may not.',
        ].join('\n'),
        messages: [
          {
            role: 'user',
            content: [
              '# Passage',
              cited.passage.contentText.slice(0, 2500),
              '',
              '# Front',
              card.front,
              '',
              '# Back as written',
              card.back,
            ].join('\n'),
          },
        ],
        schema: CHECK_SCHEMA as unknown as Record<string, unknown>,
        schemaName: 'flashcard_check',
        effort: 'low',
        model: env().OPENAI_MODEL_VERIFY,
        parse: (value) => checkSchema.parse(value),
      });
    } catch {
      rejected.push({ reason: 'the check could not be run', front: card.front });
      continue;
    }

    if (!checked.data.answerable) {
      rejected.push({ reason: 'the passage does not answer the front', front: card.front });
      continue;
    }
    if (!checked.data.agrees) {
      rejected.push({ reason: 'the back does not match the passage', front: card.front });
      continue;
    }

    drafts.push({
      chapterId: chapter.id,
      sourceChunkId: cited.passage.id,
      front: card.front,
      back: card.back,
    });
  }

  return { drafts, rejected, status: 'ok' };
}
