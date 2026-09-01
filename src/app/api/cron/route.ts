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
 *
 * Both verbs are exported and they are not interchangeable by accident. POST is
 * the honest one for something with this many side effects — it submits expired
 * papers and marks them — and is what a self-hosted scheduler should call. GET
 * exists because Vercel Cron only issues GET, with the deployment's CRON_SECRET
 * as a bearer token; without it the schedule in `vercel.json` would return 405
 * every night and nothing would say so. Same secret, same handler, so there is
 * no second code path to keep honest.
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

/**
 * How long the platform may let this run.
 *
 * Marking a batch of papers is several model calls per paper. The default of a
 * few seconds kills the run half-way through, which for `mark` means papers
 * left graded-but-unfinished.
 *
 * 60, not 300, so this deploys on any plan.
 *
 * A `maxDuration` above the plan's ceiling **fails the deployment** rather than
 * being clamped down to it, and 60 is the Hobby ceiling — asking for Pro's 300
 * here means the build refuses before anyone finds out why. The batch in
 * `lib/jobs.ts` is deliberately small per tick and fits comfortably.
 *
 * Raise it to 300 on Pro if an exam-season backlog ever needs bigger bites.
 */
export const maxDuration = 60;

async function handle(request: Request) {
  const secret = env().CRON_SECRET;
  if (!secret) return fail(503, 'CRON_NOT_CONFIGURED');

  const provided = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!secretMatches(provided, secret)) return fail(401, 'UNAUTHORIZED');

  const { job } = parseQuery(request, querySchema);

  return ok(await runJobs(job as JobName | 'all'));
}

export const POST = route(handle);
export const GET = route(handle);
