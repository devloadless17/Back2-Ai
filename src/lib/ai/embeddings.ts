import 'server-only';

import OpenAI from 'openai';

import { env } from '@/lib/env';

import { AiError, AiNotConfiguredError } from './types';

/**
 * Embeddings for the retrieval pipeline.
 *
 * The vector width is a single source of truth: EMBEDDING_DIM must equal the
 * `vector(N)` width of every embedding column. Changing provider or model means
 * running `npm run vector:resize`, which alters the columns and re-embeds the
 * corpus — it is not a config-only change, and this module fails loudly rather
 * than writing a mis-sized vector that would silently break similarity search.
 */

export function EMBEDDING_DIM(): number {
  return env().EMBEDDING_DIM;
}

/**
 * Retrieval quality improves measurably when the query and the corpus are
 * embedded with different task hints, where the provider supports it.
 */
export type EmbeddingKind = 'document' | 'query';

/**
 * The local provider runs a small multilingual model on the CPU through ONNX,
 * with no API key and no per-token cost. It exists because this corpus is
 * embedded once and rarely re-embedded, and paying nothing is worth a slower
 * ingestion run that happens overnight.
 *
 * Two things differ from the hosted providers and both matter:
 *
 *   The scores live in a narrower band. A hosted model puts unrelated text near
 *   0.2; this one puts it near 0.8, so the retrieval thresholds are not
 *   transferable and must be re-derived per model — see RETRIEVAL_THRESHOLDS.
 *
 *   The model is downloaded on first use (a few hundred MB, cached under the
 *   user's home directory) and loaded into memory once per process.
 */
type Extractor = (
  texts: string[],
  options: { pooling: 'mean'; normalize: boolean },
) => Promise<{ tolist(): number[][] }>;

let localExtractor: Promise<Extractor> | null = null;

function getLocal(): Promise<Extractor> {
  if (!localExtractor) {
    localExtractor = import('@huggingface/transformers').then(
      ({ pipeline }) => pipeline('feature-extraction', env().EMBEDDING_MODEL) as unknown as Promise<Extractor>,
    );
  }
  return localExtractor;
}

async function embedWithLocal(inputs: string[], kind: EmbeddingKind): Promise<number[][]> {
  const model = env().EMBEDDING_MODEL;
  // The E5 family is trained with these prefixes and loses accuracy without
  // them; other models treat them as noise, so they are applied by name.
  const prefixed = /e5/i.test(model)
    ? inputs.map((t) => (kind === 'query' ? `query: ${t}` : `passage: ${t}`))
    : inputs;

  const output = await (await getLocal())(prefixed, { pooling: 'mean', normalize: true });
  return output.tolist();
}

let openaiClient: OpenAI | null = null;

function getOpenAI(): OpenAI {
  const key = env().OPENAI_API_KEY;
  if (!key) throw new AiNotConfiguredError('openai (embeddings)');
  if (!openaiClient) openaiClient = new OpenAI({ apiKey: key, maxRetries: 3 });
  return openaiClient;
}

