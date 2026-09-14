import 'server-only';

import { z } from 'zod';

import { ai } from '@/lib/ai';
import { db } from '@/lib/db';
import { isAiConfigured } from '@/lib/env';

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

type CachedRow = {
  overview: string;
  key_points: { heading: string; detail: string }[];
  watch_out: string[];
  batched: boolean;
  source_chunk_ids: string[];
};

/**
 * A summary already written for this chapter, if it is still about this chapter.
 *
 * The passage ids are the whole point of the check. A summary is a claim about
 * a particular set of passages, and a chapter that has been re-chunked since —
 * a better OCR pass, a book replaced, a split chapter — is a different set. A
 * cache keyed on the chapter alone would go on serving a summary of material
 * that no longer exists, which is worse than paying for the model call, because
 * it is wrong quietly.
 *
 * Compared as sets: chunk order is not stable across re-chunking and carries no
 * meaning here.
 */
async function cachedChapterSummary(
  chapterId: string,
  currentChunkIds: string[],
): Promise<CachedRow | null> {
  const [row] = await db.$queryRaw<CachedRow[]>`
    SELECT overview, key_points, watch_out, batched, source_chunk_ids::text[] AS source_chunk_ids
    FROM chapter_summaries WHERE chapter_id = ${chapterId}::uuid
  `;
  if (!row) return null;

  const stored = new Set(row.source_chunk_ids);
  const fresh = currentChunkIds.length === stored.size && currentChunkIds.every((id) => stored.has(id));
  return fresh ? row : null;
}

async function storeChapterSummary(chapterId: string, summary: ChapterSummary): Promise<void> {
  /*
   * Written by raw SQL rather than the generated client, like every other new
   * column in this codebase: `prisma generate` cannot refresh its types while a
   * dev server holds the query engine, and a page render must not depend on
   * whether somebody restarted it.
   *
   * A failure here loses the cache entry, never the summary. The student has
   * already got their answer by this point; the worst case is that the next
   * view pays for it again.
   */
  try {
    await db.$executeRaw`
      INSERT INTO chapter_summaries
        (chapter_id, overview, key_points, watch_out, batched, source_chunk_ids)
      VALUES (
        ${chapterId}::uuid,
        ${summary.overview},
        ${JSON.stringify(summary.keyPoints)}::jsonb,
        ${summary.watchOut},
        ${summary.batched},
        ${summary.sourceChunkIds}::uuid[]
      )
      ON CONFLICT (chapter_id) DO UPDATE SET
        overview = EXCLUDED.overview,
        key_points = EXCLUDED.key_points,
        watch_out = EXCLUDED.watch_out,
        batched = EXCLUDED.batched,
        source_chunk_ids = EXCLUDED.source_chunk_ids,
        created_at = now()
    `;
  } catch (err) {
    console.error('[summaries] could not cache chapter summary', err);
  }
}

/**
 * Which model writes the summary, and whether a stored one may be used.
 *
 * Exists so the choice can be MEASURED rather than assumed — the same reason
 * `RerankOptions` exists. The default is the flagship at high effort, and that
 * default deserves a question: the batched path below already hands these exact
 * passages to the cheap model to take notes from, so the codebase already
 * trusts it to READ this material; only the final write-up runs on the
 * expensive one. Roughly seven times the price per uncached view.
 *
 * `skipCache` is for the comparison only. Nothing in the app should set it: a
 * stored summary is the entire reason a second view is free.
 *
 * See `scripts/compare-summary-models.ts`.
 */
export type SummaryOptions = {
  model?: string;
  effort?: 'low' | 'medium' | 'high';
  skipCache?: boolean;
};

