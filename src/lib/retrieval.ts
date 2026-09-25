import 'server-only';

import type { GroundingTier } from '@prisma/client';

import { ai } from '@/lib/ai';
import { embed, foldArabic } from '@/lib/ai/embeddings';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import {
  classifyQuestionKind,
  type QuestionClassification,
  type QuestionKind,
} from '@/lib/question-kind';
import {
  searchContentChunks,
  searchMarkingSchemes,
  searchQuestions,
  searchUserReferences,
  type ContentChunkHit,
  type MarkingSchemeHit,
  type QuestionHit,
  type UserReferenceHit,
} from '@/lib/vector';
import { selectVisualsFor } from '@/lib/visual-evidence';

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
const THRESHOLDS: Record<string, { exact: number; concept: number; lead: number; structure: number }> = {
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
  openai: { exact: 0.85, concept: 0.45, lead: 0, structure: 0.35 },
  // Untested — voyage has never been run against this corpus. Calibrate before
  // trusting these. `structure` sits at the concept threshold, which relaxes
  // nothing: an uncalibrated provider gets the strict gate.
  voyage: { exact: 0.85, concept: 0.72, lead: 0, structure: 0.72 },
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
  local: { exact: 0.87, concept: 0.833, lead: 0, structure: 0.833 },
};

const tier = THRESHOLDS[env().EMBEDDING_PROVIDER] ?? THRESHOLDS.openai!;

export const EXACT_MATCH_THRESHOLD = tier.exact;
export const CONCEPT_LEVEL_THRESHOLD = tier.concept;

/**
 * The concept gate, per script.
 *
 * `npm run check:refusal` asks the questions a student would actually type and
 * measures where the two populations sit. They do not sit in the same place:
 *
 *   Latin script   off-syllabus 0.139 … 0.484   on-syllabus 0.528 … 0.744
 *   Arabic script  off-syllabus 0.202 … 0.563   on-syllabus 0.452 … 0.686
 *
 * In Latin script there is a clean gap and 0.45 sits below it, which is why the
 * assistant answers "Quelle est la meilleure série sur Netflix ?" as though it
 * were bookwork. 0.50 lands inside the gap and refuses both of the Latin-script
 * failures without touching a real question.
 *
 * In Arabic the two populations overlap by 0.111, so no threshold separates
 * them and raising it only trades wrong answers for wrong refusals. Arabic keeps
 * the lower gate deliberately: an Arabic-medium student asking a real syllabus
 * question is the common case, and refusing them is the worse error. The fix
 * there is a better multilingual embedding or moving the reranker ahead of the
 * gate, not a number.
 *
 * Only calibrated for `openai`. Other providers keep their single measured
 * value, because a threshold belongs to the model that produced the similarity.
 */
const ARABIC_SCRIPT = /[؀-ۿ]/g;
const LATIN_CONCEPT_THRESHOLD = 0.5;

export function conceptThresholdFor(query: string): number {
  if (env().EMBEDDING_PROVIDER !== 'openai') return tier.concept;
  const arabic = query.match(ARABIC_SCRIPT)?.length ?? 0;
  return arabic > 3 ? tier.concept : LATIN_CONCEPT_THRESHOLD;
}

/**
 * The gate this question is actually judged on.
 *
 * The script default above is a fallback, not the answer. Where real student
 * questions score varies enormously by SUBJECT — the tenth percentile runs from
 * 0.286 in LH Mathematics to 0.716 in GS Physique — so one number per script
 * refuses real questions in one subject while doing nothing in another.
 * `subjects.concept_gate` holds a value measured per subject by
 * `scripts/calibrate-subject-gates.ts`, which moves a gate only where the
 * questions a subject must answer separate cleanly from the questions it must
 * refuse.
 *
 * ONLY WHEN EXACTLY ONE SUBJECT IS IN SCOPE. A per-subject number means nothing
 * applied to a search across fifteen subjects: the hits come from several of
 * them and there is no single right gate. This is why the subject picker
 * matters beyond the UI — it is what makes a per-subject gate applicable at all.
 * With a wider scope the script default stands, which is exactly the behaviour
 * that existed before.
 *
 * A subject with no calibrated value keeps the script default too. Null there is
 * not missing data: it is the honest state for a subject whose two populations
 * overlap, where no threshold separates them and tuning one would trade wrong
 * refusals for confident wrong answers. GS جغرافيا is that case — its real
 * questions score BELOW the off-syllabus ones, which is an embedding problem
 * that no number here can repair.
 */
async function gateForScope(query: string, subjectIds: string[]): Promise<number> {
  const fallback = conceptThresholdFor(query);
  if (subjectIds.length !== 1) return fallback;

  const rows = await db.$queryRaw<{ concept_gate: number | null }[]>`
    SELECT concept_gate FROM subjects WHERE id = ${subjectIds[0]}::uuid`;
  const gate = rows[0]?.concept_gate;
  return typeof gate === 'number' ? gate : fallback;
}
export const PERSONAL_REFERENCE_THRESHOLD = tier.concept;

/**
 * Below this, look for the material in the corpus's other script as well.
 *
 * This was `CONCEPT_LEVEL_THRESHOLD + 0.15`, and the margin outlived its
 * reason. It was chosen when the concept threshold was 0.72, putting the gate
 * at 0.87 — above the exact-match threshold, so it fired only when nothing very
 * good had come back. The provider changed, concept was recalibrated to 0.45,
 * and the margin was carried over untouched: the gate became 0.60 and started
 * firing on half of all questions, each one a model call and about 1.4 seconds.
 *
 * Measured rather than guessed — `npm run measure:translation-gate`, 249 real
 * questions searched against their own subject's passages:
 *
 *     p10 0.428   p25 0.490   median 0.597   p75 0.704   p90 0.779
 *
 *     gate 0.60 (today)  fires 50.6%
 *     gate 0.55          fires 41.0%
 *     gate 0.50          fires 29.3%
 *     gate 0.45          fires 14.9%
 *
 * The median sits at 0.597, so the old gate was placed, by accident, exactly at
 * the middle of the distribution — which is why it fired on half of everything.
 *
 * 0.50 is a fifth of the way up from the concept threshold. Everything below
 * 0.45 would be REFUSED without help, so translation must be tried there and
 * is; the extra 0.05 covers questions that only just clear the line. Above it
 * the question is already grounded, and translating stands to change which
 * passages are used rather than whether there is an answer at all.
 *
 * The asymmetry is deliberate and points the other way from the saving: firing
 * needlessly costs 1.4 seconds, while failing to fire on a question whose
 * material exists only in the other script costs the answer entirely — and that
 * is indistinguishable, from outside, from a gap in the corpus. Hence a margin
 * above the refusal line rather than on it.
 */
export const TRANSLATE_BELOW = tier.concept + 0.05;

/**
 * Below this, a concept question is worth asking the model what it is ABOUT.
 *
 * A Lebanese exercise is titled by its scenario and a chapter is named by its
 * concept, so the two meet only where their vocabulary overlaps. "Un cas de
 * thyroïdite. Sarah présente un gonflement au cou" retrieves `Evolution
 * humaine` at 0.396 — under the gate, so the student is told their own syllabus
 * does not cover it. Named as concepts — "régulation hormonale, thyroïde,
 * rétrocontrôle" — the same corpus answers at 0.628.
 *
 * SET AT THE GATE, NOT ABOVE IT, and the measurement is why. Expanding every
 * query is a clear loss: over 180 sampled questions the median top score fell
 * 0.052 and 75% scored WORSE, because a Lebanese exercise is long and already
 * contains the words its chapter uses — replacing two thousand characters of
 * physics with eight keywords throws away the signal. Used as a replacement it
 * pushed 13 questions under the gate to rescue 2.
 *
 * So it fires only where the alternative is refusing outright, and it MERGES
 * rather than replaces: every raw hit stays in the pool with its own score, so
 * a question that already worked cannot be made worse by this path.
 *
 * Concept questions only. Comprehension answers from the paper's own passage
 * and essays from the barème; both have their own lane, and neither produced a
 * single rescue in the sample. Expect this to help around ten questions of the
 * sixty-eight concept questions currently under the gate — small, safe, and
 * cheap, since 92% of queries never reach it.
 */
