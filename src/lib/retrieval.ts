import 'server-only';

import type { GroundingTier } from '@prisma/client';

import { ai } from '@/lib/ai';
import { embed } from '@/lib/ai/embeddings';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { rerankByRelevance } from '@/lib/rerank';
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

/**
 * A similarity threshold belongs to the model that produced the similarity.
 *
 * OpenAI's embeddings put unrelated text near 0.2, so 0.72 draws a clean line.
 * A small local multilingual model puts unrelated text near 0.83 — the same
 * 0.72 admits the entire corpus, every tier fires on everything, and the
 * refusal that keeps the assistant from explaining the wrong chapter never
 * happens. The failure is silent: retrieval still returns its top hit and the
 * answer still reads fluently.
 *
 * So the numbers are per provider, measured with `npm run calibrate` against
 * the corpus itself rather than carried over. A provider with no entry here has
 * not been calibrated.
 */
const THRESHOLDS: Record<string, { exact: number; concept: number; lead: number }> = {
  /*
   * text-embedding-3-small, measured with `npm run check:refusal` against this
   * corpus:
   *
   *   fifteen real questions      0.528 … 0.744
   *   fourteen off-syllabus ones  0.170 … 0.356
   *
   * 0.45 sits in the middle of a gap 0.17 wide, so a question has to be well
   * inside the syllabus to be answered and well outside it to be refused, and
   * neither decision turns on a thousandth.
   *
   * The 0.72 this started life with was a reasonable guess and wrong for this
   * corpus: it refused thirteen of the fifteen real questions, including
   * "Qu'est-ce qu'une suite géométrique ?". A student would have been told
   * their own syllabus was not covered.
   */
  openai: { exact: 0.85, concept: 0.45, lead: 0 },
  // Untested — voyage has never been run against this corpus. Calibrate before
  // trusting these.
  voyage: { exact: 0.85, concept: 0.72, lead: 0 },
  /*
   * multilingual-e5-base, measured with `npm run check:refusal` — which asks
   * the questions a student would type, against the whole corpus:
   *
   *   fifteen real questions      0.834 … 0.891
   *   fourteen off-syllabus ones  0.763 … 0.832
   *
   * 0.833 puts all twenty-nine on the right side, and that is the whole of the
   * margin: two thousandths. Treat it as a number that works today rather than
   * a number with room in it. A hosted model separates the same two populations
   * by tens of points; this is what the free route costs, and it is a real cost
   * even though it is not a monetary one.
   *
   * `lead` is 0 deliberately. It looked promising against sentences lifted out
   * of the corpus, but on questions students actually ask it is noise — real
   * ones fall to 0.012 while off-syllabus ones reach 0.029 — and requiring it
   * refused "Qu'est-ce qu'une suite géométrique ?", which is bookwork.
   */
  local: { exact: 0.87, concept: 0.833, lead: 0 },
};

const tier = THRESHOLDS[env().EMBEDDING_PROVIDER] ?? THRESHOLDS.openai!;

export const EXACT_MATCH_THRESHOLD = tier.exact;
export const CONCEPT_LEVEL_THRESHOLD = tier.concept;
export const PERSONAL_REFERENCE_THRESHOLD = tier.concept;

/** Minimum distance between the best hit and the field. 0 disables the check. */
export const RELEVANCE_LEAD = tier.lead;

/** How many hits to score when measuring that distance. */
const FIELD = 20;

