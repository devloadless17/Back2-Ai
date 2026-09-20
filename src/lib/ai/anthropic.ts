import 'server-only';

import Anthropic from '@anthropic-ai/sdk';

import { env } from '@/lib/env';

import {
  AiError,
  AiNotConfiguredError,
  type AiEffort,
  type AiImage,
  type AiJsonRequest,
  type AiJsonResponse,
  type AiProvider,
  type AiRequest,
  type AiResponse,
} from './types';

/**
 * Claude implementation.
 *
 * Notes for anyone changing this file:
 *   * Adaptive thinking is set explicitly rather than left to the default,
 *     because ANTHROPIC_MODEL is configurable and older models treat an absent
 *     `thinking` field as "no thinking".
 *   * `temperature` / `top_p` are not sent — current Claude models reject them.
 *   * A safety decline arrives as HTTP 200 with `stop_reason: 'refusal'`, so
 *     `stop_reason` is checked before the content array is read.
 */

const DEFAULT_MAX_TOKENS = 16_000;
const STREAM_MAX_TOKENS = 64_000;

// Our three-level effort maps onto Claude's five. `high` is the floor for
// anything that marks or verifies student work.
const EFFORT_MAP: Record<AiEffort, 'low' | 'medium' | 'high'> = {
  low: 'low',
  medium: 'medium',
  high: 'high',
};

let client: Anthropic | null = null;

function getClient(): Anthropic {
  const key = env().ANTHROPIC_API_KEY;
  if (!key) throw new AiNotConfiguredError('anthropic');
  if (!client) client = new Anthropic({ apiKey: key, maxRetries: 3 });
  return client;
}

function imageBlock(image: AiImage): Anthropic.ImageBlockParam {
  return {
    type: 'image',
    source: { type: 'base64', media_type: image.mediaType, data: image.base64 },
  };
}

/**
 * Images are attached to the first user message. Claude reads images better
 * when they precede the text that asks about them.
 */
// Exported for the multimodal payload tests: the shape a provider receives
// is the thing worth pinning, and it cannot be seen from outside otherwise.
export function buildMessages(request: AiRequest): Anthropic.MessageParam[] {
  const messages: Anthropic.MessageParam[] = request.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  if (request.images?.length) {
    const firstUserIndex = messages.findIndex((m) => m.role === 'user');
    const target = firstUserIndex === -1 ? 0 : firstUserIndex;
    const existing = messages[target];
    const text = typeof existing?.content === 'string' ? existing.content : '';

    messages[target] = {
      role: 'user',
      content: [...request.images.map(imageBlock), { type: 'text', text }],
    };
  }

  return messages;
}

function textFrom(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();
}

/**
 * The prompt's size and how much of it was cached, normalised to our rule that
 * the cached count is a SUBSET of the input count.
 *
 * Anthropic reports it the other way round: `input_tokens` counts only what was
 * charged at full rate, with cache reads and cache writes as separate figures
 * beside it. Reporting `input_tokens` alone would therefore understate the
 * prompt, and understate it by MORE the better the cache worked.
 *
 * Cache writes are folded into the fresh side. Anthropic charges them at 1.25x
 * base and `costMicros` has no rate for that, so this under-bills them by a
 * quarter — which is exactly zero today, because nothing in this codebase sends
 * `cache_control` and Anthropic never writes a cache it was not asked to. Send
 * `cache_control` and this comment becomes a real debt, so give the price table
 * a write rate at the same time.
 */
export function usageOf(usage: Anthropic.Usage): { inputTokens: number; cachedInputTokens: number } {
  const cached = usage.cache_read_input_tokens ?? 0;
  const written = usage.cache_creation_input_tokens ?? 0;
  return { inputTokens: usage.input_tokens + cached + written, cachedInputTokens: cached };
}

function wrapError(err: unknown): never {
  if (err instanceof AiError) throw err;
  if (err instanceof Anthropic.RateLimitError) {
    throw new AiError('The AI service is rate limited. Please try again shortly.', err, true);
  }
  if (err instanceof Anthropic.APIConnectionError) {
    throw new AiError('Could not reach the AI service.', err, true);
  }
  if (err instanceof Anthropic.APIError) {
    const retryable = err.status !== undefined && err.status >= 500;
    throw new AiError(`AI service error (${err.status ?? 'unknown'}).`, err, retryable);
  }
  throw new AiError('Unexpected AI failure.', err);
}

export const anthropicProvider: AiProvider = {
  name: 'anthropic',

  get defaultModel() {
    return env().ANTHROPIC_MODEL;
  },

  get verifyModel() {
    return env().ANTHROPIC_MODEL_VERIFY;
  },

  get fastModel() {
    return env().ANTHROPIC_MODEL_FAST;
  },

  isConfigured() {
    return env().ANTHROPIC_API_KEY.length > 0;
  },

  async complete(request: AiRequest): Promise<AiResponse> {
    const model = request.model ?? env().ANTHROPIC_MODEL;

    try {
      const response = await getClient().messages.create({
        model,
        max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
        ...(request.system ? { system: request.system } : {}),
        messages: buildMessages(request),
        thinking: { type: 'adaptive' },
        output_config: { effort: EFFORT_MAP[request.effort ?? 'high'] },
      });

      if (response.stop_reason === 'refusal') {
        return {
          text: '',
          modelUsed: response.model,
          ...usageOf(response.usage),
          outputTokens: response.usage.output_tokens,
          refused: true,
        };
      }

      return {
        text: textFrom(response.content),
        modelUsed: response.model,
        ...usageOf(response.usage),
        outputTokens: response.usage.output_tokens,
        refused: false,
      };
    } catch (err) {
      wrapError(err);
    }
  },

  async completeJson<T>(request: AiJsonRequest<T>): Promise<AiJsonResponse<T>> {
    const model = request.model ?? env().ANTHROPIC_MODEL;

    try {
      const response = await getClient().messages.create({
        model,
        max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
        ...(request.system ? { system: request.system } : {}),
        messages: buildMessages(request),
        thinking: { type: 'adaptive' },
        output_config: {
          effort: EFFORT_MAP[request.effort ?? 'high'],
          format: { type: 'json_schema', schema: request.schema },
        },
      });

      if (response.stop_reason === 'refusal') {
        throw new AiError('The AI provider declined this request.');
      }
      if (response.stop_reason === 'max_tokens') {
        throw new AiError('The AI response was cut off before it was complete.', undefined, true);
      }

      const raw = textFrom(response.content);
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new AiError('The AI returned malformed JSON.');
      }

      return {
        data: request.parse(parsed),
        modelUsed: response.model,
        ...usageOf(response.usage),
        outputTokens: response.usage.output_tokens,
      };
    } catch (err) {
      wrapError(err);
    }
  },

  async *streamText(request: AiRequest): AsyncGenerator<string, AiResponse, undefined> {
    const model = request.model ?? env().ANTHROPIC_MODEL;

    try {
      const stream = getClient().messages.stream({
        model,
        max_tokens: request.maxTokens ?? STREAM_MAX_TOKENS,
        ...(request.system ? { system: request.system } : {}),
        messages: buildMessages(request),
        thinking: { type: 'adaptive' },
        output_config: { effort: EFFORT_MAP[request.effort ?? 'high'] },
      });

      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yield event.delta.text;
        }
      }

      const final = await stream.finalMessage();
      return {
        text: textFrom(final.content),
        modelUsed: final.model,
        ...usageOf(final.usage),
        outputTokens: final.usage.output_tokens,
        refused: final.stop_reason === 'refusal',
      };
    } catch (err) {
      wrapError(err);
    }
  },
};
