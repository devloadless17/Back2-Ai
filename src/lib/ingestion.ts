import 'server-only';

import type { Prisma, QuestionType } from '@prisma/client';
import { z } from 'zod';

import { ai, embedMany } from '@/lib/ai';
import { invalidateCurriculum } from '@/lib/cache';
import { db } from '@/lib/db';
import { isAiConfigured, isEmbeddingConfigured } from '@/lib/env';
import { baremeSchema } from '@/lib/grading';
import { extractDocumentText } from '@/lib/ocr';
import { setEmbedding } from '@/lib/vector';

/**
 * Ingestion: raw source document → structured, tagged, embedded curriculum.
 *
 *   extract → segment → auto-tag → embed → insert
 *
 * Everything ingested lands as `unverified`. Nothing here publishes to
 * students on its own; a human confirms the segmentation was right before a
 * paper is treated as an official one. Segmentation of a scanned exam paper is
 * the step most likely to go quietly wrong — a mis-split question reads
 * plausibly and marks nonsense — so it is the step that gets a review, not a
 * log line.
 *
 * Progress is written to `ingestion_jobs` as it goes, because these runs take
 * minutes and an admin watching a spinner with no numbers cannot tell a slow
 * job from a hung one.
 */

// ---------------------------------------------------------------------------
// Segmentation
// ---------------------------------------------------------------------------

const SEGMENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['questions'],
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['content_text', 'question_type', 'order_index'],
        properties: {
          content_text: { type: 'string' },
          question_type: { type: 'string', enum: ['mcq', 'open', 'problem'] },
          order_index: { type: 'number' },
          official_solution: { type: 'string' },
          difficulty: { type: 'number' },
          topic_hint: { type: 'string' },
          bareme: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['criterion', 'points'],
              properties: { criterion: { type: 'string' }, points: { type: 'number' } },
            },
          },
          options: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['id', 'text'],
              properties: { id: { type: 'string' }, text: { type: 'string' } },
            },
          },
          correct_option_id: { type: 'string' },
        },
      },
    },
  },
} as const;

const segmentResponseSchema = z.object({
  questions: z.array(
    z.object({
      content_text: z.string().min(10),
      question_type: z.enum(['mcq', 'open', 'problem']),
      order_index: z.number(),
      official_solution: z.string().optional(),
      difficulty: z.number().optional(),
      topic_hint: z.string().optional(),
      bareme: baremeSchema.optional(),
      options: z.array(z.object({ id: z.string(), text: z.string() })).optional(),
      correct_option_id: z.string().optional(),
    }),
  ),
});

const CHUNK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['chunks'],
  properties: {
    chunks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'title', 'content_text'],
        properties: {
          kind: {
            type: 'string',
            enum: ['definition', 'formula', 'theorem', 'method', 'worked_example'],
          },
          title: { type: 'string' },
          content_text: { type: 'string' },
          topic_hint: { type: 'string' },
        },
      },
    },
  },
} as const;

const chunkResponseSchema = z.object({
  chunks: z.array(
    z.object({
      kind: z.enum(['definition', 'formula', 'theorem', 'method', 'worked_example']),
      title: z.string(),
      content_text: z.string().min(20),
      topic_hint: z.string().optional(),
    }),
  ),
});

const SEGMENT_SYSTEM = [
  'You split a transcribed Lebanese Baccalaureate examination paper into its individual questions.',
  '',
  '- One entry per question a candidate answers separately. A question with parts (a), (b), (c) that share',
  '  one stem stays as ONE entry with its parts intact — splitting it would lose the data the parts depend on.',
  '- content_text: the question exactly as printed, including its stem, given values and parts. Keep the',
  '  original language and keep mathematics in LaTeX.',
  '- official_solution: only if the source contains one. Never write one yourself.',
  '- bareme: only if the source states the mark allocation. Never invent marks.',
  '- topic_hint: the syllabus topic this question belongs to, in the language of the paper.',
  '- difficulty: 0 to 1, your estimate for a candidate at this level.',
  '- Skip cover pages, instructions, formula sheets and blank pages.',
  '',
  'If the transcription is too garbled to split reliably, return an empty list rather than guessing at',
  'boundaries. A wrongly split question is worse than a missing one.',
].join('\n');