/**
 * How many passages the tutor is given to answer from.
 *
 * Measured against questions students would actually ask — how often the
 * passage that answers the question is among the first k:
 *
 *          k=1    k=5    k=6    k=8   k=10   k=20
 *   ar     29%    80%    85%    91%    91%   100%
 *   en     51%    88%    88%    90%    90%    96%
 *   fr     54%    91%    91%    96%    96%    99%
 *
 * Eight rather than six because that is where the curve stops paying: it lifts
 * Arabic from 85% to 91% and French from 91% to 96%, and ten buys nothing on
 * top. Two extra passages is roughly 3,000 more characters in the prompt.
 *
 * The same table is the reason not to replace the embedding model over Arabic's
 * poor top-1. The right passage is retrieved every time — it is in the top
 * twenty for 100% of Arabic probes — it is merely ordered third rather than
 * first. Handing over more passages fixes the part of that which matters for
 * free; reranking, applied to Arabic only, then fixes the ordering itself. See
 * the rerank call below for what each buys.
 */
const HANDED_OVER = 8;

/**
 * How far the best hit stands above the rest of the field.
 *
 * An absolute similarity says how the model feels about one pair of texts. This
 * says whether the corpus contains an answer at all: when it does, one passage
 * pulls away from the others; when it does not, the top hit sits level with the
 * twentieth because everything is equally irrelevant.
 *
 * It matters because a weak embedding model scores unrelated text high — asking
 * this corpus for a tabbouleh recipe returns a chemistry passage at 0.81, above
 * any threshold that still admits real questions. That query has no lead, and
 * that is what rejects it.
 *
 * Too few hits to judge counts as no lead, so a subject with almost no material
 * refuses rather than answers. Thin material is a reason to say nothing.
 */
function relevanceLead(sortedScores: number[]): number {
  if (sortedScores.length < 4) return 0;
  const median = sortedScores[Math.floor(sortedScores.length / 2)]!;
  return (sortedScores[0] ?? 0) - median;
}

/**
 * How much of two texts is literally the same words.
 *
 * Tier 1 answers using another question's official solution, so "close enough"
 * has to mean the same question, not the same kind of question. Embeddings
 * cannot make that distinction on this corpus: every Lebanese maths paper opens
 * "Dans le tableau suivant, une seule des réponses proposées est correcte", and
 * two different years' differential-equation exercises score 0.994 against each
 * other while sharing 38% of their words. Grounding one on the other's answer
 * key produces a confident, fully-cited, wrong solution.
 *
 * Word overlap separates them where the vectors cannot — genuine duplicates of
 * the same paper come out near 1.0, same-topic-different-numbers around 0.6.
 * Symmetric on purpose: a short paraphrase of a long exercise scores low and
 * falls through to tier 2, which answers from course material instead. That is
 * the safer place for it to land.
 */
export const EXACT_MATCH_AGREEMENT = 0.8;

export function lexicalAgreement(a: string, b: string): number {
  const words = (text: string) =>
    new Set(
      text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[^\p{Letter}\p{Number}\s]+/gu, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 3),
    );
  const left = words(a);
  const right = words(b);
  if (left.size === 0 || right.size === 0) return 0;

  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / (left.size + right.size - shared);
}

/**
 * Text that explains something, and text that asks you to do something.
 *
 * A textbook chapter is mostly exercises. "Démontrez que (v_n) est une suite
 * géométrique" and "Une suite géométrique est définie par..." are equally
 * *about* geometric sequences, and an embedding scores them almost the same —
 * so a student asking what one is gets handed six problems and no definition.
 * That is what the tutor is then obliged to answer from, and it correctly
 * replies that the material does not define the term.
 *
 * These patterns are only ever used to re-order passages that have already
 * passed the tier gate. They never let anything in or keep anything out, so a
 * false match costs a slightly worse passage, never a wrong decision.
 */
const EXPLAINS = new RegExp(
  [
    'on appelle', 'est appel[ée]', 'se d[ée]finit', 'd[ée]finition', 'on dit que',
    'is called', 'is defined', 'we call', 'definition', 'refers to', 'is a ',
    'يسمى', 'تعريف', 'يعرف', 'هو ',
    'th[ée]or[èe]me', 'theorem', 'propri[ée]t[ée]', 'property', 'نظرية', 'خاصية',
  ].join('|'),
  'i',
);

