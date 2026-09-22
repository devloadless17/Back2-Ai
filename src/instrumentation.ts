/**
 * Runs once in the server process, before it handles its first request.
 *
 * ONE JOB: close out ingestion runs that a restart killed.
 *
 * `app/api/admin/ingestion/route.ts` starts its work with `void runIngestion(…)`
 * and returns the job row immediately, because segmenting a scanned paper takes
 * minutes and no HTTP timeout tolerates that. The consequence is that the work
 * is not an in-flight request: Next's SIGTERM handler drains the requests it
 * knows about, does not see this one, and exits. No `stop_grace_period` can
 * change that — the promise is not something the server is waiting on. The row
 * stays `running` forever and the admin page polls a job that no process is
 * working on.
 *
 * Reconciling on the way back IN is the proportionate fix. Doing it properly
 * means a queue worker, which the route's own comment already names as the right
 * answer and which is not worth a second process on a single VPS.
 *
 * THIS IS ONLY CORRECT BECAUSE THIS DEPLOYMENT IS SINGLE-INSTANCE — which it is
 * by design, since `rateLimit` in `lib/api.ts` counts in process memory. With
 * two app containers, a restart of one would mark the other's live jobs failed.
 * If a second instance is ever added, delete this file first.
 */
export async function register() {
  // Next also runs instrumentation in the edge runtime, where there is no
  // Prisma and no database driver. Nothing to reconcile there.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  try {
    const { db } = await import('@/lib/db');

    // `queued` as well as `running`: createJob writes `queued` and the async
    // body flips it to `running` a moment later, so a restart inside that window
    // strands the row just the same.
    const { count } = await db.ingestionJob.updateMany({
      where: { status: { in: ['queued', 'running'] } },
      data: {
        status: 'failed',
        finishedAt: new Date(),
        errorMessage: 'Interrupted by a server restart. Re-run this job.',
      },
    });

    if (count > 0) {
      console.warn(`[startup] failed ${count} ingestion job(s) stranded by a restart`);
    }
  } catch (err) {
    // Never throw. A database that is not up yet must not stop the server
    // booting — /api/health exists precisely so that a database outage does not
    // become a container restart loop, and this would undo that.
    console.error('[startup] ingestion reconciliation skipped', err);
  }
}