const CHUNK_SYSTEM = [
  'You split transcribed course material into self-contained pieces for a retrieval corpus.',
  '',
  'Each chunk must stand alone: someone reading it without the surrounding pages must be able to use it.',
  'Pull the definition, statement or method into the chunk rather than referring to "the above".',
  '',
  'kind:',
  '  definition     — what a term means',
  '  formula        — a formula with what its symbols denote',
  '  theorem        — a stated result, with conditions',
  '  method         — a procedure for a class of problem, step by step',
  '  worked_example — a solved example, with the working',
  '',
  'title: a short label a student would recognise. topic_hint: the syllabus topic.',
  'Keep the original language and keep mathematics in LaTeX.',
].join('\n');

// ---------------------------------------------------------------------------
// Auto-tagging
// ---------------------------------------------------------------------------

const TAG_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['assignments'],
  properties: {
    assignments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['index', 'chapter_name', 'confidence'],
        properties: {
          index: { type: 'number' },
          chapter_name: { type: 'string' },
          confidence: { type: 'number' },
        },
      },
    },
  },
} as const;

const tagResponseSchema = z.object({
  assignments: z.array(
    z.object({ index: z.number(), chapter_name: z.string(), confidence: z.number() }),
  ),
});

export type TaggedItem = { index: number; chapterId: string; confidence: number };

/**
 * Assigns each item to a chapter of the subject.
 *
 * The model chooses from the actual chapter list — it cannot invent a chapter,
 * because the returned name is matched back against the list and an unmatched
 * name is dropped rather than guessed at. Anything below the confidence floor
 * goes to the review queue instead of being filed somewhere plausible; a
 * question filed under the wrong chapter corrupts that chapter's mastery for
 * every student who attempts it.
 */
const TAG_CONFIDENCE_FLOOR = 0.6;

