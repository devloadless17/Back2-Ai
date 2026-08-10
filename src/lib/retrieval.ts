import 'server-only';

import type { GroundingTier } from '@prisma/client';

import { embed } from '@/lib/ai/embeddings';
import {
  searchContentChunks,
  searchQuestions,
  searchUserReferences,
  type ContentChunkHit,
  type QuestionHit,
  type UserReferenceHit,
} from '@/lib/vector';

/**
 * Tiered retrieval — the pipeline that decides what the assistant is allowed
 * to say, and on what basis.
 *
 * The tiers are tried in order and the pipeline STOPS at the first one that
 * clears its threshold. If nothing clears, the outcome is an explicit refusal,
 * not a best-effort answer. That is the whole point: for a system a ministry
 * puts in front of exam candidates, a confident wrong answer about what is on
 * the syllabus is worse than "this isn't covered".
 *
 * Thresholds are constants here so they can be tuned against the eval harness
 * without hunting through feature code. Every chat message records the tier
 * that fired and the similarity that triggered it, so a threshold change can be
 * evaluated against real traffic rather than guessed at.
 */

export const EXACT_MATCH_THRESHOLD = 0.85;
export const CONCEPT_LEVEL_THRESHOLD = 0.72;
export const PERSONAL_REFERENCE_THRESHOLD = 0.72;

export type RetrievalSource = {
  id: string;
  kind: 'question' | 'content_chunk' | 'user_reference';
  label: string;
  similarity: number;
  text: string;
};

export type GroundingResult = {
  tier: GroundingTier;
  sources: RetrievalSource[];
  /** The material handed to the model as context. Empty when refused. */
  context: string;
  topSimilarity: number | null;
  /**
   * True for concept-level and personal-reference answers, where the model
   * synthesizes rather than restates. Those answers get a verification pass
   * before they reach a student.
   */
  requiresVerification: boolean;
};

export type RetrievalInput = {
  query: string;
  /**
   * Subjects the answer may be grounded in. Derived server-side from the
   * student's locked track — never taken from the client, or a student could
   * read another track's material by editing a request body.
   */
  subjectIds: string[];
  userId: string;
  /**
   * When the student is asking about a specific question they are looking at,
   * that question is used as tier-1 grounding directly — there is no reason to
   * go searching for something we were handed.
   */
  anchorQuestion?: {
    id: string;
    contentText: string;
    officialSolution: string | null;
  } | null;
};

export async function retrieveGrounding(input: RetrievalInput): Promise<GroundingResult> {
  if (input.anchorQuestion) {
    const anchor = input.anchorQuestion;
    return {
      tier: 'exact_match',
      topSimilarity: 1,
      requiresVerification: false,
      sources: [
        {
          id: anchor.id,
          kind: 'question',
          label: 'The question being worked on',
          similarity: 1,
          text: anchor.contentText,
        },
      ],
      context: formatQuestionContext(anchor.contentText, anchor.officialSolution),
    };
  }

  if (input.subjectIds.length === 0) {
    // A student with no track has no curriculum to be grounded in. Refusing is
    // the only correct outcome; guessing would be answering from nowhere.
    return {
      tier: 'ungrounded_refused',
      topSimilarity: null,
      requiresVerification: false,
      sources: [],
      context: '',
    };
  }

  const queryVector = await embed(input.query, 'query');

  // --- Tier 1: near-exact match against a real question -------------------
  const questionHits = await searchQuestions(queryVector, input.subjectIds, 3);
  const topQuestion = questionHits[0];

  if (topQuestion && topQuestion.similarity >= EXACT_MATCH_THRESHOLD) {
    return {
      tier: 'exact_match',
      topSimilarity: topQuestion.similarity,
      requiresVerification: false,
      sources: [questionSource(topQuestion)],
      context: formatQuestionContext(topQuestion.contentText, topQuestion.officialSolution),
    };
  }

  // --- Tier 2: chapter-level course material ------------------------------
  const chunkHits = await searchContentChunks(queryVector, input.subjectIds, 6);
  const passingChunks = chunkHits.filter((c) => c.similarity >= CONCEPT_LEVEL_THRESHOLD);

  if (passingChunks.length > 0) {
    return {
      tier: 'concept_level',
      topSimilarity: passingChunks[0]?.similarity ?? null,
      requiresVerification: true,
      sources: passingChunks.map(chunkSource),
      context: passingChunks
        .map((c) => `## ${c.chapterName} — ${c.title ?? c.kind}\n${c.contentLatex ?? c.contentText}`)
        .join('\n\n'),
    };
  }

  // --- Tier 3: the student's own uploaded documents -----------------------
  const referenceHits = await searchUserReferences(queryVector, input.userId, 4);
  const passingReferences = referenceHits.filter((r) => r.similarity >= PERSONAL_REFERENCE_THRESHOLD);

  if (passingReferences.length > 0) {
    return {
      tier: 'personal_reference',
      topSimilarity: passingReferences[0]?.similarity ?? null,
      requiresVerification: true,
      sources: passingReferences.map(referenceSource),
      context: passingReferences
        .map((r) => `## From your document "${r.fileName ?? 'untitled'}"\n${(r.extractedText ?? '').slice(0, 4000)}`)
        .join('\n\n'),
    };
  }

  // --- Nothing cleared threshold anywhere ---------------------------------
  return {
    tier: 'ungrounded_refused',
    topSimilarity: topQuestion?.similarity ?? null,
    requiresVerification: false,
    sources: [],
    context: '',
  };
}

function formatQuestionContext(contentText: string, officialSolution: string | null): string {
  const parts = [`## Official question\n${contentText}`];
  if (officialSolution) parts.push(`## Official solution\n${officialSolution}`);
  return parts.join('\n\n');
}

function questionSource(hit: QuestionHit): RetrievalSource {
  return {
    id: hit.id,
    kind: 'question',
    label: `${hit.chapterName} — past question`,
    similarity: hit.similarity,
    text: hit.contentText,
  };
}

function chunkSource(hit: ContentChunkHit): RetrievalSource {
  return {
    id: hit.id,
    kind: 'content_chunk',
    label: `${hit.chapterName} — ${hit.title ?? hit.kind}`,
    similarity: hit.similarity,
    text: hit.contentText,
  };
}

function referenceSource(hit: UserReferenceHit): RetrievalSource {
  return {
    id: hit.id,
    kind: 'user_reference',
    label: hit.fileName ?? 'Your uploaded document',
    similarity: hit.similarity,
    text: (hit.extractedText ?? '').slice(0, 500),
  };
}

/** Whether an assistant turn on this tier may be shown without a verification pass. */
export function isDirectlyGrounded(tier: GroundingTier): boolean {
  return tier === 'exact_match';
}