export async function summariseChapter(
  chapterId: string,
  opts: SummaryOptions = {},
): Promise<ChapterSummary> {
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
      // What this chapter may ASK, not where an exercise was filed — the same
      // distinction as 6be57e6. 178 chapters serve questions with nothing filed
      // under them, and this number is shown to the student as "past questions".
      _count: {
        select: {
          alsoHasQuestions: { where: { question: { verifiedStatus: { not: 'rejected' } } } },
        },
      },
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
   * Served from the cache when one exists for exactly this set of passages.
   *
   * This is checked after the passages are read and before anything is
   * generated, because the passage ids ARE the cache key — there is no cheaper
   * way to ask whether a stored summary is still about this chapter. One index
   * lookup against a model call over the whole chapter, which for a chapter
   * summarised in eight batches is eight model calls.
   */
  const cached = opts.skipCache
    ? null
    : await cachedChapterSummary(chapterId, passages.map((p) => p.id));
  if (cached) {
    return {
      chapterId: chapter.id,
      chapterName: chapter.name,
      subjectName: chapter.subject.name,
      overview: cached.overview,
      keyPoints: cached.key_points,
      watchOut: cached.watch_out,
      pastQuestions: chapter._count.alsoHasQuestions,
      sourceChunkIds: cached.source_chunk_ids,
      batched: cached.batched,
      source: 'generated',
      status: 'ok',
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
        model: ai().verifyModel,
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
    effort: opts.effort ?? 'high',
    ...(opts.model ? { model: opts.model } : {}),
    parse: (value) => chapterSchema.parse(value),
  });

  const summary: ChapterSummary = {
    chapterId: chapter.id,
    chapterName: chapter.name,
    subjectName: chapter.subject.name,
    overview: response.data.overview,
    keyPoints: response.data.key_points,
    watchOut: response.data.watch_out,
    pastQuestions: chapter._count.alsoHasQuestions,
    sourceChunkIds: covered.map((p) => p.id),
    batched,
    source: 'generated',
    status: 'ok',
  };

  /*
   * A comparison run must not leave its output behind. `skipCache` means "do
   * not read the cache" AND "do not write to it": a measurement of the cheap
   * model that stored its result would silently become what students read,
   * which is the opposite of measuring a choice before making it.
   */
  if (!opts.skipCache) await storeChapterSummary(chapter.id, summary);
  return summary;
}

/**
 * The chapter summaries already written for a subject, and only those.
 *
 * `summariseSubject` composes an overview out of chapter summaries and does not
 * generate them, which is what makes it safe to call from a page: it describes
 * the chapters that have been read, names the rest, and never triggers a
 * cascade of chapter generations because somebody opened a subject.
 */
export async function cachedChapterSummaries(
  subjectId: string,
): Promise<Pick<ChapterSummary, 'chapterId' | 'chapterName' | 'overview' | 'pastQuestions'>[]> {
  return db.$queryRaw`
    SELECT cs.chapter_id AS "chapterId",
           ch.name       AS "chapterName",
           cs.overview   AS "overview",
           (SELECT count(*)::int FROM questions q WHERE q.chapter_id = ch.id) AS "pastQuestions"
    FROM chapter_summaries cs
    JOIN chapters ch ON ch.id = cs.chapter_id
    WHERE ch.subject_id = ${subjectId}::uuid
    ORDER BY ch.order_index ASC
  `;
}

/** A subject overview already written for exactly this set of chapters. */
export async function cachedSubjectSummary(
  subjectId: string,
  chapterIds: string[],
): Promise<SubjectSummary | null> {
  const [row] = await db.$queryRaw<
    { overview: string; chapters: SubjectSummary['chapters']; source_chapter_ids: string[] }[]
  >`
    SELECT overview, chapters, source_chapter_ids::text[] AS source_chapter_ids
    FROM subject_summaries WHERE subject_id = ${subjectId}::uuid
  `;
  if (!row) return null;
  const stored = new Set(row.source_chapter_ids);
  const fresh = chapterIds.length === stored.size && chapterIds.every((id) => stored.has(id));
  if (!fresh) return null;
  return {
    subjectId,
    subjectName: '',
    overview: row.overview,
    chapters: row.chapters,
    status: 'ok',
  };
}

async function storeSubjectSummary(
  subjectId: string,
  summary: SubjectSummary,
  chapterIds: string[],
): Promise<void> {
  try {
    await db.$executeRaw`
      INSERT INTO subject_summaries (subject_id, overview, chapters, source_chapter_ids)
      VALUES (${subjectId}::uuid, ${summary.overview},
              ${JSON.stringify(summary.chapters)}::jsonb, ${chapterIds}::uuid[])
      ON CONFLICT (subject_id) DO UPDATE SET
        overview = EXCLUDED.overview,
        chapters = EXCLUDED.chapters,
        source_chapter_ids = EXCLUDED.source_chapter_ids,
        created_at = now()
    `;
  } catch (err) {
    console.error('[summaries] could not cache subject summary', err);
  }
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

  const chapterIds = input.chapterSummaries.map((c) => c.chapterId);
  const cached = await cachedSubjectSummary(subject.id, chapterIds);
  if (cached) return { ...cached, subjectName: subject.name };

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

  const summary: SubjectSummary = {
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

  await storeSubjectSummary(subject.id, summary, chapterIds);
  return summary;
}
