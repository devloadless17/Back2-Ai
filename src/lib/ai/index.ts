import 'server-only';

import { env } from '@/lib/env';

import { anthropicProvider } from './anthropic';
import { openaiProvider } from './openai';
import { recordUsage } from './budget';
import { currentMeter } from './meter-context';
import type { AiProvider, AiRequest } from './types';

/**
 * Single entry point for every AI call in the application.
 *
 * `AI_PROVIDER` picks the implementation at runtime, so the same deployment can
 * be pointed at Claude or GPT for comparison without a rebuild.
 */
/**
 * The provider, wrapped so every completion is metered.
 *
 * The meter lives here rather than at the call sites because there are a dozen
 * of them and one that forgets leaves a hole nothing reveals until the invoice.
 * Recording never throws and never blocks the response: the student has already
 * been answered and the provider has already charged us, so a failed write is
 * logged, not raised.
 */
function metered(provider: AiProvider): AiProvider {
  const record = (
    request: AiRequest,
    response: {
      modelUsed: string;
      inputTokens: number | null;
      cachedInputTokens: number | null;
      outputTokens: number | null;
    },
  ) => {
    // The request may name its own meter; otherwise the ambient one the API
    // route opened. Neither means work outside a request — still recorded, but
    // charged to no student.
    const meter = request.meter ?? currentMeter();
    void recordUsage({
      userId: meter?.userId ?? null,
      kind: meter?.kind ?? 'offline',
      model: response.modelUsed,
      inputTokens: response.inputTokens,
      cachedInputTokens: response.cachedInputTokens,
      outputTokens: response.outputTokens,
    });
  };

  return {
    ...provider,
    isConfigured: () => provider.isConfigured(),
    complete: async (request) => {
      const response = await provider.complete(request);
      record(request, response);
      return response;
    },
    completeJson: async (request) => {
      const response = await provider.completeJson(request);
      record(request, response);
      return response;
    },
    streamText: async function* (request) {
      const response = yield* provider.streamText(request);
      record(request, response);
      return response;
    },
  } as AiProvider;
}

export function ai(): AiProvider {
  return metered(env().AI_PROVIDER === 'openai' ? openaiProvider : anthropicProvider);
}

export * from './types';
export { embed, embedMany, EMBEDDING_DIM } from './embeddings';
export { budgetState, budgetMicrosFor, costMicros, priceOf, recordUsage } from './budget';
