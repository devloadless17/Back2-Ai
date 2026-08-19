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

/**
 * How wide a net the HNSW index casts before the subject filter is applied.
 *
 * This is the single most consequential number in the file, and its default was
 * silently wrong for this corpus.
 *
 * An HNSW scan walks the graph over the whole table and only afterwards discards
 * rows outside the student's subjects. When a query's true neighbours are mostly
 * out of scope, the default search list of 40 is spent on rows that get thrown
 * away, and what comes back is whatever happened to survive. It is not an error
 * and nothing logs it — the search returns rows, they are simply the wrong ones.
 *
 * Measured against a sequential scan over identical rows, the default missed the
 * nearest passage for four of twelve probes:
 *
 *     ما هي البطالة؟            returned 0.191   true best 0.545
 *     ما هو الوعي واللاوعي؟     returned 0.162   true best 0.691
 *     ما هي الحقيقة في الفلسفة؟ returned 0.263   true best 0.633
 *     ما هو التمييز في النحو؟   returned 0.403   true best 0.544
 *
 * Every miss was Arabic, which is what made this look for months like a ranking
 * problem in Arabic rather than an index problem. It is not: the Arabic books
 * are a minority of the table, so an Arabic query is the case where most true
 * neighbours lie outside one track's subjects. Two of those four fell below the
 * concept threshold and were refused outright — a student was told their own
 * economics syllabus was not covered, with the defining paragraph sitting in the
 * table at 0.545.
 *
 * 200 restores the true nearest passage on all twelve. It is deliberately past
 * the 120 where recall first reaches full, because the corpus keeps growing and
 * the margin costs nothing measurable: median latency is 9ms at both 40 and 200,
 * since the filter dominates the graph walk. Iterative scan was tried and is
 * worse here — 89% recall, because the EXISTS filter cannot be pushed into the
 * index scan for it to iterate against.
 */
const EF_SEARCH = 200;

/**
 * Runs a vector search with the widened search list.
 *
 * A transaction, because `SET LOCAL` and the query it configures must land on
 * the same pooled connection. `SET` without it would leak the setting to
 * whichever request borrowed that connection next, and set nothing at all for
 * this one about as often.
 */