export const CONCEPT_EXPAND_BELOW = tier.concept;

/**
 * How far the expansion's best hit must stand above its own median before its
 * results are allowed into the pool.
 *
 * Not the provider's `lead`, which is 0 on openai and therefore no guard at
 * all. Measured against the two cases that have been read end to end:
 *
 *     thyroïdite   0.486 / 0.476 / 0.466   lead 0.02   wrong chapter, must be refused
 *     géographie   0.546 → a different, more specific chapter than the raw top
 *
 * 0.05 sits above the flat field and below a genuine pull-away. It is a floor
 * chosen from two observations, which is thin: widen it the moment
 * `judge:passages` can say whether an expanded answer was useful.
 */
export const EXPANSION_LEAD = 0.05;

/**
 * How near a marking scheme has to be before its structure is worth showing.
 *
 * Lower than the concept threshold, and for a reason that is easy to get
 * backwards. The concept threshold answers "does the corpus contain the answer
 * to this question?" — a barème is not the answer to anything, it is the shape
 * an answer has to take, and two philosophy prompts share that shape whether or
 * not they share a topic. Measured on this corpus with text-embedding-3-small:
 *
 *   an essay prompt against a marking scheme in its own subject   0.38 … 0.44
 *   an off-syllabus question against anything in the corpus       0.17 … 0.36
 *
 * So the same 0.45 that correctly refuses to answer a question the books do not
 * cover also throws away every barème the corpus holds, which is how the first
 * cut of the essay path came to retrieve schemes and then hand over none of
 * them. 0.35 admits the first population and not the second.
 *
 * A scheme admitted this way is only ever handed over ALONGSIDE material that
 * cleared the real gate. It cannot make the pipeline speak — see the essay
 * branch in `retrieveGrounding` for the one narrow case where a scheme carries
 * an answer on its own, and what that case additionally requires.
 */
export const STRUCTURE_THRESHOLD = tier.structure;

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
 * Twelve rather than eight, re-measured 2026-09-04, because "ten buys nothing on
 * top" was read off an average that hid where the gain is. Aggregated by
 * language the step from 8 to 12 looks worthless — en 93->95, fr 90->91,
 * ar 86->89 — but that average is dominated by subjects already at 100%, and it
 * conceals this:
 *
 *   SE فلسفة عامة     52% -> 72%
 *   GS Chemistry      80% -> 92%
 *   LH فلسفة عامة     28% -> 40%
 *   LH Life Sciences  80% -> 88%
 *   LS فلسفة عامة     88% -> 96%
 *   SE English        92% -> 100%
 *
 * measured as "was the passage material of the question's own chapter among the
 * ones handed over". These are the subjects whose chapters overlap — GS
 * Chemistry examines one reaction chain the book splits across three chapters,
 * and a philosophy chapter shares its vocabulary with every other one — so the
 * nearest passages crowd into a neighbour and the chapter that was actually
 * asked about sits ninth.
 *
 * The price is real and larger than the old note claimed: 12,500 characters of
 * retrieved context becomes 18,500, a 48% increase, on every query in every
 * subject. It is charged everywhere and collected in six places. It is worth it
 * because the places it is collected are the weak ones — a subject at 52% is
 * where a student is actually being failed, and a subject at 100% cannot be
 * improved by any of this.
 *
 * Do not tune this from the by-language table again. It cannot see the subjects
 * that need help.
 *
 * `check:refusal` moved 3/60 wrong to 2/60 across this change, which is one
 * decision on an LLM-scored check and is not evidence of anything. The table
 * above is, being vector arithmetic and reproducible. `check:retrieval` is
 * unchanged, correctly — it measures the ORDER passages come back in, and this
 * changes how many are kept, not how they rank.
 *
 * The same table is the reason not to replace the embedding model over Arabic's
 * poor top-1. The right passage is retrieved every time — it is in the top
 * twenty for 100% of Arabic probes — it is merely ordered third rather than
 * first. Handing over more passages fixes the part of that which matters for
 * free; reranking, applied to Arabic only, then fixes the ordering itself. See
 * the rerank call below for what each buys.
 */
const HANDED_OVER = 12;

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
      model: ai().fastModel,
    });
    const text = response.text.trim();
    return text && text !== query ? text : null;
  } catch {
    // A translation failure must not take the answer down with it — the
    // original query has already been searched.
    return null;
  }
}

/**
 * The syllabus topics a question tests, named as a chapter would name them.
 *
 * Deliberately asked for KEYWORDS rather than a rewritten question: the point
 * is to reach the vocabulary the textbook uses, and a paraphrase of the
 * scenario keeps the scenario's words. Told not to echo proper nouns for the
 * same reason — "Windex" and "Sarah" are exactly what is not in the book.
 *
 * Same language as the question, because the cross-script reach is
 * `otherScriptQuery`'s job and doing it here would confound the two.
 */
async function conceptQuery(query: string): Promise<string | null> {
  try {
    const response = await ai().complete({
      system: [
        'You are given a question from a Lebanese Baccalaureate exam.',
        'Name the syllabus topics it tests — the concepts a textbook chapter would be titled with.',
        'Reply with 5 to 10 comma-separated keywords, in the SAME language as the question.',
        'No commentary, no restating the scenario, and do not repeat proper nouns from the question.',
      ].join('\n'),
      messages: [{ role: 'user', content: query.slice(0, 4000) }],
      maxTokens: 2000,
      effort: 'low',
      model: ai().fastModel,
    });
    const text = response.text.trim();
    return text.length > 3 && text !== query ? text : null;
  } catch {
    // As with translation: the original query has already been searched, so a
    // failure here costs the expansion and nothing else.
    return null;
  }
}

/**
 * Below this, not even a coverage judgement is worth a model call.
 *
 * The floor is not a second gate in disguise. `الحصار البحري` — two words, the
 * exact term the history book uses — scores 0.202 against the passage that
 * defines it, and off-syllabus questions run 0.202 to 0.563, so similarity
 * genuinely cannot separate them and no number here could. What it separates is
 * a question with *something* retrieved from one with nothing: below 0.12 the
 * search returned text that shares no vocabulary at all, and there is nothing
 * for a reader to judge.
 */
const COVERAGE_FLOOR = 0.12;

/** How many passages the judge sees, and how much of each. */
const COVERAGE_CANDIDATES = 4;
const COVERAGE_SNIPPET = 700;

