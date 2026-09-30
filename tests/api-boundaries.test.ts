import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import {
  HttpError,
  assertSameOrigin,
  clientKey,
  parseBody,
  parseQuery,
  rateLimit,
  route,
} from '@/lib/api';

describe('API input boundaries', () => {
  it('rejects malformed JSON without exposing the parser error', async () => {
    const request = new Request('https://bac2.test/api/example', {
      method: 'POST',
      body: '{broken',
      headers: { 'content-type': 'application/json' },
    });

    await expect(parseBody(request, z.object({ value: z.string() }))).rejects.toMatchObject({
      status: 400,
      message: 'Request body must be valid JSON.',
    });
  });

  it('returns structured validation details for valid JSON with the wrong shape', async () => {
    const request = new Request('https://bac2.test/api/example', {
      method: 'POST',
      body: JSON.stringify({ value: 4 }),
      headers: { 'content-type': 'application/json' },
    });

    await expect(parseBody(request, z.object({ value: z.string() }))).rejects.toMatchObject({
      status: 422,
      message: 'Validation failed.',
    });
  });

  it('coerces and validates query parameters', () => {
    const request = new Request('https://bac2.test/api/example?limit=12');
    expect(parseQuery(request, z.object({ limit: z.coerce.number().int().max(50) }))).toEqual({ limit: 12 });
  });
});

describe('API request protection', () => {
  it('accepts a same-origin mutation and rejects a cross-site mutation', () => {
    expect(() =>
      assertSameOrigin(new Request('https://bac2.test/api/example', {
        method: 'POST',
        headers: { origin: 'https://bac2.test' },
      })),
    ).not.toThrow();

    expect(() =>
      assertSameOrigin(new Request('https://bac2.test/api/example', {
        method: 'POST',
        headers: { origin: 'https://attacker.test' },
      })),
    ).toThrowError(HttpError);
  });

  it('uses the first forwarded address and enforces a fixed-window limit', () => {
    const request = new Request('https://bac2.test/api/example', {
      headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.2' },
    });
    const key = clientKey(request, `test-${crypto.randomUUID()}`);
    expect(key).toMatch(/:203\.0\.113\.7$/);
    expect(rateLimit(key, 2, 60_000).allowed).toBe(true);
    expect(rateLimit(key, 2, 60_000).allowed).toBe(true);
    expect(rateLimit(key, 2, 60_000)).toMatchObject({ allowed: false, retryAfter: 60 });
  });

  it('turns unexpected failures into an opaque 500 response', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const handler = route(async () => {
      throw new Error('database password must never reach the client');
    });

    const response = await handler(new Request('https://bac2.test/api/example'));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'An unexpected error occurred.' });
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });
});
