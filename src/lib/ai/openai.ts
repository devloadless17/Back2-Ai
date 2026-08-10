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

function wrapError(err: unknown): never {
  if (err instanceof AiError) throw err;
  if (err instanceof OpenAI.RateLimitError) {
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
          outputTokens: response.usage?.completion_tokens ?? null,
          refused: true,
        };
      }

      return {
        text: (choice?.message.content ?? '').trim(),
        modelUsed: response.model,
        inputTokens: response.usage?.prompt_tokens ?? null,
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
      let outputTokens: number | null = null;
      let refused = false;
      let modelUsed = model;

      for await (const chunk of stream) {
        modelUsed = chunk.model || modelUsed;

        if (chunk.usage) {
          inputTokens = chunk.usage.prompt_tokens;
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

      return { text: text.trim(), modelUsed, inputTokens, outputTokens, refused };
    } catch (err) {
      wrapError(err);
    }
  },
};
