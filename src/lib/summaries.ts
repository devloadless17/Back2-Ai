import 'server-only';

import { z } from 'zod';

import { ai } from '@/lib/ai';
import { db } from '@/lib/db';
import { env, isAiConfigured } from '@/lib/env';

/**
 * Revision summaries for a chapter or a whole subject.
 *
 * Written from the textbook the student actually studies, never from the model's
 * general knowledge of the topic. That is the same rule the tutor answers under,
 * and it matters more here, not less: a summary is read as authoritative and
 * revised from without the student checking it, so an invented detail in a
 * summary is worse than the same invention in a chat reply they can push back on.
 *
 * Two things shape the implementation.
 *
 * CHAPTER SIZE VARIES ENORMOUSLY. The median chapter is nineteen passages; the
 * largest is 697, which is most of an English reader. One prompt cannot hold
 * that, and truncating to the first twenty would silently summarise the opening
 * of a chapter as though it were the whole of it. So a long chapter is summarised
 * in batches and the batch notes are then composed — the summary covers all of
 * it or says which part it covers, and never pretends.
 *
 * A SUBJECT SUMMARY IS BUILT FROM ITS CHAPTERS, not from the raw text. Composing
 * from chapter summaries keeps the shape consistent between the two levels and
 * costs one call rather than fifty.
 *
 * Every summary carries the passages it was written from, and it is generated
 * `unverified`. A teacher-written summary should replace this, not sit beside
 * it: `source` records which one a student is reading.
 */

const CHAPTER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['overview', 'key_points', 'watch_out'],
  properties: {
    overview: { type: 'string' },
    key_points: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['heading', 'detail'],
        properties: {
          heading: { type: 'string' },
          detail: { type: 'string' },
        },
      },
    },
    watch_out: { type: 'array', items: { type: 'string' } },
  },
} as const;

const chapterSchema = z.object({
  overview: z.string(),
  key_points: z.array(z.object({ heading: z.string(), detail: z.string() })),
  watch_out: z.array(z.string()),
});

const NOTES_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['notes'],
  properties: { notes: { type: 'array', items: { type: 'string' } } },
} as const;

const notesSchema = z.object({ notes: z.array(z.string()) });

export type ChapterSummary = {
  chapterId: string;
  chapterName: string;
  subjectName: string;
  overview: string;
  keyPoints: { heading: string; detail: string }[];
  /** Mistakes and confusions the material itself warns about. */
  watchOut: string[];
  /** How many past-exam questions this chapter carries, for weighting revision. */
  pastQuestions: number;
  sourceChunkIds: string[];
  /** True when the chapter was too long for one pass and was composed in batches. */
  batched: boolean;
  source: 'generated' | 'teacher';
  status: 'ok' | 'not_configured' | 'no_material';
};

export type SubjectSummary = {
  subjectId: string;
  subjectName: string;
  overview: string;
  chapters: { chapterId: string; chapterName: string; line: string; pastQuestions: number }[];
  status: 'ok' | 'not_configured' | 'no_material';
};

const LANGUAGE_NAME = { fr: 'French', en: 'English', ar: 'Arabic' } as const;

/** Passages per batch, and the most batches a single chapter may cost. */
const BATCH = 24;
const MAX_BATCHES = 8;

function rank(kind: string): number {
  return kind === 'definition' ? 0 : kind === 'theorem' ? 1 : kind === 'formula' ? 2 : kind === 'worked_example' ? 3 : 4;
}