/**
 * The passages worth putting in front of the reader.
 *
 * TAKING THE TOP FOUR BY SCORE DOES NOT WORK ACROSS A TRACK. Scoped to تاريخ,
 * `الحصار البحري` gets four candidates of which two contain the term and the
 * reader finds its sentence. Scoped to all fifteen LH subjects the same passage
 * is still ranked FIRST — the term index sees to that — but its three
 * neighbours become `الإيقاع`, `الاستعارة` and `التلوث البيئي`, which score
 * higher on cosine while having nothing to do with the question. One relevant
 * passage among three irrelevant ones reads as "no", and the question was
 * refused on a whole-track scope while succeeding on a narrow one. Showing it
 * eight candidates instead of four did not help: it adds more noise too.
 *
 * So candidates are chosen by whether they share the question's vocabulary,
 * which is the thing the noise does not do. Falling back to rank order when
 * nothing shares a word keeps the behaviour for queries with no usable content
 * words at all.
 *
 * Words of three or more letters only, folded, and the question's own stop
 * words are no loss: a passage matching only على or من is the noise this is
 * trying to exclude.
 */
function shareQueryVocabulary<T extends { contentText: string }>(
  query: string,
  hits: T[],
  limit: number,
): T[] {
  const words = new Set(
    foldArabic(query)
      .split(/[^\p{L}]+/u)
      .filter((w) => w.length >= 3),
  );
  if (words.size === 0) return hits.slice(0, limit);

  const scored = hits.map((hit) => {
    const text = foldArabic(hit.contentText);
    return { hit, shared: [...words].filter((w) => text.includes(w)).length };
  });
  const sharing = scored.filter((s) => s.shared > 0);
  if (sharing.length === 0) return hits.slice(0, limit);
  // Stable within a share count, so the retrieval order still breaks ties and
  // this only ever promotes a passage over one that shares strictly less.
  return sharing
    .map((s, i) => ({ ...s, i }))
    .sort((a, b) => b.shared - a.shared || a.i - b.i)
    .slice(0, limit)
    .map((s) => s.hit);
}

/**
 * Does this material actually answer the question?
 *
 * WHY THIS EXISTS. The gate is a cosine, and a cosine cannot read. Measured on
 * this corpus, the query `الحصار البحري` scores 0.096 against the whole chunk
 * that contains it and 0.245 against the single 91-character sentence that
 * contains it verbatim — both far under the 0.45 gate. Shrinking the chunk does
 * not rescue it, so no chunking strategy and no threshold can: the embedding
 * simply does not place a short Arabic phrase near a sentence containing it.
 *
 * Meanwhile the term is in five chunks, the term index finds them, and the
 * right passage is returned at RANK 1. The material is found and then discarded
 * by a number.
 *
 * NOT THE SAME THING AS RERANKING, which was measured and dropped (31/59 both
 * with and without, at fifteen times the price — see the note further down).
 * That measured ORDERING: which of the passages that already passed is best.
 * Ordering is not what is broken — the right passage is already first. This
 * asks the one question that was never asked, whether the corpus covers the
 * question at all, and `rerank.ts` says in its own docstring why a model is the
 * thing that can answer it: "whether a passage answers a question is a
 * judgement about the question, which is what a model can make and cosine
 * cannot."
 *
 * DELIBERATELY ASYMMETRIC. It may only ADMIT material the gate would have
 * refused; it can never reject material the gate passed, and it never reorders.
 * So a failure, a timeout or a malformed reply leaves the pipeline exactly as
 * it was, and the worst case is the refusal that would have happened anyway.
 *
 * The prompt asks for a quotation, not a yes. A model asked "does this cover
 * it?" says yes to anything on the same topic; a model that must point at the
 * sentence carrying the answer has to find one. An empty or unquotable reply
 * is a no.
 */
