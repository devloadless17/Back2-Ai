import 'server-only';

/**
 * Fetch with a hard deadline.
 *
 * Node's fetch has no default timeout. Every caller here talks to an external
 * service from a request or cron job, so an unreachable peer must release the
 * socket and worker instead of waiting indefinitely.
 */
export function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 30_000,
): Promise<Response> {
  const deadline = AbortSignal.timeout(timeoutMs);
  return fetch(input, {
    ...init,
    signal: init.signal ? AbortSignal.any([init.signal, deadline]) : deadline,
  });
}
