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

/**
 * Embeds a batch. Inputs are truncated defensively — an over-long chunk is a
 * bug in the chunker, but it should not take down an ingestion run.
 */
export async function embedMany(texts: string[], kind: EmbeddingKind = 'document'): Promise<number[][]> {
  if (texts.length === 0) return [];

  const cleaned = texts.map((t) => t.replace(/\s+/g, ' ').trim().slice(0, 8000)).filter((t) => t.length > 0);
  if (cleaned.length !== texts.length) {
    throw new AiError('Cannot embed an empty string. Filter empty chunks before calling embedMany.');
  }

  const vectors =
    env().EMBEDDING_PROVIDER === 'voyage'
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
