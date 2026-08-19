import 'server-only';

import { db } from '@/lib/db';
import { isEmbeddingConfigured } from '@/lib/env';
import {
  CONCEPT_LEVEL_THRESHOLD,
  EXACT_MATCH_AGREEMENT,
  EXACT_MATCH_THRESHOLD,
  lexicalAgreement,
} from '@/lib/retrieval';
import { searchContentChunks, searchQuestions } from '@/lib/vector';

/**
 * Retrieval eval harness.
 *
 * The 0.85 and 0.72 thresholds decide what the assistant is allowed to say.
 * They were chosen as sensible starting points, and the honest position is that
 * nobody knows whether they are right for *this* corpus until they are measured
 * against it. This is that measurement.
 *
 * The method is leave-one-out. Each probe question is embedded, searched
 * against the corpus, and then **excluded from its own results**. What remains
 * is the nearest *other* thing in the corpus — which is exactly what a student
 * asking a similar-but-not-identical question would hit.
 *
 * That distinction is the whole point:
 *
 *   * If a lot of probes still clear 0.85 after excluding themselves, the
 *     corpus contains near-duplicates and tier 1 will fire on the *wrong*
 *     question — the assistant will confidently explain a different problem's
 *     official solution. The threshold is too low.
 *   * If almost nothing clears 0.72, tier 2 never fires and every real question
 *     falls through to "not covered". The threshold is too high, or the course
 *     material corpus is too thin.
 *
 * Deliberately needs no chat model — only embeddings. An eval that costs a
 * generation call per probe is an eval nobody runs.
 */

export type EvalReport = {
  probes: number;
  /** Tier that would fire for each probe, with itself excluded. */
  tierCounts: {
    exact_match: number;
    concept_level: number;
    personal_reference: number;
    ungrounded_refused: number;
  };
  refusalRate: number;
  meanTopQuestionSimilarity: number;
  meanTopChunkSimilarity: number;
  /**
   * What proportion of probes would be treated as an exact match at each
   * candidate threshold. Read this to choose the tier-1 cutoff: the right value
   * is where the curve stops being dominated by near-duplicates.
   */
  exactMatchSweep: { threshold: number; rate: number }[];
  conceptSweep: { threshold: number; rate: number }[];
  /** Probes whose nearest neighbour is suspiciously close — likely duplicates. */
  suspectedDuplicates: {
    questionId: string;
    neighbourId: string;
    similarity: number;
    chapterName: string;
  }[];
  thresholds: { exactMatch: number; conceptLevel: number };
  warnings: string[];
};

const SWEEP_POINTS = [0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95];

/** Above this, after excluding itself, two questions are effectively the same question. */
const DUPLICATE_ALARM = 0.97;

