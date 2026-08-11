import 'server-only';

import { Prisma } from '@prisma/client';

import { db } from '@/lib/db';
import { env } from '@/lib/env';

/**
 * pgvector access.
 *
 * Prisma has no vector type, so every similarity query is raw SQL. All of them
 * live here rather than being scattered through feature code — this is the file
 * to read when tuning retrieval, and the only place a hand-written SQL string
 * touches user input.
 *
 * Distance operator is `<=>` (cosine) to match the `vector_cosine_ops` index.
 * Similarity is reported as `1 - distance` so callers compare against the
 * thresholds in the spec (0.85 exact-match, 0.72 concept-level) directly.
 */

/** Serializes a JS array into the literal pgvector expects. */
export function toVectorLiteral(vector: number[]): string {
  return `[${vector.map((n) => (Number.isFinite(n) ? n : 0)).join(',')}]`;
}

/**
 * Subject scoping for retrieval.
 *
 * Chat is not always anchored to one subject — a student asking a free-form
 * question is asking it of their whole track — so every search takes a list.
 * The list is never empty and never client-supplied: callers derive it from the
 * signed-in user's locked track.
 */
export type SubjectScope = string | string[];

function subjectFilter(column: string, scope: SubjectScope): Prisma.Sql {
  const ids = Array.isArray(scope) ? scope : [scope];
  if (ids.length === 0) {
    // An empty scope must match nothing rather than everything.
    return Prisma.sql`false`;
  }
  return Prisma.sql`${Prisma.raw(column)} IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})`;
}

export type SimilarityHit = {
  id: string;
  similarity: number;
};

export type QuestionHit = SimilarityHit & {
  chapterId: string;
  chapterName: string;
  subjectId: string;
  contentText: string;
  contentLatex: string | null;
  officialSolution: string | null;
  officialSolutionLatex: string | null;
};

/**
 * Tier 1: near-exact match against real past-exam and textbook questions,
 * scoped to one subject so a physics question cannot be answered from a maths
 * paper that happens to share vocabulary.
 */
export async function searchQuestions(
  embedding: number[],
  scope: SubjectScope,
  limit = 5,
): Promise<QuestionHit[]> {
  const literal = toVectorLiteral(embedding);

  return db.$queryRaw<QuestionHit[]>(Prisma.sql`
    SELECT
      q.id                       AS "id",
      q.chapter_id               AS "chapterId",
      c.name                     AS "chapterName",
      c.subject_id               AS "subjectId",
      q.content_text             AS "contentText",
      q.content_latex            AS "contentLatex",
      q.official_solution        AS "officialSolution",
      q.official_solution_latex  AS "officialSolutionLatex",
      1 - (q.embedding <=> ${literal}::vector) AS "similarity"
    FROM questions q
    JOIN chapters c ON c.id = q.chapter_id
    WHERE ${subjectFilter('c.subject_id', scope)}
      AND q.embedding IS NOT NULL
      AND q.verified_status <> 'rejected'
    ORDER BY q.embedding <=> ${literal}::vector
    LIMIT ${limit}
  `);
}

export type ContentChunkHit = SimilarityHit & {
  chapterId: string;
  chapterName: string;
  kind: string;
  title: string | null;
  contentText: string;
  contentLatex: string | null;
  sourceRef: string | null;
};

/**
 * Tier 2: chapter-level course material — formulas, methods, worked examples.
 * This is what lets the assistant answer a question it has never seen before
 * without leaving the curriculum.
 */
export async function searchContentChunks(
  embedding: number[],
  scope: SubjectScope,
  limit = 6,
): Promise<ContentChunkHit[]> {
  const literal = toVectorLiteral(embedding);

  return db.$queryRaw<ContentChunkHit[]>(Prisma.sql`
    SELECT
      cc.id            AS "id",
      cc.chapter_id    AS "chapterId",
      c.name           AS "chapterName",
      cc.kind::text    AS "kind",
      cc.title         AS "title",
      cc.content_text  AS "contentText",
      cc.content_latex AS "contentLatex",
      cc.source_ref    AS "sourceRef",
      1 - (cc.embedding <=> ${literal}::vector) AS "similarity"
    FROM content_chunks cc
    JOIN chapters c ON c.id = cc.chapter_id
    WHERE ${subjectFilter('c.subject_id', scope)}
      AND cc.embedding IS NOT NULL
    ORDER BY cc.embedding <=> ${literal}::vector
    LIMIT ${limit}
  `);
}

export type UserReferenceHit = SimilarityHit & {
  fileName: string | null;
  extractedText: string | null;
};

/**
 * Tier 3: the student's own uploaded documents.
 *
 * The `user_id` filter is not an optimization — it is the privacy boundary.
 * These documents are private to one student and must never surface in another
 * student's answer.
 */
export async function searchUserReferences(
  embedding: number[],
  userId: string,
  limit = 4,
): Promise<UserReferenceHit[]> {
  const literal = toVectorLiteral(embedding);

  return db.$queryRaw<UserReferenceHit[]>`
    SELECT
      ur.id             AS "id",
      ur.file_name      AS "fileName",
      ur.extracted_text AS "extractedText",
      1 - (ur.embedding <=> ${literal}::vector) AS "similarity"
    FROM user_references ur
    WHERE ur.user_id = ${userId}::uuid
      AND ur.embedding IS NOT NULL
    ORDER BY ur.embedding <=> ${literal}::vector
    LIMIT ${limit}
  `;
}

/**
 * Duplicate guard for the generation pipeline. A generated problem whose
 * embedding is within `threshold` cosine similarity of anything already in the
 * pool is a paraphrase, not a new question, and is rejected before insert.
 */
export async function findNearDuplicate(
  embedding: number[],
  chapterId: string,
  threshold = 0.95,
): Promise<SimilarityHit | null> {
  const literal = toVectorLiteral(embedding);

  const rows = await db.$queryRaw<SimilarityHit[]>`
    SELECT id, 1 - (embedding <=> ${literal}::vector) AS "similarity"
    FROM generated_problems
    WHERE chapter_id = ${chapterId}::uuid
      AND embedding IS NOT NULL
    ORDER BY embedding <=> ${literal}::vector
    LIMIT 1
  `;

  const top = rows[0];
  return top && top.similarity >= threshold ? top : null;
}

type EmbeddingTable = 'questions' | 'content_chunks' | 'generated_problems' | 'user_references';

/**
 * Writes an embedding. Table names cannot be parameterized, so the caller's
 * value is checked against a fixed allow-list before interpolation.
 */
export async function setEmbedding(table: EmbeddingTable, id: string, embedding: number[]): Promise<void> {
  const allowed: EmbeddingTable[] = ['questions', 'content_chunks', 'generated_problems', 'user_references'];
  if (!allowed.includes(table)) throw new Error(`Refusing to write an embedding to unknown table "${table}".`);

  const literal = toVectorLiteral(embedding);
  await db.$executeRaw(
    Prisma.sql`UPDATE ${Prisma.raw(`"${table}"`)} SET embedding = ${literal}::vector WHERE id = ${id}::uuid`,
  );
}