const ASKS = new RegExp(
  [
    'd[ée]montrez', 'calculez', 'montrez que', 'd[ée]duisez', 'justifiez', 'v[ée]rifiez',
    'exercice', 'probl[èe]mes?', '\\bexercises?\\b',
    'prove that', 'calculate', 'show that', 'deduce', 'determine the', 'find the value',
    'أثبت', 'احسب', 'بيّن', 'تمرين', 'مسألة',
  ].join('|'),
  'i',
);

/** Questions that want something explained rather than something done. */
const DEFINITIONAL = new RegExp(
  ['what is', 'what are', "qu'est-ce", 'quest ce', 'define', 'd[ée]finir', 'explain',
   'expliquez', 'ما هو', 'ما هي', 'عرّف', 'اشرح'].join('|'),
  'i',
);

/**
 * Re-orders passages that already cleared the gate, so the ones that explain
 * come before the ones that drill. The adjustment is small on purpose: a much
 * better match on similarity should still win.
 */
function preferExplanations<T extends { similarity: number; contentText: string; kind?: string | null }>(
  hits: T[],
  query: string,
): T[] {
  if (!DEFINITIONAL.test(query)) return hits;

  const scored = hits.map((hit) => {
    const head = hit.contentText.slice(0, 600);
    let adjustment = 0;
    if (hit.kind === 'definition' || hit.kind === 'theorem') adjustment += 0.03;
    if (EXPLAINS.test(head)) adjustment += 0.02;
    if (ASKS.test(head)) adjustment -= 0.03;
    return { hit, rank: hit.similarity + adjustment };
  });

  return scored.sort((a, b) => b.rank - a.rank).map((s) => s.hit);
}

const ARABIC_CHARS = /[؀-ۿ]/g;

/**
 * A second version of the question, in the other script the student's own
 * subjects are written in.
 *
 * The Lebanese Bac is taught across scripts inside a single track: an LH
 * student does philosophy, geography and civics in Arabic and French language
 * in French. Retrieval embeds one question and searches all of it at once,
 * which assumes the embedding model matches meaning across scripts. This one
 * does not do that well enough: asked "Qu'est-ce que la conscience en
 * philosophie ?", it ranks a French literature passage at 0.528 and the Arabic
 * philosophy chapter that actually answers it at 0.399 — so the student is
 * answered confidently from the wrong subject, which is the exact failure the
 * tiers exist to prevent.
 *
 * Translating the question and searching with both is a small, cheap fix: one
 * short call on the verify model, and only when the student's subjects
 * genuinely span both scripts. When they do not, nothing extra runs.
 *
 * The alternative was a multilingual embedding model — the local one scored
 * 0.911 between a French and an Arabic sentence saying the same thing — but it
 * could not separate an off-syllabus question from a real one, which matters
 * more.
 */
async function otherScriptQuery(query: string, subjectIds: string[]): Promise<string | null> {
  const arabicChars = query.match(ARABIC_CHARS)?.length ?? 0;
  const askedInArabic = arabicChars > query.replace(/\s/g, '').length * 0.3;

  const languages = await db.subject.findMany({
    where: { id: { in: subjectIds } },
    select: { language: true },
    distinct: ['language'],
  });
  const hasArabic = languages.some((s) => s.language === 'ar');
  const hasLatin = languages.some((s) => s.language !== 'ar');

  // Nothing to reach for: the corpus this student can see is all one script.
  if (askedInArabic ? !hasLatin : !hasArabic) return null;

  const target = askedInArabic ? 'French' : 'Arabic';
  try {
    const response = await ai().complete({
      system: 'You translate exam questions. Reply with the translation only, no commentary.',
      messages: [{ role: 'user', content: `Translate into ${target}:\n${query}` }],
      maxTokens: 300,
      effort: 'low',
      model: env().OPENAI_MODEL_VERIFY,
    });
    const text = response.text.trim();
    return text && text !== query ? text : null;
  } catch {
    // A translation failure must not take the answer down with it — the
    // original query has already been searched.
    return null;
  }
}