async function coveredByMaterial(
  query: string,
  candidates: Array<{ contentText: string; chapterName: string }>,
): Promise<boolean> {
  if (candidates.length === 0) return false;
  try {
    const material = candidates
      .map((c, i) => `[${i + 1}] ${c.chapterName}\n${c.contentText.slice(0, COVERAGE_SNIPPET)}`)
      .join('\n\n');
    const response = await ai().complete({
      system: [
        'You are checking whether a student\'s course material answers their question.',
        '',
        'Reply with the ONE sentence from the material that carries the answer, copied exactly,',
        'and nothing else. If several passages bear on it, quote the single most direct sentence.',
        '',
        'Reply with exactly NO if the material does not answer the question — including when it is',
        'merely about the same broad topic, mentions the words without explaining them, or would',
        'need knowledge that is not in the material. Being on the same subject is not an answer.',
      ].join('\n'),
      messages: [
        { role: 'user', content: `QUESTION\n${query.slice(0, 2000)}\n\nMATERIAL\n${material}` },
      ],
      maxTokens: 300,
      effort: 'low',
      model: ai().fastModel,
    });
    const reply = response.text.trim();
    if (!reply || /^no\b/i.test(reply)) return false;
    // The quotation has to be real. A model that paraphrases, or invents a
    // sentence, has not found one — and that is the failure this whole path
    // would otherwise introduce.
    // Whitespace is collapsed on BOTH sides before comparing. The passages keep
    // the line breaks of the page they came from, so a sentence that runs over
    // a line holds a "\r\n" the model does not reproduce — which rejected a
    // correct quotation of a real sentence and refused the question anyway.
    const flatten = (s: string) => foldArabic(s).replace(/\s+/g, ' ').trim();
    const haystack = flatten(candidates.map((c) => c.contentText).join(' '));
    const quoted = flatten(reply.replace(/^["'«»]+|["'«»]+$/g, ''));
    if (quoted.length < 12) return false;
    return haystack.includes(quoted.slice(0, 60));
  } catch {
    return false;
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
  /**
   * Storage keys for the figures printed with this source, in paper order.
   *
   * CARRIED ON THE SOURCE, NOT COLLECTED GLOBALLY. A grounded answer can be
   * built from several sources, and an image that arrives detached from the
   * question it belongs to is worse than no image: the model sees a circuit and
   * a titration curve with nothing saying which question either answers, and
   * confidently reads one against the other. The chat boundary loads these and
   * labels them with this source's own index — see `figureLabel`.
   *
   * Keys, not bytes. Retrieval runs on every message and most answers need no
   * image at all; loading them here would read files nobody asked for.
   */
  images?: string[];
  /**
   * Aligned with `images`: the panel group each image belongs to, if any.
   * A multi-panel document is loaded whole or withheld — see `loadSourceFigures`.
   */
  imageGroups?: Array<{ groupKey: string; size: number } | null>;
  /**
   * What the student is entitled to be told about where this came from.
   *
   * STRUCTURED, NOT A SENTENCE. The label above is one string assembled here,
   * which means the UI can only print it — it cannot rank an official paper
   * above a textbook page, cannot link a chapter to its practice, and cannot
   * translate any of it. Every field here is a fact read off the row, and every
   * one is optional because plenty of rows do not have it: a question with no
   * `source_exam_id` is textbook material and must never be labelled official.
   *
   * `similarity` above is deliberately NOT part of this. It is the one number
   * the student must never see — it is our retrieval architecture, not their
   * evidence, and "0.84" invites a judgement nobody outside this codebase can
   * make.
   */
  provenance?: {
    /** True only when the row is tied to a real exam cycle. */
    official: boolean;
    examYear?: number | null;
    examSession?: string | null;
    marks?: number | null;
    hasBareme?: boolean;
    hasSolution?: boolean;
    chapterName?: string | null;
    /** Both ids, so the UI can route to practice. Absent means no link. */
    chapterId?: string | null;
    subjectId?: string | null;
    /** For a textbook passage: definition, formula, theorem, method, example. */
    chunkKind?: string | null;
    fileName?: string | null;
  };
};

export type GroundingResult = {
  tier: GroundingTier;
  sources: RetrievalSource[];
  /** The material handed to the model as context. Empty when refused. */
  context: string;
  topSimilarity: number | null;
  /**
   * The gate refused this material and a reader admitted it: the passages are
   * real, cited course material, but their similarity is BELOW the threshold.
   *
   * Recorded because `topSimilarity` would otherwise be the only trace, and a
   * concept-level answer sitting at 0.20 reads like a bug rather than a
   * decision. Anything measuring the gate — `check:refusal` above all — needs
   * to be able to separate the two populations.
   */
  admittedByReader?: boolean;
  /**
   * True for concept-level and personal-reference answers, where the model
   * synthesizes rather than restates. Those answers get a verification pass
   * before they reach a student.
   */
  requiresVerification: boolean;
  /**
   * Which of the three kinds of question this was taken to be, and on what
   * marker. Orthogonal to the tier: the tier says how authoritative the
   * material is, this says what sort of thing was gone looking for. The answer
   * prompt reads it, because a marking scheme handed over without the
   * instruction to write against it is just more text.
   */
  classification: QuestionClassification;
  /**
   * The syllabus this question sits nearest to, when nothing could be grounded.
   *
   * Populated only on the refusal path, because that is the only path that has
   * to answer without material. It is NOT grounding and must never be handed
   * over as if it were — see `SyllabusScope`.
   */
  syllabus?: SyllabusScope | null;
};

/**
 * What the curriculum covers, without saying anything the model could cite.
 *
 * The general-knowledge lane exists because the corpus covers a fraction of the
 * syllabus, and it answers from the model's own knowledge. Its only curriculum
 * constraint today is the student's list of subject NAMES — "this student takes
 * Philosophy, History, Geography" — which is barely a constraint at all. A
 * Lebanese philosophy paper and a French one share a subject name and not a
 * syllabus, and nothing in that prompt can tell them apart.
 *
 * Every subject in this corpus has a chapter list, including the ones whose
 * passages are too thin to ground an answer: history 11 chapters, geography 14,
 * general philosophy 18. That list IS the syllabus, and it is available whether
 * or not any passage clears a threshold.
 *
 * WHY TITLES AND QUESTION STEMS, AND NOT PASSAGES.
 *
 * The obvious move is to hand over the passages that scored below the gate.
 * That is the one thing that must not happen. A sub-threshold passage handed to
 * a model that then quotes it has laundered material the pipeline REFUSED into
 * an answer that reads as sourced — the precise failure the thresholds exist to
 * prevent, arriving through the door marked "context".
 *
 * A chapter title is not a claim, and a past question is not an answer. Neither
 * can be quoted as a fact about the world, so neither can turn an ungrounded
 * answer into an apparently-grounded one. They bound the SCOPE without
 * supplying any content, which is exactly the job.
 */
export type SyllabusScope = {
  subject: string;
  /** The chapter list, in curriculum order — the syllabus outline. */
  chapters: string[];
  /**
   * Openings of the nearest past exam questions in that subject. They say what
   * this syllabus actually examines and at what depth, which a chapter title
   * alone does not.
   */
  examples: string[];
};

/** How many past questions are shown as examples of what the syllabus examines. */
const SCOPE_EXAMPLES = 4;

/** How much of each example question is shown. Enough to see what it asks, not to answer it. */
const EXAMPLE_SHOWN = 220;

/**
 * The syllabus nearest the question, for a question nothing could be grounded in.
 *
 * The subject is chosen by the best hit the search already produced rather than
 * by asking the model — the search failed to clear a THRESHOLD, which is not the
 * same as failing to indicate a subject, and its top hit is still the best
 * available evidence of which of the student's subjects this belongs to.
 *
 * Costs one query and no embedding: the vector is the one `retrieveGrounding`
 * has already computed, and chapters are read by id.
 */
async function syllabusScope(
  subjectId: string,
  queryVector: number[],
): Promise<SyllabusScope | null> {
  const subject = await db.subject.findUnique({
    where: { id: subjectId },
    select: {
      name: true,
      chapters: { select: { name: true }, orderBy: { orderIndex: 'asc' } },
    },
  });
  if (!subject || subject.chapters.length === 0) return null;

  const examples = await searchQuestions(queryVector, [subjectId], SCOPE_EXAMPLES);

  return {
    subject: subject.name,
    chapters: subject.chapters.map((c) => c.name),
    // `readable`, like everywhere else a question's text is shown or handed
    // over. These are question STEMS used to bound the scope of a refusal, and
    // a reversed one describes the syllabus no better than it answers it.
    examples: examples.map((q) => readable(q).replace(/\s+/g, ' ').trim().slice(0, EXAMPLE_SHOWN)),
  };
}

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
    /** The extract printed on the paper, for a question that examines one. */
    sourcePassage?: string | null;
  } | null;
  /**
   * What has already been said in this session, oldest first.
   *
   * Only read to recover a passage the student pasted on an earlier turn. A
   * Lebanese comprehension exercise is one text followed by numbered parts, and
   * the parts are short: "2. Relevez deux figures de style." arrives at thirty
   * characters, long after the text it is about. Without this the second part of
   * every exercise is refused for want of a passage sitting three messages up.
   */
  history?: { role: 'user' | 'assistant'; content: string }[];
};

/**
 * How many marking schemes an essay prompt is grounded on.
 *
 * Three rather than one because a Lebanese barème is a template, not an answer:
 * seeing the same four-part shape recovered from three different years is what
 * distinguishes the structure the examiner rewards from the particular argument
 * one paper happened to want.
 */
const MARKING_SCHEMES = 3;

/**
 * How much of an official solution is shown.
 *
 * Philosophy's official solutions are whole essays — the scheme prints the
 * introduction, the problematic, the discussion and the conclusion the examiner
 * expects, at length. The structure is in the first part of that and the rest is
 * one year's content, so it is cut: what the tutor should copy is the shape, and
 * handing over four thousand words of somebody else's argument invites it to
 * reproduce that argument instead of teaching the student to build their own.
 */
const SOLUTION_SHOWN = 1200;

/**
 * When a comprehension question arrives carrying its own passage.
 *
 * "Quel est le mot qui, par ses répétitions, souligne le thème ?" is eighty
 * characters and answerable only against a text printed on the exam paper. The
 * same question photographed off that paper, or pasted with the extract above
 * it, arrives as two thousand — and then the passage is right there in the
 * query and nothing needs fetching.
 *
 * That is the whole difference between refusing and answering, so it is drawn
 * generously: 400 characters is longer than any bare comprehension instruction
 * in this corpus and shorter than any question with a passage attached.
 */
const PASSAGE_SUPPLIED = 400;

/**
 * How far back a pasted passage stays in force.
 *
 * A Lebanese comprehension exercise rarely runs past six parts, and each part is
 * one exchange. Beyond that the student has almost certainly moved on to another
 * text, and carrying the old one forward would answer the new question against
 * the wrong passage — a worse failure than refusing, because it looks right.
 */
const PASSAGE_MEMORY_TURNS = 12;

/**
 * How short a message has to be before it is read as a follow-up.
 *
 * "وما هي نتائجها؟" is sixteen characters and means nothing on its own: the
 * ها is the topic of the message before it. Embedded by itself it lands nowhere
 * near the chapter that answers it, and the student is told their own follow-up
 * is off their programme.
 *
 * Drawn well below the shortest self-contained question this corpus asks. A
 * bare "ما هي الاستعارة؟" also falls inside it, and that is accepted rather than
 * worked around: the expansion below adds a search, it does not replace one, and
 * a self-contained question has already found its own material by then.
 */
const FOLLOW_UP_QUERY = 90;

/**
 * How far back the topic of a follow-up is looked for.
 *
 * Shorter than PASSAGE_MEMORY_TURNS on purpose. A pasted passage stays the
 * subject of a whole exercise; a topic is abandoned as soon as the student asks
 * about something else, and reaching further back for one would answer a new
 * question against an old chapter.
 */
const FOLLOW_UP_MEMORY_TURNS = 4;

/** How much of the earlier turn is worth embedding as context. */
const FOLLOW_UP_CONTEXT_CHARS = 300;

/**
 * This message joined to the turn it depends on, when it cannot stand alone.
 *
 * Null when the message is long enough to carry its own topic, and null when
 * nothing the student typed recently can supply one — an assistant turn is not
 * read, for the same reason `suppliedPassage` will not read one: grounding a
 * search on the tutor's own previous answer is how a wrong answer gets
 * confirmed by being looked up again.
 */
export function followUpQuery(input: RetrievalInput): string | null {
  const query = input.query.trim();
  if (query.length === 0 || query.length > FOLLOW_UP_QUERY) return null;

  const recent = (input.history ?? []).slice(-FOLLOW_UP_MEMORY_TURNS);
  for (let i = recent.length - 1; i >= 0; i -= 1) {
    const message = recent[i];
    if (message?.role !== 'user') continue;

    const prior = message.content.trim();
    if (prior.length === 0) continue;

    return `${prior.slice(0, FOLLOW_UP_CONTEXT_CHARS)}\n${query}`;
  }

  return null;
}

/**
 * The passage this question is about, from this message or an earlier one.
 *
 * Returns the query itself when it carries the text, so the caller can tell the
 * two cases apart and label the grounding for what it is.
 */
/**
 * A passage supplied on an earlier turn, when this message is too short to carry
 * one itself. Null when the message carries its own — that case needs no help.
 */
function carriedPassage(input: RetrievalInput): string | null {
  if (input.query.trim().length >= PASSAGE_SUPPLIED) return null;
  return suppliedPassage(input);
}

export function suppliedPassage(input: RetrievalInput): string | null {
  if (input.query.trim().length >= PASSAGE_SUPPLIED) return input.query;

  const recent = (input.history ?? []).slice(-PASSAGE_MEMORY_TURNS);
  for (let i = recent.length - 1; i >= 0; i -= 1) {
    const message = recent[i];
    /*
     * Only what the student typed.
     *
     * An assistant turn long enough to pass for a passage is the tutor's own
     * previous answer, and grounding a reply on that is how a wrong answer gets
     * confirmed by being repeated back to itself.
     */
    if (message?.role === 'user' && message.content.trim().length >= PASSAGE_SUPPLIED) {
      return message.content;
    }
  }

  return null;
}

/** The barème and the official answer's shape, as material to write against. */
function formatMarkingSchemes(hits: MarkingSchemeHit[]): string {
  const blocks = hits.map((hit) => {
    const parts = [`## How this is marked — ${hit.chapterName}`];
    parts.push(`Prompt of the marked question: ${readable(hit).replace(/\s+/g, ' ').slice(0, 400)}`);

    const bareme = Array.isArray(hit.bareme) ? hit.bareme : [];
    if (bareme.length > 0) {
      parts.push(
        ['Barème — the marks are awarded step by step:', ...bareme.map(
          (item) => `- ${String(item.criterion).replace(/\s+/g, ' ').slice(0, 200)} (${item.points} mark(s))`,
        )].join('\n'),
      );
    }

    if (hit.officialSolution) {
      parts.push(
        `Shape of the official answer:\n${hit.officialSolution.replace(/\s+/g, ' ').slice(0, SOLUTION_SHOWN)}`,
      );
    }

    return parts.join('\n');
  });

  return blocks.join('\n\n');
}

function schemeSource(hit: MarkingSchemeHit): RetrievalSource {
  return {
    id: hit.id,
    kind: 'question',
    label: `${hit.chapterName} — official marking scheme`,
    similarity: hit.similarity,
    text: readable(hit).slice(0, 500),
  };
}

/** A scheme is only worth handing over if it says something about structure. */
function usableScheme(hit: MarkingSchemeHit): boolean {
  const bareme = Array.isArray(hit.bareme) ? hit.bareme : [];
  return bareme.length > 0 || (hit.officialSolution?.trim().length ?? 0) > 80;
}

export async function retrieveGrounding(input: RetrievalInput): Promise<GroundingResult> {
  /*
   * What kind of question this is, decided before anything is searched for.
   *
   * The three kinds want three different things, and the cost of not asking is
   * paid silently: a comprehension question sent down the chapter path comes
   * back with the nearest chapter, which is not where its answer is and never
   * was. See `question-kind.ts` for what separates them.
   */
  const classification = classifyQuestionKind(input.query);

  /*
   * The classifier reads the message. This reads the session.
   *
   * "2. Relevez deux figures de style." carries no marker — no "dans le texte",
   * no "ci-dessus" — so on its own words it is indistinguishable from a concept
   * question, and `classifyQuestionKind` is right to call it one. It then goes
   * down the chapter path and comes back with eight biographies of Voltaire,
   * which is the precise failure the comprehension routing exists to prevent.
   *
   * A passage the student pasted a few messages ago settles it. An exercise is
   * one text followed by numbered parts, and the parts arrive short and bare.
   * Session state knows what thirty characters cannot.
   *
   * The cost is a concept question asked in the middle of working through a text
   * — "au fait, c'est quoi une métaphore ?" — which is then grounded on the
   * passage rather than on a chapter. That answer is verified against the
   * passage before it is shown, so the failure is the tutor saying it cannot
   * answer from this material. A refusal is recoverable. Eight paragraphs about
   * Voltaire, delivered confidently, are not.
   */
  const carried = carriedPassage(input);
  const kind: QuestionKind = carried ? 'comprehension' : classification.kind;

  /*
   * The concept gate for this query's script. Computed once, here, so every
   * tier below is judged against the same number — a pipeline that gated one
   * tier at 0.50 and the next at 0.45 would refuse and admit the same question
   * depending only on which tier happened to fire.
   */
  const conceptGate = await gateForScope(input.query, input.subjectIds);

  if (input.anchorQuestion) {
    const anchor = input.anchorQuestion;
    return {
      tier: 'exact_match',
      topSimilarity: 1,
      requiresVerification: false,
      classification,
      sources: [
        {
          id: anchor.id,
          kind: 'question',
          label: 'The question being worked on',
          similarity: 1,
          text: readable(anchor),
        },
      ],
      context: formatQuestionContext(
        readable(anchor),
        anchor.officialSolution,
        anchor.sourcePassage ?? null,
      ),
    };
  }

  if (input.subjectIds.length === 0) {
    // A student with no track has no curriculum to be grounded in. Refusing is
    // the only correct outcome; guessing would be answering from nowhere.
    return {
      tier: 'ungrounded_refused',
      topSimilarity: null,
      requiresVerification: false,
      classification,
      sources: [],
      context: '',
    };
  }

  const queryVector = await embed(input.query, 'query');

  // --- Tier 1: near-exact match against a real question -------------------
  const questionHits = await searchQuestions(queryVector, input.subjectIds, FIELD, input.query);
  const topQuestion = questionHits[0];
  const questionLead = relevanceLead(questionHits.map((q) => q.similarity));

  const questionAgreement = topQuestion ? lexicalAgreement(input.query, readable(topQuestion)) : 0;

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
      classification,
      sources: [await questionSourceWithVisuals(topQuestion)],
      context: formatQuestionContext(
        readable(topQuestion),
        topQuestion.officialSolution,
        topQuestion.sourcePassage,
      ),
    };
  }

  /*
   * --- Comprehension: the passage, or nothing -----------------------------
   *
   * The answer to "délimitez les passages où le locuteur rapporte des paroles
   * au style direct" is in a text printed on the exam paper. It is in no
   * chapter, so there is no chapter to fall back to — and falling back is
   * precisely what must not happen here. Chapter retrieval would still return
   * eight passages, the tutor would still write eight fluent paragraphs, and
   * nothing anywhere would record that the question was answered from material
   * that could not contain the answer. GS Français scores 0.04 lift on the
   * chapter benchmark, at chance, almost entirely on these.
   *
   * There are two honest outcomes. Either the passage came with the question —
   * photographed, pasted, or attached to a question the student is working on,
   * which the anchor branch above has already handled — in which case it is
   * right here and can be answered from. Or it did not, and the only useful
   * thing to say is "show me the text".
   */
  if (kind === 'comprehension') {
    /*
     * The passage, whether it came with this message or an earlier one.
     *
     * An exercise is one text followed by numbered parts, and only the first
     * message carries the text. "2. Relevez deux figures de style." is thirty
     * characters; judged alone it looks exactly like a question asked about
     * nothing, and every part after the first was refused on that basis while
     * the passage sat unread three messages up. The student had supplied it.
     * Nothing had to go and find it.
     */
    const supplied = suppliedPassage(input);

    if (supplied) {
      return {
        tier: 'personal_reference',
        topSimilarity: null,
        requiresVerification: true,
        classification,
        sources: [
          {
            id: 'supplied-passage',
            kind: 'user_reference',
            label: 'The passage on your exam paper',
            similarity: 1,
            text: supplied.slice(0, 500),
          },
        ],
        context:
          supplied === input.query
            ? `## The passage and question you supplied\n${input.query}`
            : `## The passage you supplied\n${supplied}\n\n## What you are asking about it\n${input.query}`,
      };
    }

    return {
      tier: 'ungrounded_refused',
      topSimilarity: topQuestion?.similarity ?? null,
      requiresVerification: false,
      classification,
      sources: [],
      context: '',
    };
  }

  /*
   * --- Essay prompts: the marking scheme ----------------------------------
   *
   * Fetched before the chapter search rather than after it, because for an
   * essay it is the more important half of the grounding and it must be
   * available whether or not chapter material clears the gate. "اشرح هذا
   * القول" has no fact in a chapter waiting to be retrieved; what a Lebanese
   * marker rewards is an introduction, a stated problematic, a discussion and
   * a conclusion, and the barème says so.
   */
  const schemes =
    kind === 'essay'
      ? (await searchMarkingSchemes(queryVector, input.subjectIds, MARKING_SCHEMES))
          .filter((s) => s.similarity >= STRUCTURE_THRESHOLD)
          .filter(usableScheme)
      : [];

  /*
   * When a scheme is allowed to be the whole of the grounding.
   *
   * Almost never, and the two extra conditions are both load-bearing. It has to
   * clear the full concept threshold, so a scheme can never let through a
   * question the pipeline would otherwise refuse — the essay path must not
   * become a way round the gate. And it has to carry an official solution
   * rather than only a barème, because a barème alone is a shape with nothing
   * in it: an answer written from four criteria and no material would have an
   * introduction, a problematic, a discussion and a conclusion, and nothing to
   * say in any of them.
   */
  const standaloneSchemes = schemes.filter(
    (s) => s.similarity >= conceptGate && (s.officialSolution?.trim().length ?? 0) > 80,
  );

  // --- Tier 2: chapter-level course material ------------------------------
  // Fetched wide to measure the lead, then narrowed to HANDED_OVER.
  let chunkHits = await searchContentChunks(queryVector, input.subjectIds, FIELD, input.query);

  /*
   * A follow-up searched together with the turn it depends on.
   *
   * The model already gets the history, so it understands what "وما هي
   * نتائجها؟" refers to. Retrieval did not: the embedding is built from this
   * message alone, so the second half of a conversation was searched for with
   * the half of the question the student had not repeated. The tutor understood
   * the question and was handed the wrong chapter to answer it from, which reads
   * to the student as the tutor forgetting what they just said.
   *
   * ADDS A SEARCH, NEVER REPLACES ONE. `input.query` still decides what kind of
   * question this is, what the gate is, and whether tier 1 fired — joining two
   * turns into one string would let an old topic change the classification of a
   * new question. Only the chapter vector search is widened, and only when this
   * message found nothing convincing by itself, so a self-contained question
   * that happens to be short costs nothing extra.
   *
   * Comprehension never reaches here: a question about a passage is answered
   * or refused above, and that is the better outcome for it anyway — a short
   * part of an exercise wants the passage from three turns up, which
   * `carriedPassage` already fetches, not the wording of the previous part.
   *
   * NOT MEASURED against the corpus. What stands behind it is the mechanism —
   * a bare pronoun cannot embed to a chapter it does not name — and the
   * merge guard below, which is the same one the concept expansion is held to.
   */
  if ((chunkHits[0]?.similarity ?? 0) < CONCEPT_EXPAND_BELOW) {
    const withContext = followUpQuery(input);
    if (withContext) {
      const byContext = await searchContentChunks(
        await embed(withContext, 'query'),
        input.subjectIds,
        FIELD,
        withContext,
      );

      // The expansion has to look like an answer on its own before it is
      // merged. See the concept expansion below for why the lead is judged on
      // the expansion's own hits rather than after the merge.
      const contextTop = byContext[0]?.similarity ?? 0;
      if (contextTop >= conceptGate && relevanceLead(byContext.map((c) => c.similarity)) >= EXPANSION_LEAD) {
        chunkHits = mergeHits(chunkHits, byContext);
      }
    }
  }

  // Material in the other script only surfaces if it is searched for in that
  // script. Attempted when nothing convincing has been found yet, so a question
  // that is already well answered costs no extra call.
  /*
   * Passages found by searching in Arabic, whatever script the student typed in.
   *
   * Collected because the concept gate is calibrated per SCRIPT — 0.50 for
   * Latin, where on- and off-syllabus questions separate cleanly, and 0.45 for
   * Arabic, where they overlap and a stricter bar refuses real questions. That
   * calibration is about the material being matched, and `conceptThresholdFor`
   * infers it from the script of the query, which is right until the two come
   * apart.
   *
   * They come apart on ARABIZI, and Lebanese students write arabizi constantly:
   *
   *   "shu ya3ne el isti3ara w kif bfar2a 3an el tashbih"   0.301 raw
   *   translated to "ما معنى الاستعارة وكيف أفرّق بينها وبين التشبيه؟"   0.491
   *   the same question typed in Arabic                      0.497 -> answered
   *
   * The translation is excellent and recovers almost all of the score. The
   * question is refused anyway: the query holds no Arabic character, so the
   * Latin gate of 0.50 is applied to an Arabic-to-Arabic similarity, and it
   * misses by nine thousandths. Every arabizi question in the trial was refused
   * this way.
   *
   * So the Arabic gate follows the SEARCH rather than the typing. Only these
   * hits get it: relaxing the gate for everything would hand the French side
   * 0.45, and measured French off-syllabus questions reach 0.484 — it would
   * start answering "quelle est la meilleure série sur Netflix" from the
   * syllabus, which is the failure the gate exists to prevent.
   */
  const foundInArabic = new Set<string>();

  if ((chunkHits[0]?.similarity ?? 0) < TRANSLATE_BELOW) {
    const translated = await otherScriptQuery(input.query, input.subjectIds);
    if (translated) {
      const alternate = await searchContentChunks(
        await embed(translated, 'query'),
        input.subjectIds,
        FIELD,
        translated,
      );
      if ((translated.match(ARABIC_CHARS)?.length ?? 0) > 3) {
        for (const hit of alternate) foundInArabic.add(hit.id);
      }
      chunkHits = mergeHits(chunkHits, alternate);
    }
  }

  /*
   * Still nothing that clears the gate. Before refusing, ask what the question
   * is ABOUT and search for that — the scenario-versus-concept mismatch this
   * corpus is full of. See CONCEPT_EXPAND_BELOW for why it is concept-only,
   * why it runs at the gate rather than above it, and why it merges.
   */
  if (kind === 'concept' && (chunkHits[0]?.similarity ?? 0) < CONCEPT_EXPAND_BELOW) {
    const concepts = await conceptQuery(input.query);
    if (concepts) {
      const byConcept = await searchContentChunks(
        await embed(concepts, 'query'),
        input.subjectIds,
        FIELD,
        concepts,
      );

      /*
       * THE EXPANSION HAS TO LOOK LIKE AN ANSWER ON ITS OWN.
       *
       * Merging on "the score went up" is what makes this path dangerous, and
       * it is not hypothetical: "Un cas de thyroïdite" has no thyroid chapter
       * in the LS syllabus, scored 0.396 against `Evolution humaine` and was
       * correctly refused. Expanded, the same wrong chapter came back at 0.486
       * and the merge carried it over the gate — a confident answer about
       * Sarah's thyroid grounded in human evolution, which is precisely the
       * outcome this pipeline is arranged to avoid.
       *
       * `relevanceLead` is the existing test for whether the corpus holds an
       * answer at all, and it is applied HERE, to the expansion's own hits,
       * rather than after the merge. After the merge it cannot work: two result
       * sets at different levels make a bimodal pool whose median sits between
       * them, so merging manufactures a lead out of the gap. The thyroid case
       * merges to 0.486/0.476/0.466/0.396/0.385 — a lead of 0.09 that neither
       * set had alone. Judged by itself the expansion spreads 0.02 across three
       * hits of the same wrong chapter, which is the flat field that means
       * nothing here is relevant.
       *
       * The provider's own `lead` is 0 on openai, so it cannot serve as this
       * guard; the constant below is local to this path and deliberately not
       * that one.
       */
      const conceptTop = byConcept[0]?.similarity ?? 0;
      const conceptLead = relevanceLead(byConcept.map((c) => c.similarity));
      if (conceptTop >= conceptGate && conceptLead >= EXPANSION_LEAD) {
        chunkHits = mergeHits(chunkHits, byConcept);
      }
    }
  }

  const chunkLead = relevanceLead(chunkHits.map((c) => c.similarity));
  // Gate on the raw similarity, then re-order what passed. The decision to
  // speak and the choice of what to speak from are kept separate: re-ranking
  // must never talk the pipeline into answering something it would refuse.
  // A passage found by searching in Arabic is judged on the Arabic gate, even
  // when the student typed in Latin letters. See `foundInArabic`.
  const gateFor = (hit: { id: string }) =>
    foundInArabic.has(hit.id) ? tier.concept : conceptGate;

  let passingChunks =
    chunkLead >= RELEVANCE_LEAD
      ? preferExplanations(
          chunkHits.filter((c) => c.similarity >= gateFor(c)),
          input.query,
        )
      : [];

  /*
   * Nothing cleared the gate — so ask a reader before refusing.
   *
   * This is the only path that can admit material the cosine refused, and it
   * runs only where the alternative is refusing outright. 92% of queries never
   * reach it, for the same reason the concept expansion above does not: they
   * have already been answered.
   *
   * `chunkLead` is deliberately not required here. It guards against a flat
   * field of equally-mediocre passages when the top score is respectable; below
   * the gate the whole field is low by definition, and requiring a lead would
   * refuse exactly the short precise queries this exists for — the ones where
   * several passages of one chapter all mention the term.
   */
  let admittedByReader = false;
  if (passingChunks.length === 0 && schemes.length === 0) {
    const candidates = shareQueryVocabulary(
      input.query,
      chunkHits.filter((c) => c.similarity >= COVERAGE_FLOOR),
      COVERAGE_CANDIDATES,
    );
    if (candidates.length > 0 && (await coveredByMaterial(input.query, candidates))) {
      passingChunks = preferExplanations(candidates, input.query);
      admittedByReader = true;
    }
  }

  /*
   * NOTHING IS RERANKED. The passages are handed over in the embedding's order.
   *
   * Arabic used to be reranked here, on this measurement:
   *
   *              top-1            covers the answer
   *   ar     28% -> 48%              91% -> 93%
   *   en     48% -> 46%              89% -> 91%
   *   fr     52% -> 39%              97% -> 97%
   *
   * Re-measured on 2026-09-14 against every Arabic probe in the set rather than
   * a sample — `npm run compare:rerank -- --lang ar --limit 0 --arms 0,1` — the
   * same configuration now does the OPPOSITE of what that table claims:
   *
   *   ar     53% -> 37%     (31/59 -> 22/59, no rerank -> as shipped)
   *
   * Sixteen points of top-1, on the full probe set, in the subject group this
   * product is weakest in. Whether the old figure was measured differently or
   * the corpus simply moved under it — six books restructured, 63 chapters
   * recovered, 1,687 question links added — the number in a comment stopped
   * describing the code, and the code was still charging a model call per
   * Arabic question to make Arabic worse.
   *
   * RERANKING IS NOT THE PROBLEM; THE READER WAS. Four arms over 40 probes:
   *
   *                                      ar       en       fr      all
   *   no rerank                      4/7 57%  9/18 50%  8/15 53%    53%
   *   gpt-5.4-mini @ low  (was live) 3/7 43% 11/18 61%  5/15 33%    48%
   *   gpt-5.5 @ low                  4/7 57% 12/18 67%  8/15 53%    60%
   *   gpt-5.5 @ medium               5/7 71% 12/18 67%  9/15 60%    65%
   *
   * The cheap model damages French in both measurements — 52->39 then 53->33 —
   * and the flagship restores it to exactly baseline. So "reranking hurts
   * French", which is why this was Arabic-only, was never true: the cheap model
   * hurts French.
   *
   * THE FLAGSHIP'S APPARENT GAIN WAS SEVEN PROBES OF NOISE. In that table it
   * reads 5/7 = 71% on Arabic, which is one probe away from 4/7. Run over all
   * 59 Arabic probes instead — `--lang ar --limit 0 --arms 0,3` — it lands
   * exactly on the baseline:
   *
   *   no rerank          31/59  53%
   *   gpt-5.5 @ medium   31/59  53%
   *
   * Not better, not worse, at roughly fifteen times the price per question. So
   * reranking is finished as an idea for this corpus: the cheap model is worse
   * than nothing and the expensive one is indistinguishable from it. The
   * embedding order is what measures best AND is free, which is the happy case.
   *
   * `rerank.ts` and the comparison script stay — they are how this was settled,
   * and how it would be re-opened if the embedding model ever changed.
   */
  passingChunks = passingChunks.slice(0, HANDED_OVER);

  if (passingChunks.length > 0 || standaloneSchemes.length > 0) {
    /*
     * The scheme sits inside `context`, not beside it.
     *
     * It is official material — a barème printed on a ministry paper — so an
     * answer resting on it is resting on something at least as authoritative as
     * a textbook passage, and the verification pass has to be able to see that.
     * Kept out of `context` it would count as unsupported, and every essay
     * answer that did what it was told would be retracted for it.
     */
    const material = [
      ...passingChunks.map(
        (c) => `## ${c.chapterName} — ${c.title ?? c.kind}\n${c.contentLatex ?? c.contentText}`,
      ),
      ...(schemes.length > 0 ? [formatMarkingSchemes(schemes)] : []),
    ];

    return {
      tier: 'concept_level',
      topSimilarity: passingChunks[0]?.similarity ?? schemes[0]?.similarity ?? null,
      admittedByReader,
      requiresVerification: true,
      classification,
      sources: [...passingChunks.map(chunkSource), ...schemes.map(schemeSource)],
      context: material.join('\n\n'),
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
      classification,
      sources: passingReferences.map(referenceSource),
      context: passingReferences
        .map((r) => `## From your document "${r.fileName ?? 'untitled'}"\n${(r.extractedText ?? '').slice(0, 4000)}`)
        .join('\n\n'),
    };
  }

  /*
   * --- Nothing cleared threshold anywhere ---------------------------------
   *
   * The syllabus is attached here and only here. Downstream this is either a
   * refusal, which ignores it, or the general-knowledge lane, which answers
   * from the model's own knowledge and until now had nothing to bound that by
   * except the student's list of subject names.
   *
   * The subject is taken from the best hit the search produced. Failing a
   * threshold is not the same as indicating nothing: a question about the
   * Lebanese civil war still lands nearest history even when no passage is
   * close enough to answer from, and that is the syllabus worth bounding by.
   */
  const nearest = chunkHits[0] ?? topQuestion;
  const nearestSubject =
    chunkHits[0] !== undefined
      ? (await db.chapter.findUnique({
          where: { id: chunkHits[0].chapterId },
          select: { subjectId: true },
        }))?.subjectId
      : topQuestion?.subjectId;

  const syllabus =
    nearest && nearestSubject ? await syllabusScope(nearestSubject, queryVector) : null;

  return {
    tier: 'ungrounded_refused',
    topSimilarity: topQuestion?.similarity ?? null,
    requiresVerification: false,
    classification,
    sources: [],
    context: '',
    syllabus,
  };
}