export async function runRetrievalEval(sampleSize = 50): Promise<EvalReport> {
  if (!isEmbeddingConfigured()) {
    throw new Error('The eval harness needs an embedding provider key.');
  }

  // Probes are drawn from questions that already have vectors — the corpus as
  // retrieval actually sees it, not as the seed file describes it.
  const probes = await db.$queryRaw<
    { id: string; subjectId: string; chapterName: string; contentText: string; embedding: string }[]
  >`
    SELECT q.id            AS "id",
           c.subject_id    AS "subjectId",
           c.name          AS "chapterName",
           q.content_text  AS "contentText",
           q.embedding::text AS "embedding"
    FROM questions q
    JOIN chapters c ON c.id = q.chapter_id
    WHERE q.embedding IS NOT NULL
      AND q.verified_status <> 'rejected'
    ORDER BY q.id
    LIMIT ${sampleSize}
  `;

  const report: EvalReport = {
    probes: probes.length,
    tierCounts: { exact_match: 0, concept_level: 0, personal_reference: 0, ungrounded_refused: 0 },
    refusalRate: 0,
    meanTopQuestionSimilarity: 0,
    meanTopChunkSimilarity: 0,
    exactMatchSweep: SWEEP_POINTS.map((threshold) => ({ threshold, rate: 0 })),
    conceptSweep: SWEEP_POINTS.map((threshold) => ({ threshold, rate: 0 })),
    suspectedDuplicates: [],
    thresholds: { exactMatch: EXACT_MATCH_THRESHOLD, conceptLevel: CONCEPT_LEVEL_THRESHOLD },
    warnings: [],
  };

  if (probes.length === 0) {
    report.warnings.push(
      'No questions have embeddings. Run "npm run ingest -- --embed-missing" before evaluating.',
    );
    return report;
  }

  const questionSimilarities: number[] = [];
  const chunkSimilarities: number[] = [];

  for (const probe of probes) {
    const vector = parseVector(probe.embedding);
    if (!vector) continue;

    // 4 not 1: the probe itself will occupy the top slot, and a chapter can
    // legitimately contain a couple of near-identical drilling questions.
    const questionHits = await searchQuestions(vector, [probe.subjectId], 4);
    const otherQuestions = questionHits.filter((hit) => hit.id !== probe.id);
    const topQuestion = otherQuestions[0];

    const chunkHits = await searchContentChunks(vector, [probe.subjectId], 4);
    const topChunk = chunkHits[0];

    const questionSimilarity = topQuestion?.similarity ?? 0;
    const chunkSimilarity = topChunk?.similarity ?? 0;

    questionSimilarities.push(questionSimilarity);
    chunkSimilarities.push(chunkSimilarity);

    // Replays the real tier order from lib/retrieval, minus the personal
    // reference tier — that one is per-student and has no corpus-wide meaning.
    /*
     * Tier 1 also requires the two questions to share their words, exactly as
     * lib/retrieval does. Without it this eval reports a hazard the pipeline no
     * longer has: on this corpus a probe's nearest neighbour is very often a
     * different year's version of the same exercise, which scores above 0.97
     * on embeddings alone.
     */
    const agreement = topQuestion ? lexicalAgreement(probe.contentText, topQuestion.contentText) : 0;

    if (questionSimilarity >= EXACT_MATCH_THRESHOLD && agreement >= EXACT_MATCH_AGREEMENT) {
      report.tierCounts.exact_match += 1;
    } else if (chunkSimilarity >= CONCEPT_LEVEL_THRESHOLD) {
      report.tierCounts.concept_level += 1;
    } else {
      report.tierCounts.ungrounded_refused += 1;
    }

    for (const point of report.exactMatchSweep) {
      if (questionSimilarity >= point.threshold) point.rate += 1;
    }
    for (const point of report.conceptSweep) {
      if (chunkSimilarity >= point.threshold) point.rate += 1;
    }

    if (topQuestion && topQuestion.similarity >= DUPLICATE_ALARM) {
      report.suspectedDuplicates.push({
        questionId: probe.id,
        neighbourId: topQuestion.id,
        similarity: round3(topQuestion.similarity),
        chapterName: probe.chapterName,
      });
    }
  }

  const n = Math.max(1, questionSimilarities.length);

  report.meanTopQuestionSimilarity = round3(sum(questionSimilarities) / n);
  report.meanTopChunkSimilarity = round3(sum(chunkSimilarities) / n);
  report.refusalRate = round3(report.tierCounts.ungrounded_refused / n);
  report.exactMatchSweep = report.exactMatchSweep.map((p) => ({ ...p, rate: round3(p.rate / n) }));
  report.conceptSweep = report.conceptSweep.map((p) => ({ ...p, rate: round3(p.rate / n) }));

  // --- Interpretation, so the numbers come with a reading ------------------
  if (report.refusalRate > 0.8) {
    report.warnings.push(
      `${Math.round(report.refusalRate * 100)}% of probes reach no tier at all. Either the course-material ` +
        'corpus is too thin for tier 2 to fire, or CONCEPT_LEVEL_THRESHOLD is too high. Students will be ' +
        'told "not covered" for material that is on the syllabus.',
    );
  }

  /*
   * Warned on the rate that clears BOTH tier-1 gates, not the cosine sweep.
   *
   * The sweep counts probes whose nearest neighbour passes the similarity bar
   * alone, and on this corpus that is most of them — the same exercise is
   * published in Arabic, French and English for one sitting, and an embedding
   * rates the three above 0.98 because they mean the same thing. None of them
   * can reach tier 1: the tier also demands the two texts share their words,
   * and translations share almost none.
   *
   * Reporting the sweep number as the hazard told the reader to raise a
   * threshold that was never the thing holding the line.
   */
  const collisionRate = report.tierCounts.exact_match / n;
  if (collisionRate > 0.25) {
    report.warnings.push(
      `${Math.round(collisionRate * 100)}% of probes would be grounded on a DIFFERENT question's official ` +
        `solution — above ${EXACT_MATCH_THRESHOLD} similarity AND ${EXACT_MATCH_AGREEMENT} word overlap. ` +
        'At this rate the assistant will explain the wrong question. Raise EXACT_MATCH_THRESHOLD.',
    );
  }

  if (report.suspectedDuplicates.length > 0) {
    report.warnings.push(
      `${report.suspectedDuplicates.length} probe(s) have a near-identical twin in the corpus ` +
        `(≥ ${DUPLICATE_ALARM}). Expected where a sitting is published in several languages; a real ` +
        'double ingestion shows up as a twin from the SAME exam year in the same language.',
    );
  }

  const chunkCount = await db.contentChunk.count();
  if (chunkCount < 50) {
    report.warnings.push(
      `Only ${chunkCount} course-material chunks exist. Tier 2 cannot carry the syllabus at this size; ` +
        'ingest course material before reading the tier distribution as meaningful.',
    );
  }

  return report;
}

/** pgvector renders as `[0.1,0.2,…]`; read it back without a round-trip through the API. */
function parseVector(literal: string): number[] | null {
  try {
    const parsed = JSON.parse(literal) as unknown;
    return Array.isArray(parsed) ? (parsed as number[]) : null;
  } catch {
    return null;
  }
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
