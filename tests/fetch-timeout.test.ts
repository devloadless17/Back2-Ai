import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchWithTimeout } from '@/lib/fetch-timeout';

describe('fetchWithTimeout', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('adds a deadline when the caller did not provide a signal', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return new Response('ok');
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchWithTimeout('https://service.test', {}, 1_000)).resolves.toBeInstanceOf(Response);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('combines a caller cancellation signal with the deadline', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal).not.toBe(controller.signal);
      controller.abort();
      expect(init?.signal?.aborted).toBe(true);
      return new Response('ok');
    });
    vi.stubGlobal('fetch', fetchMock);

    await fetchWithTimeout('https://service.test', { signal: controller.signal }, 1_000);
  });
});
