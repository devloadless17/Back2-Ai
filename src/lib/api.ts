import { withMeter } from '@/lib/ai/meter-context';
import 'server-only';

import { NextResponse } from 'next/server';
import { ZodError, type ZodSchema } from 'zod';

import type { ApiAuthResult } from '@/lib/auth/guards';

/**
 * Shared plumbing for every route handler: consistent response shapes, one
 * place where unexpected errors are converted, and validation that never lets
 * an unparsed body reach business logic.
 */

export type ApiError = { error: string; details?: unknown };

export function ok<T>(data: T, init?: ResponseInit): NextResponse<T> {
  return NextResponse.json(data, init);
}

export function created<T>(data: T): NextResponse<T> {
  return NextResponse.json(data, { status: 201 });
}

export function noContent(): NextResponse<null> {
  return new NextResponse(null, { status: 204 }) as NextResponse<null>;
}

export function fail(status: number, error: string, details?: unknown): NextResponse<ApiError> {
  return NextResponse.json(details === undefined ? { error } : { error, details }, { status });
}

export function unauthorized(auth: Extract<ApiAuthResult, { ok: false }>): NextResponse<ApiError> {
  return fail(auth.status, auth.error);
}

/** Thrown by business logic to produce a specific status without a try/catch dance. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export async function parseBody<T>(request: Request, schema: ZodSchema<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON.');
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new HttpError(422, 'Validation failed.', parsed.error.flatten());
  }
  return parsed.data;
}

export function parseQuery<T>(request: Request, schema: ZodSchema<T>): T {
  const params = Object.fromEntries(new URL(request.url).searchParams.entries());
  const parsed = schema.safeParse(params);
  if (!parsed.success) {
    throw new HttpError(422, 'Invalid query parameters.', parsed.error.flatten());
  }
  return parsed.data;
}

/**
 * Wraps a handler so no unexpected throw escapes as an opaque 500 with a stack
 * trace in the response. Internal error text is logged, never returned.
 */

/**
 * What this request is spending on, from its path.
 *
 * Coarse on purpose: the point is to tell chat from marking from OCR when
 * reading a bill, not to label every endpoint.
 */
function meterKindFor(request: Request): string {
  const path = new URL(request.url).pathname;
  if (path.startsWith('/api/chat')) return 'chat';
  if (path.startsWith('/api/upload') || path.startsWith('/api/photo-qa')) return 'ocr';
  if (path.startsWith('/api/attempts') || path.startsWith('/api/exam-sim')) return 'marking';
  if (path.startsWith('/api/generation') || path.startsWith('/api/flashcards')) return 'generation';
  return path.replace('/api/', '').split('/')[0] || 'other';
}

export function route<Args extends unknown[]>(
  handler: (request: Request, ...args: Args) => Promise<Response>,
): (request: Request, ...args: Args) => Promise<Response> {
  return async (request, ...args) => {
    try {
      /*
       * Every API request runs inside a meter store, so a model call made
       * anywhere beneath it is charged to the right student without the call
       * site having to know one exists. `apiUser` fills in who; the path names
       * what for.
       */
      return await withMeter(meterKindFor(request), () => handler(request, ...args));
    } catch (err) {
      if (err instanceof HttpError) {
        return fail(err.status, err.message, err.details);
      }
      if (err instanceof ZodError) {
        return fail(422, 'Validation failed.', err.flatten());
      }
      // `redirect()` and `notFound()` signal by throwing; let them through.
      if (err && typeof err === 'object' && 'digest' in err && typeof err.digest === 'string') {
        throw err;
      }
      console.error('[api] unhandled error', request.method, new URL(request.url).pathname, err);
      return fail(500, 'An unexpected error occurred.');
    }
  };
}

/**
 * In-process rate limiter.
 *
 * Adequate for a single-instance deployment and for development. Before this
 * runs multi-instance in production, back it with Redis — a per-process counter
 * silently multiplies the effective limit by the number of instances. The call
 * sites do not change; only this function's body does.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowMs: number): { allowed: boolean; retryAfter: number } {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfter: 0 };
  }

  if (bucket.count >= limit) {
    return { allowed: false, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
  }

  bucket.count += 1;
  return { allowed: true, retryAfter: 0 };
}

export function tooManyRequests(retryAfter: number): NextResponse<ApiError> {
  return NextResponse.json(
    { error: 'Too many requests. Please wait before trying again.' },
    { status: 429, headers: { 'Retry-After': String(retryAfter) } },
  );
}

/**
 * Rejects cross-site state-changing requests.
 *
 * Session cookies are SameSite=Lax, which already blocks a cross-site POST from
 * carrying credentials. This is a second, independent check: browsers have had
 * SameSite bugs, some clients relax it, and for a system that records exam
 * marks the cost of one string comparison is not worth arguing about.
 *
 * Call at the top of every mutating handler.
 */
export function assertSameOrigin(request: Request): void {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return;

  const origin = request.headers.get('origin');
  // Same-origin fetches from some browsers omit Origin on form posts; fall back
  // to Referer, and reject when neither is present on a mutating request.
  const source = origin ?? request.headers.get('referer');
  if (!source) throw new HttpError(403, 'Request origin could not be verified.');

  let sourceHost: string;
  try {
    sourceHost = new URL(source).host;
  } catch {
    throw new HttpError(403, 'Request origin could not be verified.');
  }

  const targetHost = request.headers.get('host') ?? new URL(request.url).host;
  if (sourceHost !== targetHost) {
    throw new HttpError(403, 'Cross-site requests are not permitted.');
  }
}

export function clientKey(request: Request, suffix: string): string {
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded ? (forwarded.split(',')[0] ?? '').trim() : (request.headers.get('x-real-ip') ?? 'unknown');
  return `${suffix}:${ip || 'unknown'}`;
}

// Periodically drop expired buckets so the map cannot grow without bound.
if (typeof setInterval === 'function') {
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }, 60_000);
  // Do not hold the process open in short-lived contexts.
  timer.unref?.();
}
