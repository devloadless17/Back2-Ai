import { timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

import { fail, ok, parseQuery, route } from '@/lib/api';
import { env } from '@/lib/env';
import { JOB_NAMES, runJobs, type JobName } from '@/lib/jobs';

/**
 * Scheduled maintenance over HTTP, for platform schedulers.
 *
 * Authenticated by a shared secret rather than a session, because the caller is
 * a scheduler, not a person. If CRON_SECRET is unset the endpoint refuses
 * everything — an unauthenticated job runner that can auto-submit exam papers
 * would be a genuinely bad thing to leave open by default.
 *
 * The jobs themselves live in lib/jobs.ts and are also runnable as `npm run
 * cron`, so a deployment does not have to expose this route at all.
 */
const querySchema = z.object({
  job: z.enum([...JOB_NAMES, 'all'] as [JobName, ...JobName[]] | ['all']).default('all'),
});

/** Constant-time compare, so the endpoint cannot be probed a byte at a time. */
function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export const POST = route(async (request) => {
  const secret = env().CRON_SECRET;
  if (!secret) return fail(503, 'CRON_NOT_CONFIGURED');

  const provided = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!secretMatches(provided, secret)) return fail(401, 'UNAUTHORIZED');

  const { job } = parseQuery(request, querySchema);

  return ok(await runJobs(job as JobName | 'all'));
});