function formatQuestionContext(
  contentText: string,
  officialSolution: string | null,
  sourcePassage: string | null = null,
): string {
  const parts: string[] = [];
  /*
   * The passage goes first, because for a comprehension question it is not
   * background to the question — it is where the answer is. "Identifiez le
   * référent du pronom « on »" means nothing without the paragraph the pronoun
   * sits in, and a tutor given the question before the extract is reading them
   * in the order that makes the question unanswerable.
   */
  if (sourcePassage) parts.push(`## The text printed on the exam paper\n${sourcePassage}`);
  parts.push(`## Official question\n${contentText}`);
  if (officialSolution) parts.push(`## Official solution\n${officialSolution}`);
  return parts.join('\n\n');
}

/**
 * A question as it should be READ, which is not always how it was stored.
 *
 * Two transcriptions of every question exist. `content_text` comes from the
 * PDF's own text layer, and on a Lebanese paper — Arabic and Latin on one page —
 * that layer stores Latin mathematics in VISUAL order, right to left. It is not
 * subtle: `g(x) = 3x² + 9x + 1` is stored as `193 2++= xx)x(g`, and `lim g(x)`
 * as `)x(glim`. 135 questions are damaged this way, 19% of GS Mathematics.
 *
 * `content_latex` came from a structure-aware pass and is intact. Of those 135
 * questions, ZERO have damaged LaTeX and 97 have a clean version sitting in the
 * next column. The material was never lost; it was simply not the column being
 * read.
 *
 * `formatContext` already did this for content chunks — `c.contentLatex ??
 * c.contentText`. Questions did not, so the tutor was handed the scrambled
 * transcription of every past-exam question while reading textbook passages
 * correctly. It cannot answer a question it cannot read, and reversed algebra
 * is worse than missing algebra: it looks like text, embeds without complaint,
 * and produces a confident answer to something the student never asked.
 *
 * Not a repair — nothing is un-reversed here, which could not be done safely
 * anyway: the corruption is inconsistent within a single expression, so
 * reversing `)x(glim` recovers `g(x)` and turns `lim` into `mil`. This just
 * reads the column that was already right.
 */