/** Merges a second result set in, keeping each passage's best score. */
function mergeHits<T extends { id: string; similarity: number }>(primary: T[], extra: T[]): T[] {
  const best = new Map<string, T>();
  for (const hit of [...primary, ...extra]) {
    const seen = best.get(hit.id);
    if (!seen || hit.similarity > seen.similarity) best.set(hit.id, hit);
  }
  return [...best.values()].sort((a, b) => b.similarity - a.similarity);
}

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
  const questionHits = await searchQuestions(queryVector, input.subjectIds, FIELD, input.query);
  const topQuestion = questionHits[0];
  const questionLead = relevanceLead(questionHits.map((q) => q.similarity));

  const questionAgreement = topQuestion ? lexicalAgreement(input.query, topQuestion.contentText) : 0;

  if (
    topQuestion &&
    topQuestion.similarity >= EXACT_MATCH_THRESHOLD &&
    questionLead >= RELEVANCE_LEAD &&
    questionAgreement >= EXACT_MATCH_AGREEMENT
  ) {
    return {
      tier: 'exact_match',
      topSimilarity: topQuestion.similarity,
      requiresVerification: false,
      sources: [questionSource(topQuestion)],
      context: formatQuestionContext(topQuestion.contentText, topQuestion.officialSolution),
    };
  }

  // --- Tier 2: chapter-level course material ------------------------------
  // Fetched wide to measure the lead, then narrowed to HANDED_OVER.
  let chunkHits = await searchContentChunks(queryVector, input.subjectIds, FIELD, input.query);

  // Material in the other script only surfaces if it is searched for in that
  // script. Attempted when nothing convincing has been found yet, so a question
  // that is already well answered costs no extra call.
  if ((chunkHits[0]?.similarity ?? 0) < CONCEPT_LEVEL_THRESHOLD + 0.15) {
    const translated = await otherScriptQuery(input.query, input.subjectIds);
    if (translated) {
      const alternate = await searchContentChunks(
        await embed(translated, 'query'),
        input.subjectIds,
        FIELD,
        translated,
      );
      chunkHits = mergeHits(chunkHits, alternate);
    }
  }

  const chunkLead = relevanceLead(chunkHits.map((c) => c.similarity));
  // Gate on the raw similarity, then re-order what passed. The decision to
  // speak and the choice of what to speak from are kept separate: re-ranking
  // must never talk the pipeline into answering something it would refuse.
  let passingChunks =
    chunkLead >= RELEVANCE_LEAD
      ? preferExplanations(
          chunkHits.filter((c) => c.similarity >= CONCEPT_LEVEL_THRESHOLD),
          input.query,
        )
      : [];

  /*
   * Arabic questions get their passages reordered by a model; the others do not.
   *
   * Measured on cached student-style questions, at the eight passages actually
   * handed over:
   *
   *              top-1            covers the answer
   *   ar     28% -> 48%              91% -> 93%
   *   en     48% -> 46%              89% -> 91%
   *   fr     52% -> 39%              97% -> 97%
   *
   * Arabic is where the embedding orders badly and where reranking nearly
   * doubles the chance the right passage comes first. French is already well
   * ordered and reranking makes it worse without changing what is covered, so
   * paying a model call to damage it would be perverse.
   *
   * Applied after the gate, never before: it reorders what already cleared the
   * threshold and can neither admit material nor change a similarity score.
   * Costs one call on the cheap model, so it is spent only where it pays.
   */
  if (passingChunks.length > 1 && (input.query.match(ARABIC_CHARS)?.length ?? 0) > 3) {
    passingChunks = await rerankByRelevance(input.query, passingChunks, HANDED_OVER);
  }
  passingChunks = passingChunks.slice(0, HANDED_OVER);

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
