import { describe, expect, it } from 'vitest';

import { buildMessages as buildOpenAi } from '@/lib/ai/openai';
import { buildMessages as buildAnthropic } from '@/lib/ai/anthropic';
import type { AiImage, AiRequest } from '@/lib/ai/types';

/**
 * What each provider actually receives when a question carries figures.
 *
 * `AiRequest.images` is provider-neutral and each adapter has its own encoding.
 * The failure this guards against is silent: an adapter that drops the images
 * still returns a fluent answer, and nothing on screen says the model never saw
 * the diagram. So the payload shape is asserted, not the reply.
 *
 * Both adapters attach images to the FIRST USER MESSAGE and put them before the
 * text — that is deliberate in both files, and re-ordering it would change how
 * the model reads the question, so it is pinned here.
 */

const image = (byte: string): AiImage => ({ base64: byte, mediaType: 'image/png' });

const request = (over: Partial<AiRequest> = {}): AiRequest => ({
  system: 'You are a tutor.',
  messages: [{ role: 'user', content: 'Explain the circuit in source_1_figure_1.' }],
  ...over,
});

describe('OpenAI', () => {
  it('sends an image as an inline data url, never a public link', () => {
    const messages = buildOpenAi(request({ images: [image('AAA')] }));
    const user = messages.find((m) => m.role === 'user')!;
    const parts = user.content as { type: string; image_url?: { url: string } }[];

    const img = parts.find((p) => p.type === 'image_url')!;
    expect(img.image_url!.url).toBe('data:image/png;base64,AAA');
    expect(img.image_url!.url.startsWith('data:')).toBe(true);
    expect(img.image_url!.url).not.toMatch(/^https?:/);
  });

  it('keeps several figures in the order they were given', () => {
    const messages = buildOpenAi(request({ images: [image('AAA'), image('BBB'), image('CCC')] }));
    const parts = messages.find((m) => m.role === 'user')!.content as {
      type: string;
      image_url?: { url: string };
    }[];

    expect(parts.filter((p) => p.type === 'image_url').map((p) => p.image_url!.url)).toEqual([
      'data:image/png;base64,AAA',
      'data:image/png;base64,BBB',
      'data:image/png;base64,CCC',
    ]);
  });

  it('keeps the question text alongside the figures', () => {
    const messages = buildOpenAi(request({ images: [image('AAA')] }));
    const parts = messages.find((m) => m.role === 'user')!.content as {
      type: string;
      text?: string;
    }[];
    expect(parts.find((p) => p.type === 'text')!.text).toContain('source_1_figure_1');
  });

  it('leaves an ordinary text-only turn exactly as it was', () => {
    const messages = buildOpenAi(request());
    const user = messages.find((m) => m.role === 'user')!;
    expect(typeof user.content).toBe('string');
    expect(user.content).toBe('Explain the circuit in source_1_figure_1.');
  });
});

describe('Anthropic', () => {
  it('sends an image as a base64 block, never a public link', () => {
    const messages = buildAnthropic(request({ images: [image('AAA')] }));
    const blocks = messages[0]!.content as {
      type: string;
      source?: { type: string; media_type: string; data: string };
    }[];

    const img = blocks.find((b) => b.type === 'image')!;
    expect(img.source!.type).toBe('base64');
    expect(img.source!.media_type).toBe('image/png');
    expect(img.source!.data).toBe('AAA');
  });

  it('puts the figures before the text, as the adapter intends', () => {
    const messages = buildAnthropic(request({ images: [image('AAA')] }));
    const blocks = messages[0]!.content as { type: string }[];
    expect(blocks[0]!.type).toBe('image');
    expect(blocks[blocks.length - 1]!.type).toBe('text');
  });

  it('keeps several figures in the order they were given', () => {
    const messages = buildAnthropic(request({ images: [image('AAA'), image('BBB')] }));
    const blocks = messages[0]!.content as {
      type: string;
      source?: { data: string };
    }[];
    expect(blocks.filter((b) => b.type === 'image').map((b) => b.source!.data)).toEqual([
      'AAA',
      'BBB',
    ]);
  });

  it('leaves an ordinary text-only turn exactly as it was', () => {
    const messages = buildAnthropic(request());
    expect(messages[0]!.content).toBe('Explain the circuit in source_1_figure_1.');
  });
});
