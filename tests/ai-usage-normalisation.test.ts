import { describe, expect, it } from 'vitest';

import { usageOf } from '@/lib/ai/anthropic';
import { cachedTokensOf } from '@/lib/ai/openai';
import { costMicros } from '@/lib/ai/budget';

/**
 * The two providers report a cached prompt in OPPOSITE directions, and
 * `costMicros` can only be right about one of them. Its rule — chosen because
 * it is the one a reader assumes — is that `cachedInputTokens` is a SUBSET of
 * `inputTokens`, so `fresh = input - cached`.
 *
 * That makes each adapter's job a conversion, not a copy, and a conversion in
 * the wrong direction is invisible: the bill is merely wrong. These tests pin
 * the direction for each provider so that "simplifying" either one back to the
 * raw field fails loudly.
 */

describe('Anthropic usage, where cached tokens sit BESIDE the input count', () => {
  const usage = (over: Record<string, number>) =>
    ({ input_tokens: 0, output_tokens: 0, ...over }) as never;

  it('adds cache reads back, because input_tokens excludes them', () => {
    // 16,000 token prompt, 15,000 of it served from cache.
    expect(usageOf(usage({ input_tokens: 1_000, cache_read_input_tokens: 15_000 }))).toEqual({
      inputTokens: 16_000,
      cachedInputTokens: 15_000,
    });
  });

  it('counts a cache WRITE as part of the prompt but not as cached', () => {
    expect(usageOf(usage({ input_tokens: 1_000, cache_creation_input_tokens: 15_000 }))).toEqual({
      inputTokens: 16_000,
      cachedInputTokens: 0,
    });
  });

  it('reports an uncached call unchanged', () => {
    expect(usageOf(usage({ input_tokens: 16_000 }))).toEqual({
      inputTokens: 16_000,
      cachedInputTokens: 0,
    });
  });
});

describe('OpenAI usage, where cached tokens are INSIDE the input count', () => {
  it('reads the cached subset without adding it to anything', () => {
    expect(cachedTokensOf({ prompt_tokens_details: { cached_tokens: 15_000 } })).toBe(15_000);
  });

  it('reports zero rather than null when usage exists but nothing was cached', () => {
    expect(cachedTokensOf({ prompt_tokens_details: { cached_tokens: 0 } })).toBe(0);
    expect(cachedTokensOf({})).toBe(0);
  });

  it('reports null when there is no usage to read, so nothing is asserted', () => {
    expect(cachedTokensOf(null)).toBeNull();
    expect(cachedTokensOf(undefined)).toBeNull();
  });
});

describe('what reading the cache is worth', () => {
  /*
   * The reason this work was done. Before it, `cachedInputTokens` was always
   * zero at every call site, so a cached prompt was billed to the student's AI
   * budget as if it had been sent fresh.
   */
  it('stops a cached prompt being billed at the fresh rate', () => {
    const tokens = { model: 'gpt-5.5', inputTokens: 16_000, outputTokens: 1_100 };

    const unread = costMicros({ ...tokens, cachedInputTokens: 0 });
    const read = costMicros({ ...tokens, cachedInputTokens: 15_000 });

    expect(read).toBeLessThan(unread);
    // The whole discount lands on the input side; output is untouched.
    expect(unread - read).toBe(costMicros({ ...tokens, outputTokens: 0, cachedInputTokens: 0 }) -
      costMicros({ ...tokens, outputTokens: 0, cachedInputTokens: 15_000 }));
  });
});
