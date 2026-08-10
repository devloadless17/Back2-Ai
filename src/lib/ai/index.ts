import 'server-only';

import { env } from '@/lib/env';

import { anthropicProvider } from './anthropic';
import { openaiProvider } from './openai';
import type { AiProvider } from './types';

/**
 * Single entry point for every AI call in the application.
 *
 * `AI_PROVIDER` picks the implementation at runtime, so the same deployment can
 * be pointed at Claude or GPT for comparison without a rebuild.
 */
export function ai(): AiProvider {
  return env().AI_PROVIDER === 'openai' ? openaiProvider : anthropicProvider;
}

/** Explicit handle on a provider, for side-by-side evaluation runs. */
export function aiNamed(name: 'anthropic' | 'openai'): AiProvider {
  return name === 'openai' ? openaiProvider : anthropicProvider;
}

export * from './types';
export { embed, embedMany, EMBEDDING_DIM } from './embeddings';