export async function autoTag(
  items: { text: string; topicHint?: string }[],
  chapters: { id: string; name: string; unitName: string | null }[],
): Promise<TaggedItem[]> {
  if (items.length === 0 || chapters.length === 0) return [];

  const byName = new Map(chapters.map((c) => [normalize(c.name), c.id]));

  const response = await ai().completeJson({
    system: [
      'You file examination questions and course material under the chapter of the syllabus they belong to.',
      '',
      'Choose from the chapter list given. Copy the chapter name exactly as it appears in the list.',
      'confidence: 0 to 1. Be honest — if an item spans two chapters or you cannot tell, say so with a low',
      'number. A low-confidence item goes to a human; a confidently wrong one does not.',
    ].join('\n'),
    messages: [
      {
        role: 'user',
        content: [
          '# Chapters',
          ...chapters.map((c) => `- ${c.name}${c.unitName ? ` (${c.unitName})` : ''}`),
          '',
          '# Items',
          ...items.map(
            (item, index) =>
              `## ${index}\n${item.topicHint ? `Topic hint: ${item.topicHint}\n` : ''}${item.text.slice(0, 1200)}`,
          ),
        ].join('\n'),
      },
    ],
    schema: TAG_SCHEMA as unknown as Record<string, unknown>,
    schemaName: 'chapter_assignment',
    effort: 'medium',
    parse: (value) => tagResponseSchema.parse(value),
  });

  const results: TaggedItem[] = [];
  for (const assignment of response.data.assignments) {
    const chapterId = byName.get(normalize(assignment.chapter_name));
    if (!chapterId) continue;
    results.push({
      index: assignment.index,
      chapterId,
      confidence: Math.min(1, Math.max(0, assignment.confidence)),
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Job runner
// ---------------------------------------------------------------------------

export type IngestSource = {
  kind: 'exam_paper' | 'course_material';
  subjectId: string;
  label: string;
  bytes: Buffer;
  contentType: string;
  /** Exam papers only. */
  year?: number;
  session?: string;
  durationMinutes?: number;
};

export type IngestResult = {
  jobId: string;
  itemsTotal: number;
  itemsProcessed: number;
  itemsFailed: number;
  needsReview: number;
};

export async function createJob(input: {
  kind: string;
  subjectId: string | null;
  sourceLabel: string;
  triggeredBy: string | null;
}): Promise<string> {
  const job = await db.ingestionJob.create({
    data: {
      kind: input.kind,
      subjectId: input.subjectId,
      sourceLabel: input.sourceLabel,
      triggeredBy: input.triggeredBy,
      status: 'queued',
    },
    select: { id: true },
  });
  return job.id;
}

async function log(jobId: string, message: string, patch: Prisma.IngestionJobUpdateInput = {}): Promise<void> {
  const current = await db.ingestionJob.findUnique({ where: { id: jobId }, select: { log: true } });
  const entries = Array.isArray(current?.log) ? (current.log as unknown[]) : [];

  await db.ingestionJob.update({
    where: { id: jobId },
    data: {
      ...patch,
      log: [...entries.slice(-200), { at: new Date().toISOString(), message }] as Prisma.InputJsonValue,
    },
  });
  console.log(`[ingest ${jobId.slice(0, 8)}] ${message}`);
}

export async function runIngestion(jobId: string, source: IngestSource): Promise<IngestResult> {
  if (!isAiConfigured()) throw new Error('Ingestion needs an AI provider key for segmentation and tagging.');

  await db.ingestionJob.update({
    where: { id: jobId },
    data: { status: 'running', startedAt: new Date() },
  });

  const result: IngestResult = { jobId, itemsTotal: 0, itemsProcessed: 0, itemsFailed: 0, needsReview: 0 };

  try {
    const subject = await db.subject.findUnique({
      where: { id: source.subjectId },
      select: { id: true, name: true, language: true },
    });
    if (!subject) throw new Error('Unknown subject.');

    const chapters = await db.chapter.findMany({
      where: { subjectId: subject.id },
      select: { id: true, name: true, unit: { select: { name: true } } },
      orderBy: { orderIndex: 'asc' },
    });
    if (chapters.length === 0) throw new Error('This subject has no chapters; seed the taxonomy first.');

    // --- 1. Extract -------------------------------------------------------
    await log(jobId, `Extracting text from ${source.label}…`);
    const text = await extractDocumentText(source.bytes, source.contentType);

    if (text.trim().length < 100) {
      throw new Error('No usable text could be extracted from this document.');
    }
    await log(jobId, `Extracted ${text.length} characters.`);

    // --- 2. Segment -------------------------------------------------------
    const chapterList = chapters.map((c) => ({ id: c.id, name: c.name, unitName: c.unit?.name ?? null }));

    if (source.kind === 'exam_paper') {
      result.itemsTotal = await ingestExamPaper({ jobId, source, subject, text, chapterList, result });
    } else {
      result.itemsTotal = await ingestCourseMaterial({ jobId, source, subject, text, chapterList, result });
    }

    await db.ingestionJob.update({
      where: { id: jobId },
      data: {
        status: 'succeeded',
        finishedAt: new Date(),
        itemsTotal: result.itemsTotal,
        itemsProcessed: result.itemsProcessed,
        itemsFailed: result.itemsFailed,
      },
    });

    // New questions change which chapters are practisable, which is the one
    // curriculum figure that is cached. Ingestion is the only thing that moves
    // it, so it is also the only thing that has to say so.
    invalidateCurriculum();

    await log(
      jobId,
      `Done. ${result.itemsProcessed}/${result.itemsTotal} ingested, ${result.needsReview} flagged for review.`,
    );

    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown ingestion failure.';
    await db.ingestionJob.update({
      where: { id: jobId },
      data: {
        status: 'failed',
        finishedAt: new Date(),
        errorMessage: message,
        itemsTotal: result.itemsTotal,
        itemsProcessed: result.itemsProcessed,
        itemsFailed: result.itemsFailed,
      },
    });
    await log(jobId, `FAILED: ${message}`);
    throw err;
  }
}

async function ingestExamPaper(ctx: {
  jobId: string;
  source: IngestSource;
  subject: { id: string; name: string };
  text: string;
  chapterList: { id: string; name: string; unitName: string | null }[];
  result: IngestResult;
}): Promise<number> {
  const { jobId, source, subject, text, chapterList, result } = ctx;

  await log(jobId, 'Segmenting into questions…');

  const segmented = await ai().completeJson({
    system: SEGMENT_SYSTEM,
    messages: [{ role: 'user', content: `Subject: ${subject.name}\n\n${text.slice(0, 120_000)}` }],
    schema: SEGMENT_SCHEMA as unknown as Record<string, unknown>,
    schemaName: 'paper_segmentation',
    effort: 'high',
    parse: (value) => segmentResponseSchema.parse(value),
  });

  const questions = segmented.data.questions;
  await log(jobId, `Segmented into ${questions.length} questions.`, { itemsTotal: questions.length });

  if (questions.length === 0) return 0;

  // The paper itself, so "solve an old cycle" has something to open.
  let examCycleId: string | null = null;
  if (source.year) {
    const cycle = await db.examCycle.upsert({
      where: {
        subjectId_year_session: {
          subjectId: subject.id,
          year: source.year,
          session: source.session ?? 'session1',
        },
      },
      update: { title: source.label },
      create: {
        subjectId: subject.id,
        year: source.year,
        session: source.session ?? 'session1',
        title: source.label,
        durationMinutes: source.durationMinutes ?? 180,
      },
      select: { id: true },
    });
    examCycleId = cycle.id;
  }

  await log(jobId, 'Assigning chapters…');
  const tags = await autoTag(
    questions.map((q) => ({ text: q.content_text, topicHint: q.topic_hint })),
    chapterList,
  );
  const tagByIndex = new Map(tags.map((t) => [t.index, t]));

  for (const [index, question] of questions.entries()) {
    const tag = tagByIndex.get(index);

    if (!tag) {
      result.itemsFailed += 1;
      await log(jobId, `Question ${index}: no chapter could be assigned — skipped.`);
      continue;
    }

    try {
      const created = await db.question.create({
        data: {
          chapterId: tag.chapterId,
          sourceType: examCycleId ? 'past_exam' : 'textbook',
          sourceExamId: examCycleId,
          questionType: question.question_type as QuestionType,
          difficulty: question.difficulty ?? null,
          difficultyConfidence: 0.3,
          contentText: question.content_text,
          contentImages: [],
          officialSolution: question.official_solution ?? null,
          bareme: (question.bareme as Prisma.InputJsonValue) ?? undefined,
          options: (question.options as Prisma.InputJsonValue) ?? undefined,
          correctOptionId: question.correct_option_id ?? null,
          orderIndex: Math.round(question.order_index),
          // Ingested content is never trusted on sight.
          verifiedStatus: 'unverified',
        },
        select: { id: true },
      });

      result.itemsProcessed += 1;

      // A low-confidence filing is the failure mode that quietly corrupts a
      // chapter's mastery, so it goes in front of a human.
      if (tag.confidence < TAG_CONFIDENCE_FLOOR) {
        await db.reviewQueueItem.create({
          data: {
            itemType: 'tagged_question',
            itemId: created.id,
            flagReason: `Auto-tagged with low confidence (${tag.confidence.toFixed(2)}). Confirm the chapter.`,
          },
        });
        result.needsReview += 1;
      }
    } catch (err) {
      result.itemsFailed += 1;
      await log(jobId, `Question ${index} failed to insert: ${err instanceof Error ? err.message : 'unknown'}`);
    }

    if (index % 5 === 0) {
      await db.ingestionJob.update({
        where: { id: jobId },
        data: { itemsProcessed: result.itemsProcessed, itemsFailed: result.itemsFailed },
      });
    }
  }

  await embedPending(jobId);
  return questions.length;
}

async function ingestCourseMaterial(ctx: {
  jobId: string;
  source: IngestSource;
  subject: { id: string; name: string };
  text: string;
  chapterList: { id: string; name: string; unitName: string | null }[];
  result: IngestResult;
}): Promise<number> {
  const { jobId, source, subject, text, chapterList, result } = ctx;

  await log(jobId, 'Splitting into course-material chunks…');

  const segmented = await ai().completeJson({
    system: CHUNK_SYSTEM,
    messages: [{ role: 'user', content: `Subject: ${subject.name}\n\n${text.slice(0, 120_000)}` }],
    schema: CHUNK_SCHEMA as unknown as Record<string, unknown>,
    schemaName: 'material_chunking',
    effort: 'high',
    parse: (value) => chunkResponseSchema.parse(value),
  });

  const chunks = segmented.data.chunks;
  await log(jobId, `Split into ${chunks.length} chunks.`, { itemsTotal: chunks.length });
  if (chunks.length === 0) return 0;

  const tags = await autoTag(
    chunks.map((c) => ({ text: `${c.title}\n${c.content_text}`, topicHint: c.topic_hint })),
    chapterList,
  );
  const tagByIndex = new Map(tags.map((t) => [t.index, t]));

  for (const [index, chunk] of chunks.entries()) {
    const tag = tagByIndex.get(index);
    if (!tag) {
      result.itemsFailed += 1;
      continue;
    }

    try {
      await db.contentChunk.create({
        data: {
          chapters: { create: { chapterId: tag.chapterId } },
          kind: chunk.kind,
          title: chunk.title,
          contentText: chunk.content_text,
          sourceRef: source.label,
        },
      });
      result.itemsProcessed += 1;
    } catch (err) {
      result.itemsFailed += 1;
      await log(jobId, `Chunk ${index} failed: ${err instanceof Error ? err.message : 'unknown'}`);
    }
  }

  await embedPending(jobId);
  return chunks.length;
}

// ---------------------------------------------------------------------------
// Embedding backfill
// ---------------------------------------------------------------------------

const EMBED_BATCH = 32;

/**
 * Embeds everything in the corpus that has no vector yet.
 *
 * Split out from insertion so a run that dies part-way can be resumed, and so
 * seeded content (which is inserted without an API key) can be made searchable
 * later with one command. Until a row has a vector it is simply invisible to
 * retrieval — which is why the assistant refuses on a fresh install rather than
 * answering from nowhere.
 */
export async function embedPending(
  jobId?: string,
): Promise<{ questions: number; chunks: number; references: number }> {
  if (!isEmbeddingConfigured()) {
    if (jobId) await log(jobId, 'Embedding skipped: no embedding provider key configured.');
    return { questions: 0, chunks: 0, references: 0 };
  }

  let questions = 0;
  let chunks = 0;
  let references = 0;

  for (;;) {
    const pending = await db.$queryRaw<{ id: string; content_text: string }[]>`
      SELECT id, content_text FROM questions WHERE embedding IS NULL LIMIT ${EMBED_BATCH}
    `;
    if (pending.length === 0) break;

    const vectors = await embedMany(pending.map((row) => row.content_text));
    for (const [index, row] of pending.entries()) {
      const vector = vectors[index];
      if (vector) await setEmbedding('questions', row.id, vector);
    }
    questions += pending.length;
    if (jobId) await log(jobId, `Embedded ${questions} questions…`);
  }

  /*
   * A textbook shared by two tracks is chunked once per track, because chapter
   * mastery is per track and retrieval is scoped to the student's own subject
   * list. That leaves several thousand rows whose text is character-identical
   * to another row's. Embedding each of them separately would pay for the same
   * vector twice and get the same answer back — a third of this corpus is such
   * copies. So the vector is computed once per distinct text and reused.
   *
   * The cache lives for one run only. That is deliberate: it never has to be
   * invalidated, and a re-run after an embedding-model change recomputes
   * everything rather than serving vectors from the previous model.
   */
  const vectorByText = new Map<string, number[]>();
  let reused = 0;

  for (;;) {
    const pending = await db.$queryRaw<{ id: string; content_text: string; title: string | null }[]>`
      SELECT id, content_text, title FROM content_chunks WHERE embedding IS NULL LIMIT ${EMBED_BATCH}
    `;
    if (pending.length === 0) break;

    const texts = pending.map((row) => `${row.title ?? ''}\n${row.content_text}`.trim());
    const fresh = [...new Set(texts.filter((t) => !vectorByText.has(t)))];
    if (fresh.length) {
      const vectors = await embedMany(fresh);
      for (const [index, text] of fresh.entries()) {
        const vector = vectors[index];
        if (vector) vectorByText.set(text, vector);
      }
    }

    for (const [index, row] of pending.entries()) {
      const vector = vectorByText.get(texts[index]!);
      if (vector) await setEmbedding('content_chunks', row.id, vector);
    }
    reused += texts.length - fresh.length;
    chunks += pending.length;
    if (jobId) await log(jobId, `Embedded ${chunks} course-material chunks…`);
  }

  if (reused && jobId) {
    await log(jobId, `${reused} chunk(s) reused a vector already computed for identical text.`);
  }

  /*
   * Personal reference documents.
   *
   * These are embedded at upload, but that call can fail — the provider is
   * down, the key is rotated, a rate limit is hit. Without a backfill the
   * document sits in the student's library marked "not searchable" forever,
   * contributing nothing to the tier-3 retrieval it was uploaded for, and the
   * only way to fix it is for them to notice and re-upload.
   */
  for (;;) {
    const pending = await db.$queryRaw<{ id: string; extracted_text: string | null }[]>`
      SELECT id, extracted_text FROM user_references
      WHERE embedding IS NULL AND extracted_text IS NOT NULL AND length(extracted_text) >= 20
      LIMIT ${EMBED_BATCH}
    `;
    if (pending.length === 0) break;

    const vectors = await embedMany(pending.map((row) => (row.extracted_text ?? '').slice(0, 8000)));
    for (const [index, row] of pending.entries()) {
      const vector = vectors[index];
      if (vector) await setEmbedding('user_references', row.id, vector);
    }
    references += pending.length;
    if (jobId) await log(jobId, `Embedded ${references} personal reference document(s)…`);
  }

  return { questions, chunks, references };
}

function normalize(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Difficulty recalibration
// ---------------------------------------------------------------------------

/**
 * Replaces author-guessed difficulty with observed difficulty.
 *
 *   difficulty = 1 − (mean credit earned across attempts)
 *
 * `difficulty` is what mastery weighting keys off: getting a hard question
 * right counts for more than getting an easy one right. `difficulty_confidence`
 * is recorded alongside it as sample-size metadata — it is deliberately NOT
 * folded into the mastery formula, which the exec plan specifies exactly, but
 * it is what tells a reviewer whether a difficulty of 0.9 reflects three
 * attempts or three hundred. Run nightly.
 */
export async function recalibrateDifficulty(minAttempts = 5): Promise<number> {
  const rows = await db.$queryRaw<{ id: string; attempts: bigint; mean_credit: number }[]>`
    SELECT q.id,
           COUNT(a.id) AS attempts,
           AVG(
             CASE
               WHEN a.is_correct IS NOT NULL THEN (CASE WHEN a.is_correct THEN 1.0 ELSE 0.0 END)
               WHEN a.max_score IS NOT NULL AND a.max_score > 0 THEN LEAST(1.0, a.score / a.max_score)
               ELSE NULL
             END
           ) AS mean_credit
    FROM questions q
    JOIN attempts a ON a.question_id = q.id
    GROUP BY q.id
    HAVING COUNT(a.id) >= ${minAttempts}
  `;

  let updated = 0;
  for (const row of rows) {
    if (row.mean_credit === null) continue;
    const attempts = Number(row.attempts);
    const difficulty = Math.min(1, Math.max(0, 1 - Number(row.mean_credit)));
    // Saturates at 50 attempts: beyond that, more data barely changes the estimate.
    const confidence = Math.min(1, attempts / 50);

    await db.question.update({
      where: { id: row.id },
      data: { difficulty, difficultyConfidence: confidence },
    });
    updated += 1;
  }

  return updated;
}
