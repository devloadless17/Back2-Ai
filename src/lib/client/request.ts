'use client';

/**
 * Client-side calls to our own API.
 *
 * One helper so that error handling is identical everywhere: the server returns
 * a stable machine-readable code, the component decides what sentence to show
 * in the student's language. Components never render a raw server string —
 * those are English, and most of these students are not reading English.
 */

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(code);
    this.name = 'ApiRequestError';
  }
}

async function handle<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;

  const payload = (await response.json().catch(() => null)) as
    | (Record<string, unknown> & { error?: string; details?: unknown })
    | null;

  if (!response.ok) {
    throw new ApiRequestError(response.status, payload?.error ?? 'UNKNOWN', payload?.details);
  }

  return payload as T;
}

export async function sendJson<T>(
  url: string,
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  body?: unknown,
): Promise<T> {
  return handle<T>(
    await fetch(url, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

export async function sendForm<T>(url: string, form: FormData): Promise<T> {
  // No content-type header: the browser sets it with the multipart boundary.
  return handle<T>(await fetch(url, { method: 'POST', body: form }));
}