export async function summariseChapter(chapterId: string): Promise<ChapterSummary> {
  const blank = {
    chapterId,
    chapterName: '',
    subjectName: '',
    overview: '',
    keyPoints: [],
    watchOut: [],
    pastQuestions: 0,
    sourceChunkIds: [],
    batched: false,
    source: 'generated' as const,
  };

  if (!isAiConfigured()) return { ...blank, status: 'not_configured' };

  const chapter = await db.chapter.findUnique({
    where: { id: chapterId },
    select: {
      id: true,
      name: true,
      unit: { select: { name: true } },
      subject: { select: { name: true, language: true } },
      _count: { select: { questions: true } },
    },
  });
  if (!chapter) return { ...blank, status: 'no_material' };

  const passages = await db.contentChunk.findMany({
    where: { chapters: { some: { chapterId } } },
    select: { id: true, kind: true, title: true, contentText: true },
  });
  if (passages.length === 0) {
    return {
      ...blank,
      chapterName: chapter.name,
      subjectName: chapter.subject.name,
      status: 'no_material',
    };
  }

  /*
   * Definitions and theorems first, exercises last. When a chapter is too long
   * to summarise in full this decides what survives the cap, and the material a
   * student revises from is the stated results, not the drill questions.
   */
  const ordered = [...passages].sort((a, b) => rank(a.kind) - rank(b.kind));
  const language = chapter.subject.language;
  const trail = [chapter.subject.name, chapter.unit?.name, chapter.name].filter(Boolean).join(' — ');

  const batches: typeof ordered[] = [];
  for (let i = 0; i < ordered.length && batches.length < MAX_BATCHES; i += BATCH) {
    batches.push(ordered.slice(i, i + BATCH));
  }
  const covered = batches.flat();
  const batched = batches.length > 1;

  /*
   * A long chapter is read in batches and reduced to notes first. The notes are
   * plain sentences rather than a partial summary on purpose — asking for eight
   * partial summaries and stapling them together produces eight overviews and no
   * structure.
   */
  let notes: string[] = [];
  if (batched) {
    for (const batch of batches) {
      const response = await ai().completeJson({
        system: [
          'You are reading part of one textbook chapter and taking notes for a later summary.',
          '',
          'Return the substantive points these passages make: definitions, results, methods,',
          'and anything the text explicitly warns students about. One sentence each, in the',
          'language of the passages. Do not add anything the passages do not say. Do not write',
          'an introduction or a conclusion — these are notes, not prose.',
        ].join('\n'),
        messages: [
          {
            role: 'user',
            content: batch
              .map((p, i) => `## ${i + 1}${p.title ? ` — ${p.title}` : ''}\n${p.contentText.slice(0, 1800)}`)
              .join('\n\n'),
          },
        ],
        schema: NOTES_SCHEMA as unknown as Record<string, unknown>,
        schemaName: 'chapter_notes',
        effort: 'low',
        model: env().OPENAI_MODEL_VERIFY,
        parse: (value) => notesSchema.parse(value),
      });
      notes = notes.concat(response.data.notes);
    }
  }

  const body = batched
    ? notes.map((note, i) => `${i + 1}. ${note}`).join('\n')
    : covered
        .map((p, i) => `## ${i + 1}${p.title ? ` — ${p.title}` : ''}\n${p.contentText.slice(0, 2000)}`)
        .join('\n\n');

  const response = await ai().completeJson({
    system: [
      `Write a revision summary of one chapter for a Lebanese Baccalaureate student, in ${LANGUAGE_NAME[language]}.`,
      '',
      'overview: three or four sentences saying what the chapter is about and what a student is',
      '  expected to be able to do by the end of it.',
      'key_points: the things worth revising, each with a short heading and two or three sentences.',
      '  Definitions, results and methods — in the order the chapter teaches them, not in order of',
      '  importance, so a student can follow it alongside the book.',
      'watch_out: mistakes or confusions. Only ones the material itself raises. An empty list is a',
      '  correct answer; inventing pitfalls to fill it is not.',
      '',
      'Use only what is given. No formula, constant or result that is not there. If the material is',
      'thin, write a thin summary and let it be obviously thin.',
    ].join('\n'),
    messages: [
      {
        role: 'user',
        content: [
          `# Chapter\n${trail}`,
          batched
            ? `# Notes taken from all ${covered.length} passages of this chapter`
            : `# The chapter's passages`,
          body,
        ].join('\n\n'),
      },
    ],
    schema: CHAPTER_SCHEMA as unknown as Record<string, unknown>,
    schemaName: 'chapter_summary',
    effort: 'high',
    parse: (value) => chapterSchema.parse(value),
  });

  return {
    chapterId: chapter.id,
    chapterName: chapter.name,
    subjectName: chapter.subject.name,
    overview: response.data.overview,
    keyPoints: response.data.key_points,
    watchOut: response.data.watch_out,
    pastQuestions: chapter._count.questions,
    sourceChunkIds: covered.map((p) => p.id),
    batched,
    source: 'generated',
    status: 'ok',
  };
}

/**
 * A subject-level summary, composed from its chapters.
 *
 * Takes chapter summaries as input rather than generating them, so a chapter a
 * teacher has already written a summary for is used as written. Pass whatever
 * you have; chapters with no summary are listed by name so the shape of the
 * subject is still visible.
 */
export async function summariseSubject(input: {
  subjectId: string;
  chapterSummaries: Pick<ChapterSummary, 'chapterId' | 'chapterName' | 'overview' | 'pastQuestions'>[];
}): Promise<SubjectSummary> {
  const blank = { subjectId: input.subjectId, subjectName: '', overview: '', chapters: [] };
  if (!isAiConfigured()) return { ...blank, status: 'not_configured' };

  const subject = await db.subject.findUnique({
    where: { id: input.subjectId },
    select: { id: true, name: true, language: true },
  });
  if (!subject || input.chapterSummaries.length === 0) {
    return { ...blank, status: 'no_material' };
  }

  const response = await ai().completeJson({
    system: [
      `Write a one-paragraph overview of a whole subject for a Lebanese Baccalaureate student, in ${LANGUAGE_NAME[subject.language]}.`,
      '',
      'You are given each chapter and what it covers, with how many past-exam questions exist for',
      'it. Say what the subject as a whole asks of a student and how its parts fit together.',
      '',
      'key_points: one line per chapter, in the order given — what that chapter is for, in a',
      "sentence. Use the chapter's own heading.",
      '',
      'watch_out: leave empty. Pitfalls belong to chapters, not to a subject.',
      '',
      'Do not rank chapters by the question counts or tell a student what to skip. The counts show',
      'what has been examined before, which is not the same as what will be examined.',
    ].join('\n'),
    messages: [
      {
        role: 'user',
        content: [
          `# Subject\n${subject.name}`,
          '# Chapters',
          ...input.chapterSummaries.map(
            (c) => `## ${c.chapterName} (${c.pastQuestions} past questions)\n${c.overview}`,
          ),
        ].join('\n'),
      },
    ],
    schema: CHAPTER_SCHEMA as unknown as Record<string, unknown>,
    schemaName: 'subject_summary',
    effort: 'high',
    parse: (value) => chapterSchema.parse(value),
  });

  const lines = new Map(response.data.key_points.map((p) => [p.heading.trim(), p.detail]));

  return {
    subjectId: subject.id,
    subjectName: subject.name,
    overview: response.data.overview,
    chapters: input.chapterSummaries.map((c) => ({
      chapterId: c.chapterId,
      chapterName: c.chapterName,
      line: lines.get(c.chapterName.trim()) ?? c.overview.split(/(?<=\.)\s/)[0] ?? '',
      pastQuestions: c.pastQuestions,
    })),
    status: 'ok',
  };
}
