import 'server-only';

import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

import { env } from '@/lib/env';

import {
  AiError,
  AiNotConfiguredError,
  type AiImage,
  type AiJsonRequest,
  type AiJsonResponse,
  type AiProvider,
  type AiRequest,
  type AiResponse,
} from './types';

/**
 * OpenAI implementation, behaviourally matched to `anthropic.ts` so the same
 * prompts and the same call sites can be evaluated against either provider.
 *
 * Differences that are handled here rather than leaking to callers:
 *   * `max_completion_tokens` is the current parameter name; `max_tokens` is
 *     rejected by reasoning models.
 *   * `reasoning_effort` only exists on reasoning models, so it is sent
 *     conditionally (see `supportsReasoningEffort`).
 *   * A safety decline surfaces as `message.refusal`, not a stop reason.
 */

const DEFAULT_MAX_TOKENS = 16_000;
const STREAM_MAX_TOKENS = 64_000;

let client: OpenAI | null = null;

function getClient(): OpenAI {
  const key = env().OPENAI_API_KEY;
  if (!key) throw new AiNotConfiguredError('openai');
  if (!client) client = new OpenAI({ apiKey: key, maxRetries: 3 });
  return client;
}

/**
 * Heuristic: only the reasoning families accept `reasoning_effort`, and sending
 * it to a non-reasoning model is a 400. Widen this predicate when adding a
 * model family rather than removing the guard.
 */
function supportsReasoningEffort(model: string): boolean {
  return /^(o\d|gpt-5)/.test(model);
}

function dataUrl(image: AiImage): string {
  return `data:${image.mediaType};base64,${image.base64}`;
}

function buildMessages(request: AiRequest): ChatCompletionMessageParam[] {
  const messages: ChatCompletionMessageParam[] = [];

  if (request.system) {
    messages.push({ role: 'system', content: request.system });
  }

  for (const m of request.messages) {
    messages.push({ role: m.role, content: m.content });
  }

  if (request.images?.length) {
    const firstUserIndex = messages.findIndex((m) => m.role === 'user');
    const target = firstUserIndex === -1 ? messages.length : firstUserIndex;
    const existing = messages[target];
    const text = existing && typeof existing.content === 'string' ? existing.content : '';

    messages[target] = {
      role: 'user',
      content: [
        ...request.images.map((image) => ({
          type: 'image_url' as const,
          image_url: { url: dataUrl(image), detail: 'high' as const },
        })),
        { type: 'text' as const, text },
      ],
    };
  }

  return messages;
}

/**
 * An exhausted balance is not a rate limit, however it arrives.
 *
 * OpenAI returns "You have no credits remaining" as HTTP 429 with
 * `type: insufficient_quota`, which `RateLimitError` catches and this used to
 * mark retryable. Nothing about that is retryable: the SDK's own three attempts
 * run, then every caller's backoff runs on top, and the answer is the same at
 * the end as it was at the start. A corpus job spends an hour discovering it; a
 * student watches a spinner for a minute to be told the tutor is unavailable,
 * when it was knowable on the first response.
 *
 * Checked on the body's `type`/`code` rather than the message text, which is
 * prose the provider is free to reword.
 */
function isQuotaExhausted(err: InstanceType<typeof OpenAI.APIError>): boolean {
  const body = err.error as { type?: string; code?: string } | undefined;
  return body?.type === 'insufficient_quota' || body?.code === 'credit_balance_exhausted';
}

/**
 * How much of the prompt OpenAI served from its cache.
 *
 * OpenAI caches automatically — there is no flag to set and nothing to ask for.
 * Any prompt over 1024 tokens whose prefix it has seen recently is discounted,
 * which on this product is every turn after the first in a chat session: the
 * system prompt and the conversation so far are a stable prefix that only ever
 * grows, and the retrieved material and the new question come after it.
 *
 * `prompt_tokens` ALREADY INCLUDES these, so the cached count is a subset and
 * `costMicros` subtracts it to find what was charged at full rate. Returning
 * the sum instead would double-count the whole prompt.
 */
export function cachedTokensOf(usage: { prompt_tokens_details?: { cached_tokens?: number } | null } | null | undefined): number | null {
  if (!usage) return null;
  return usage.prompt_tokens_details?.cached_tokens ?? 0;
}