async function withFullRecall<T>(run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL hnsw.ef_search = ${EF_SEARCH}`);
    return run(tx);
  });
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
  queryText?: string,
): Promise<QuestionHit[]> {
  const literal = toVectorLiteral(embedding);

  /*
   * The term index matters more here than anywhere else.
   *
   * Tier 1 fires when a student is asking about a past question, and the way
   * that happens in practice is that they paste or retype the question. Those
   * are the same words, which is precisely what a term index is for and
   * precisely where an embedding is weakest — every year's differential
   * equation exercise reads alike to a vector.
   *
   * It only widens the candidate pool. The tier still requires a high cosine
   * *and* real word overlap with the matched question before it will answer
   * from an official solution.
   */
  const lexical = queryText?.trim()
    ? Prisma.sql`
        UNION
        SELECT q.id
        FROM questions q
        JOIN chapters c ON c.id = q.chapter_id,
             websearch_to_tsquery('simple', fold_arabic(${queryText})) AS t(query)
        WHERE ${subjectFilter('c.subject_id', scope)}
          AND q.embedding IS NOT NULL
          AND q.verified_status <> 'rejected'
          AND to_tsvector('simple', q.search_text) @@ t.query
        ORDER BY 1
        LIMIT ${limit * 4}
      `
    : Prisma.empty;

  return withFullRecall((tx) => tx.$queryRaw<QuestionHit[]>(Prisma.sql`
    WITH candidates AS (
      SELECT id FROM (
        SELECT q.id
        FROM questions q
        JOIN chapters c ON c.id = q.chapter_id
        WHERE ${subjectFilter('c.subject_id', scope)}
          AND q.embedding IS NOT NULL
          AND q.verified_status <> 'rejected'
        ORDER BY q.embedding <=> ${literal}::vector
        LIMIT ${limit * 4}
      ) nearest
      ${lexical}
    )
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
    FROM candidates
    JOIN questions q ON q.id = candidates.id
    JOIN chapters c ON c.id = q.chapter_id
    ORDER BY q.embedding <=> ${literal}::vector
    LIMIT ${limit}
  `));
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
 * How much the term index is allowed to move a passage up the list.
 *
 * Small deliberately: cosine is the primary signal and a strong semantic match
 * should still win.
 */
const LEXICAL_WEIGHT = 0.15;

/**
 * Vector search and term search over the same passages, merged.
 *
 * Worth being straight about what this does and does not buy, because the
 * obvious measurement of it is wrong.
 *
 * Measured with probes copied verbatim out of the passages, adding the term
 * index looked transformative — Arabic top-1 went from 36% to 82%. That number
 * is worthless. A sentence lifted from a passage is an exact string, which is
 * the one thing a term index is guaranteed to find, so the benchmark was
 * grading itself.
 *
 * Measured again with questions a student would actually type — paraphrased,
 * cached in corpus/retrieval-probes.json — it moves almost nothing: French
 * unchanged at 54%/91%, English 50%/86% to 51%/88%, Arabic unchanged at
 * 29%/80%.
 *
 * It is kept for the case the paraphrase benchmark does not cover and tier 1
 * exists for: a student pasting a past-exam question back in, where their words
 * *are* the source's words. That is the verbatim case, and there the gain is
 * the large one. It costs about 15ms.
 *
 * `similarity` on every returned row is the true cosine, never the blended
 * score. The retrieval tiers decide whether to answer at all from that number,
 * and a lexical hit must never be able to talk the pipeline into speaking — it
 * may only change the order of what it speaks from.
 */
async function searchContentChunksHybrid(
  literal: string,
  queryText: string,
  scope: SubjectScope,
  limit: number,
): Promise<ContentChunkHit[]> {
  const pool = Math.max(limit * 3, 30);

  /*
   * Each candidate set queries content_chunks directly. Collecting the scoped
   * rows into a shared CTE first and filtering that instead costs a second per
   * query — 976ms against 44ms on this corpus, measured with EXPLAIN ANALYZE.
   *
   * The reason is the term filter, not the vector one. A CTE has no indexes on
   * it, so `to_tsvector(...) @@ query` over a CTE is executed row by row: the
   * plan shows `CTE Scan on scoped … Rows Removed by Filter: 4606`, meaning a
   * tsvector was built at query time from 4,636 rows of full chapter text.
   * Reading the table instead lets the GIN index answer it — the same plan
   * becomes `Bitmap Index Scan on content_chunks_search_idx (actual rows=64)`.
   *
   * The EXISTS scoping does not stop the HNSW index being used, though an
   * EXPLAIN can easily suggest otherwise. Written with an explicit list of
   * subject uuids — which is what `subjectFilter` produces and therefore what
   * this always sends — the plan is an HNSW index scan at about 3ms. Write the
   * same intent as a join through `tracks.code`, or against a temp table, and
   * the planner switches to a sequential scan over every embedded passage.
   *
   * So an EXPLAIN is only evidence about the query you actually send. A
   * denormalised subject_ids column was built to fix the sequential scan and
   * turned out to be slower than the join it replaced (43ms against 3ms); see
   * the migration that drops it again.
   */
  const rows = await withFullRecall((tx) => tx.$queryRaw<(ContentChunkHit & { lexical: number })[]>(Prisma.sql`
    WITH nearest AS (
      SELECT cc.id
      FROM content_chunks cc
      WHERE cc.embedding IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM chapter_content_chunks l
          JOIN chapters c ON c.id = l.chapter_id
          WHERE l.chunk_id = cc.id AND ${subjectFilter('c.subject_id', scope)}
        )
      ORDER BY cc.embedding <=> ${literal}::vector
      LIMIT ${pool}
    ),
    termed AS (
      SELECT cc.id,
             ts_rank(to_tsvector('simple', cc.search_text), q.query) AS lexical
      FROM content_chunks cc,
           websearch_to_tsquery('simple', fold_arabic(${queryText})) AS q(query)
      WHERE cc.embedding IS NOT NULL
        AND to_tsvector('simple', cc.search_text) @@ q.query
        AND EXISTS (
          SELECT 1 FROM chapter_content_chunks l
          JOIN chapters c ON c.id = l.chapter_id
          WHERE l.chunk_id = cc.id AND ${subjectFilter('c.subject_id', scope)}
        )
      ORDER BY lexical DESC
      LIMIT ${pool}
    ),
    candidates AS (
      SELECT id FROM nearest UNION SELECT id FROM termed
    )
    SELECT
      s.id             AS "id",
      (SELECT c.id FROM chapter_content_chunks l
        JOIN chapters c ON c.id = l.chapter_id
        WHERE l.chunk_id = s.id AND ${subjectFilter('c.subject_id', scope)}
        LIMIT 1)       AS "chapterId",
      (SELECT c.name FROM chapter_content_chunks l
        JOIN chapters c ON c.id = l.chapter_id
        WHERE l.chunk_id = s.id AND ${subjectFilter('c.subject_id', scope)}
        LIMIT 1)       AS "chapterName",
      s.kind::text     AS "kind",
      s.title          AS "title",
      s.content_text   AS "contentText",
      s.content_latex  AS "contentLatex",
      s.source_ref     AS "sourceRef",
      1 - (s.embedding <=> ${literal}::vector) AS "similarity",
      coalesce(t.lexical, 0) AS "lexical"
    FROM candidates c
    JOIN content_chunks s ON s.id = c.id
    LEFT JOIN termed t ON t.id = c.id
  `));

  // ts_rank has no fixed range, so it is scaled against the best hit in this
  // result set rather than against an absolute number that would drift.
  const strongest = Math.max(...rows.map((r) => r.lexical), 0);
  const ranked = rows
    .map((row) => ({
      row,
      score: row.similarity + (strongest > 0 ? (LEXICAL_WEIGHT * row.lexical) / strongest : 0),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return ranked.map(({ row }) => {
    const { lexical: _lexical, ...hit } = row;
    return hit;
  });
}

/**
 * Tier 2: chapter-level course material — formulas, methods, worked examples.
 * This is what lets the assistant answer a question it has never seen before
 * without leaving the curriculum.
 */
export async function searchContentChunks(
  embedding: number[],
  scope: SubjectScope,
  limit = 6,
  queryText?: string,
): Promise<ContentChunkHit[]> {
  const literal = toVectorLiteral(embedding);

  /*
   * With a query string, the term index is searched alongside the vector and
   * the two candidate sets are merged. See `blendLexical` for why, and note
   * that `similarity` on every row returned is still the true cosine — the
   * lexical score only reorders, it never inflates the number the retrieval
   * tiers gate on.
   */
  if (queryText && queryText.trim()) {
    return searchContentChunksHybrid(literal, queryText, scope, limit);
  }

  /*
   * A passage is stored once and linked to every chapter that teaches it, so
   * the chapter is reached through `chapter_content_chunks` rather than a
   * column. Textbooks are shared across tracks, and one passage can therefore
   * belong to a GS chapter and an LS one at the same time.
   *
   * The chapter is resolved by a correlated subquery restricted to the caller's
   * own subjects, so a shared passage is always reported under the chapter the
   * student actually studies — a GS student is never told their material comes
   * from an LS chapter. `EXISTS` keeps one row per passage, which matters
   * because a join would return the same text once per matching chapter and
   * silently fill the tutor's context with duplicates of one paragraph.
   */
  return withFullRecall((tx) => tx.$queryRaw<ContentChunkHit[]>(Prisma.sql`
    SELECT
      cc.id            AS "id",
      (SELECT c.id FROM chapter_content_chunks l
        JOIN chapters c ON c.id = l.chapter_id
        WHERE l.chunk_id = cc.id AND ${subjectFilter('c.subject_id', scope)}
        LIMIT 1)       AS "chapterId",
      (SELECT c.name FROM chapter_content_chunks l
        JOIN chapters c ON c.id = l.chapter_id
        WHERE l.chunk_id = cc.id AND ${subjectFilter('c.subject_id', scope)}
        LIMIT 1)       AS "chapterName",
      cc.kind::text    AS "kind",
      cc.title         AS "title",
      cc.content_text  AS "contentText",
      cc.content_latex AS "contentLatex",
      cc.source_ref    AS "sourceRef",
      1 - (cc.embedding <=> ${literal}::vector) AS "similarity"
    FROM content_chunks cc
    WHERE cc.embedding IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM chapter_content_chunks l
        JOIN chapters c ON c.id = l.chapter_id
        WHERE l.chunk_id = cc.id AND ${subjectFilter('c.subject_id', scope)}
      )
    ORDER BY cc.embedding <=> ${literal}::vector
    LIMIT ${limit}
  `));
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

  /*
   * Widened for the same reason as the others, and more sharply here: one
   * student's uploads are a handful of rows in a table of everybody's, so almost
   * everything the graph walk visits is somebody else's and gets discarded. This
   * is the most selective filter in the file.
   */
  return withFullRecall((tx) => tx.$queryRaw<UserReferenceHit[]>`
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
  `);
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

  /*
   * Widened deliberately, because a miss here is silent and permanent: the
   * duplicate that the narrow search failed to find is not flagged, it is
   * inserted, and the pool grows a paraphrase of a question it already had.
   */
  const rows = await withFullRecall((tx) => tx.$queryRaw<SimilarityHit[]>`
    SELECT id, 1 - (embedding <=> ${literal}::vector) AS "similarity"
    FROM generated_problems
    WHERE chapter_id = ${chapterId}::uuid
      AND embedding IS NOT NULL
    ORDER BY embedding <=> ${literal}::vector
    LIMIT 1
  `);

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
