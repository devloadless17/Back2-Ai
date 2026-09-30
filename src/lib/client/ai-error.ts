import { ApiRequestError } from '@/lib/client/request';
import type { Dictionary } from '@/lib/i18n/dictionaries/en';

/**
 * What to tell a student when a request that uses the AI is refused.
 *
 * Every one of these used to read "An unexpected error occurred" — including a
 * month's allowance used up, which is neither unexpected nor fixed by trying
 * again, so the student retried, got the same line, and decided the site was
 * broken. The status code already says which it is.
 */
export function aiErrorMessage(err: unknown, t: Dictionary): string {
  if (!(err instanceof ApiRequestError)) return t.common.unknownError;
  if (err.status === 402 || err.code === 'AI_BUDGET_EXHAUSTED') return t.upload.budgetExhausted;
  if (err.status === 429) return t.common.tooManyRequests;
  if (err.code === 'AI_NOT_CONFIGURED') return t.chat.aiNotConfigured;
  return t.common.unknownError;
}