async function embedWithOpenAI(inputs: string[]): Promise<number[][]> {
  const e = env();
  const response = await getOpenAI().embeddings.create({
    model: e.EMBEDDING_MODEL,
    input: inputs,
    dimensions: e.EMBEDDING_DIM,
  });

  // The API does not guarantee input order in every version; sort by index.
  return [...response.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

async function embedWithVoyage(inputs: string[], kind: EmbeddingKind): Promise<number[][]> {
  const e = env();
  if (!e.VOYAGE_API_KEY) throw new AiNotConfiguredError('voyage (embeddings)');

  const response = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${e.VOYAGE_API_KEY}`,
    },
    body: JSON.stringify({
      model: e.EMBEDDING_MODEL,
      input: inputs,
      input_type: kind,
      output_dimension: e.EMBEDDING_DIM,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new AiError(
      `Voyage embeddings failed (${response.status}). ${detail.slice(0, 200)}`,
      undefined,
      response.status >= 500,
    );
  }

  const payload = (await response.json()) as { data: { index: number; embedding: number[] }[] };
  return [...payload.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

function assertDimensions(vectors: number[][]): void {
  const expected = env().EMBEDDING_DIM;
  for (const vector of vectors) {
    if (vector.length !== expected) {
      throw new AiError(
        `Embedding provider returned ${vector.length} dimensions but the database expects ${expected}. ` +
          `Run "npm run vector:resize" after changing EMBEDDING_MODEL or EMBEDDING_DIM.`,
      );
    }
  }
}

const ARABIC_ANYWHERE = /[؀-ۿﭐ-﷿ﹰ-﻿]/;

/**
 * The form Arabic is embedded and searched in — never the form it is shown in.
 *
 * Written Arabic spells the same word several ways. A textbook prints تَعْريف
 * with diacritics and a student types تعريف without them; إسلام, أسلام and
 * اسلام are one word with three alefs; a PDF reader emits presentation-form
 * glyphs that look identical on screen and share no code point with the letters
 * a keyboard produces. None of that is visible, and all of it moves the vector.
 *
 * Measured on this corpus before the fold: Arabic subjects retrieved their own
 * passage in the top five 62% of the time against 81% for French and 82% for
 * English — a third of the corpus quietly worse than the rest.
 *
 * `scripts/corpus/normalise.py` has done exactly this since the beginning and
 * writes the result to corpus/text/<book>/search/. Nothing read it: the chunker
 * takes the display copy, so the folded text was built and thrown away. Folding
 * here instead of there is deliberate — it is the single point every document
 * and every query passes through, so the two cannot drift apart.
 *
 * A no-op on text with no Arabic in it.
 */
export function foldArabic(text: string): string {
  if (!ARABIC_ANYWHERE.test(text)) return text;
  return text
    .normalize('NFKC')
    .replace(/ـ/g, '') // tatweel, the stretching dash
    .replace(/[ً-ْٰ]/g, '') // short vowels and sukun
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[أإآٱ]/g, 'ا') // أ إ آ ٱ -> ا
    .replace(/ى/g, 'ي') // ى -> ي
    .replace(/ة/g, 'ه') // ة -> ه
    .replace(/[ \t]{2,}/g, ' ');
}

/**
 * Trims a text to something the provider will accept.
 *
 * The limit is in tokens, not characters, and the two are not proportional
 * across scripts: a Latin character is roughly a quarter of a token, while
 * Arabic runs closer to two. Cutting at a fixed 8,000 characters is therefore
 * safe for French and far over the line for Arabic — an Arabic exam question
 * of 8,000 characters is about 16,000 tokens, and the provider rejects the
 * whole batch, not just that one input. Which is exactly how the first run of
 * this failed: one paper stopped the entire corpus from embedding.
 *
 * Two tokens per non-Latin character is a deliberate over-estimate. Being
 * pessimistic costs a few words off the end of the longest questions; being
 * optimistic costs the run.
 */
const TOKEN_BUDGET = 7000;

/**
 * A ceiling that holds regardless of script. Nothing tokenises worse than one
 * token per character, so 6,000 characters cannot exceed 6,000 tokens even in
 * the worst case — dense LaTeX, Arabic with diacritics, or a table of symbols.
 * The weighted estimate below cuts most texts earlier; this is the backstop for
 * the ones it underestimates.
 */
const MAX_CHARS = 6000;

function trimToBudget(text: string): string {
  let tokens = 0;
  let cut = Math.min(text.length, MAX_CHARS);
  for (let i = 0; i < cut; i += 1) {
    tokens += text.charCodeAt(i) < 128 ? 0.5 : 3;
    if (tokens > TOKEN_BUDGET) {
      cut = i;
      break;
    }
  }
  return text.slice(0, cut);
}

/**
 * Embeds a batch. Inputs are truncated defensively — an over-long chunk is a
 * bug in the chunker, but it should not take down an ingestion run.
 */
export async function embedMany(texts: string[], kind: EmbeddingKind = 'document'): Promise<number[][]> {
  if (texts.length === 0) return [];

  // Folded here, so a document and a query are always folded the same way.
  const cleaned = texts
    .map((t) => trimToBudget(foldArabic(t).replace(/\s+/g, ' ').trim()))
    .filter((t) => t.length > 0);
  if (cleaned.length !== texts.length) {
    throw new AiError('Cannot embed an empty string. Filter empty chunks before calling embedMany.');
  }

  const provider = env().EMBEDDING_PROVIDER;
  const vectors =
    provider === 'local'
      ? await embedWithLocal(cleaned, kind)
      : provider === 'voyage'
        ? await embedWithVoyage(cleaned, kind)
        : await embedWithOpenAI(cleaned);

  assertDimensions(vectors);
  return vectors;
}

export async function embed(text: string, kind: EmbeddingKind = 'query'): Promise<number[]> {
  const [vector] = await embedMany([text], kind);
  if (!vector) throw new AiError('Embedding provider returned no vector.');
  return vector;
}