function wrapError(err: unknown): never {
  if (err instanceof AiError) throw err;
  if (err instanceof OpenAI.RateLimitError) {
    if (isQuotaExhausted(err)) {
      throw new AiError(
        'The AI account has no credits remaining. This will not resolve by retrying — top up the balance.',
        err,
        false,
      );
    }
    throw new AiError('The AI service is rate limited. Please try again shortly.', err, true);
  }
  if (err instanceof OpenAI.APIConnectionError) {
    throw new AiError('Could not reach the AI service.', err, true);
  }
  if (err instanceof OpenAI.APIError) {
    const retryable = err.status !== undefined && err.status >= 500;
    throw new AiError(`AI service error (${err.status ?? 'unknown'}).`, err, retryable);
  }
  throw new AiError('Unexpected AI failure.', err);
}

export const openaiProvider: AiProvider = {
  name: 'openai',

  get defaultModel() {
    return env().OPENAI_MODEL;
  },

  get verifyModel() {
    return env().OPENAI_MODEL_VERIFY;
  },

  get fastModel() {
    return env().OPENAI_MODEL_FAST;
  },

  isConfigured() {
    return env().OPENAI_API_KEY.length > 0;
  },

  async complete(request: AiRequest): Promise<AiResponse> {
    const model = request.model ?? env().OPENAI_MODEL;

    try {
      const response = await getClient().chat.completions.create({
        model,
        messages: buildMessages(request),
        max_completion_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
        ...(supportsReasoningEffort(model) ? { reasoning_effort: request.effort ?? 'high' } : {}),
      });

      const choice = response.choices[0];
      if (choice?.message.refusal) {
        return {
          text: '',
          modelUsed: response.model,
          inputTokens: response.usage?.prompt_tokens ?? null,
          cachedInputTokens: cachedTokensOf(response.usage),
          outputTokens: response.usage?.completion_tokens ?? null,
          refused: true,
        };
      }

      return {
        text: (choice?.message.content ?? '').trim(),
        modelUsed: response.model,
        inputTokens: response.usage?.prompt_tokens ?? null,
        cachedInputTokens: cachedTokensOf(response.usage),
        outputTokens: response.usage?.completion_tokens ?? null,
        refused: choice?.finish_reason === 'content_filter',
      };
    } catch (err) {
      wrapError(err);
    }
  },

  async completeJson<T>(request: AiJsonRequest<T>): Promise<AiJsonResponse<T>> {
    const model = request.model ?? env().OPENAI_MODEL;

    try {
      const response = await getClient().chat.completions.create({
        model,
        messages: buildMessages(request),
        max_completion_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
        ...(supportsReasoningEffort(model) ? { reasoning_effort: request.effort ?? 'high' } : {}),
        response_format: {
          type: 'json_schema',
          json_schema: { name: request.schemaName, schema: request.schema, strict: true },
        },
      });

      const choice = response.choices[0];
      if (choice?.message.refusal) {
        throw new AiError('The AI provider declined this request.');
      }
      if (choice?.finish_reason === 'length') {
        throw new AiError('The AI response was cut off before it was complete.', undefined, true);
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(choice?.message.content ?? '');
      } catch {
        throw new AiError('The AI returned malformed JSON.');
      }

      return {
        data: request.parse(parsed),
        modelUsed: response.model,
        inputTokens: response.usage?.prompt_tokens ?? null,
        cachedInputTokens: cachedTokensOf(response.usage),
        outputTokens: response.usage?.completion_tokens ?? null,
      };
    } catch (err) {
      wrapError(err);
    }
  },

  async *streamText(request: AiRequest): AsyncGenerator<string, AiResponse, undefined> {
    const model = request.model ?? env().OPENAI_MODEL;

    try {
      const stream = await getClient().chat.completions.create({
        model,
        messages: buildMessages(request),
        max_completion_tokens: request.maxTokens ?? STREAM_MAX_TOKENS,
        ...(supportsReasoningEffort(model) ? { reasoning_effort: request.effort ?? 'high' } : {}),
        stream: true,
        stream_options: { include_usage: true },
      });

      let text = '';
      let inputTokens: number | null = null;
      let cachedInputTokens: number | null = null;
      let outputTokens: number | null = null;
      let refused = false;
      let modelUsed = model;

      for await (const chunk of stream) {
        modelUsed = chunk.model || modelUsed;

        if (chunk.usage) {
          inputTokens = chunk.usage.prompt_tokens;
          cachedInputTokens = cachedTokensOf(chunk.usage);
          outputTokens = chunk.usage.completion_tokens;
        }

        const choice = chunk.choices[0];
        if (choice?.finish_reason === 'content_filter') refused = true;

        const delta = choice?.delta.content;
        if (delta) {
          text += delta;
          yield delta;
        }
      }

      return { text: text.trim(), modelUsed, inputTokens, cachedInputTokens, outputTokens, refused };
    } catch (err) {
      wrapError(err);
    }
  },
};
