/**
 * Scheduled maintenance, from the command line.
 *
 *   npm run cron                  # every job
 *   npm run cron -- auto_submit   # just one
 *
 * Point OS cron or Windows Task Scheduler at this. It talks to the database
 * directly and does not need the web tier to be up — which matters for
 * `auto_submit`, the job that marks papers abandoned by students who closed the
 * tab. Those marks should not be waiting on a health check.
 *
 * Suggested cadence:
 *   auto_submit  every 5 minutes   — a finished paper should not sit unmarked
 *   notify       daily, early      — before students open the app
 *   readiness    daily, off-peak   — walks every user
 *   difficulty   daily, off-peak
 *   sessions     weekly
 */

import { PrismaClient } from '@prisma/client';

import { JOB_NAMES, runJobs, type JobName } from '../src/lib/jobs';

const db = new PrismaClient();

async function main() {
  const requested = process.argv[2] ?? 'all';

  if (requested !== 'all' && !JOB_NAMES.includes(requested as JobName)) {
    console.error(`Unknown job "${requested}". Known jobs: ${JOB_NAMES.join(', ')}, all.`);
    process.exitCode = 1;
    return;
  }

  const startedAt = Date.now();
  const results = await runJobs(requested as JobName | 'all');

  for (const [key, value] of Object.entries(results)) {
    console.log(`  ${key.padEnd(20)} ${value}`);
  }

  const failures = Object.values(results).filter((v) => typeof v === 'string');
  console.log(`\nDone in ${Math.round((Date.now() - startedAt) / 1000)}s.`);

  // A non-zero exit is how a scheduler notices; a silent partial failure is how
  // a broken job goes unnoticed for a term.
  if (failures.length > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error('Cron run failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