function readable(hit: { contentText: string; contentLatex?: string | null }): string {
  const latex = hit.contentLatex?.trim();
  return latex && latex.length > 0 ? latex : hit.contentText;
}

/**
 * A question source whose figures come from the shared visual selector — the
 * same call the student's pages make, so the model and the student receive the
 * same ordered keys for the same exercise. Legacy `contentImages` is only used
 * through the selector's fallback rule, never read directly here.
 */
async function questionSourceWithVisuals(hit: QuestionHit): Promise<RetrievalSource> {
  const source = questionSource(hit);
  const selection = (
    await selectVisualsFor([{ id: hit.id, contentText: hit.contentText, contentImages: hit.contentImages ?? [] }])
  ).get(hit.id);
  if (selection) {
    source.images = selection.keys;
    source.imageGroups = selection.visuals.map((v) =>
      v.groupKey && v.groupSize ? { groupKey: v.groupKey, size: v.groupSize } : null,
    );
  }
  return source;
}

function questionSource(hit: QuestionHit): RetrievalSource {
  return {
    id: hit.id,
    kind: 'question',
    label: `${hit.chapterName} — past question`,
    similarity: hit.similarity,
    text: readable(hit),
    images: hit.contentImages ?? [],
    provenance: {
      // A year is what makes it an exam paper. Textbook questions have none,
      // and calling those "official" would be the one claim in this product
      // that a student could catch us getting wrong.
      official: hit.examYear !== null,
      examYear: hit.examYear,
      examSession: hit.examSession,
      marks: hit.marks === null ? null : Number(hit.marks),
      hasBareme: hit.hasBareme,
      hasSolution: Boolean(hit.officialSolution && hit.officialSolution.trim().length > 0),
      chapterName: hit.chapterName,
      chapterId: hit.chapterId,
      subjectId: hit.subjectId,
    },
  };
}

function chunkSource(hit: ContentChunkHit): RetrievalSource {
  return {
    id: hit.id,
    kind: 'content_chunk',
    label: `${hit.chapterName} — ${hit.title ?? hit.kind}`,
    similarity: hit.similarity,
    text: hit.contentText,
    provenance: {
      // Textbook material. Never official — that word belongs to the ministry's
      // own papers and schemes, and spending it here would make it meaningless
      // where it counts.
      official: false,
      chapterName: hit.chapterName,
      chapterId: hit.chapterId,
      subjectId: hit.subjectId,
      chunkKind: hit.kind,
    },
  };
}

function referenceSource(hit: UserReferenceHit): RetrievalSource {
  return {
    id: hit.id,
    kind: 'user_reference',
    label: hit.fileName ?? 'Your uploaded document',
    similarity: hit.similarity,
    text: (hit.extractedText ?? '').slice(0, 500),
    provenance: {
      // The student's own file. Not official and not ours — it has been checked
      // against nothing, which is exactly what the tier-3 notice says in words.
      official: false,
      fileName: hit.fileName,
    },
  };
}
