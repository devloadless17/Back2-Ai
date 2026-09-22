import { db } from '@/lib/db';

/**
 * Liveness, with a diagnosis attached.
 *
 * TWO CONSUMERS, AND THEY WANT DIFFERENT THINGS.
 *
 * The container HEALTHCHECK asks whether this PROCESS is alive and able to
 * serve. A database outage is not that question. Restarting the web tier
 * because Postgres blinked turns a five-second blip into a restart loop that
 * empties the in-process rate-limit buckets in `lib/api.ts` and kills whatever
 * fire-and-forget ingestion was running. So the status code is 200 WHATEVER THE
 * DATABASE IS DOING, and the only thing that produces a non-200 here is this
 * process failing to answer at all.
 *
 * The deploy gate asks whether the release it just started is actually serving
 * and can reach its data. That is what the body is for: `db` and `revision` are
 * the two facts a release is gated on, and checking `revision` is what makes the
 * gate prove the NEW build is live rather than that A container is up.
 *
 * DELIBERATELY NOT WRAPPED IN `route()` FROM @/lib/api. That wrapper opens an
 * AsyncLocalStorage meter store for AI spend accounting, which this endpoint has
 * no use for and which pulls in the whole `@/lib/ai` import graph. The cheapest
 * endpoint in the application should import the least.
 *
 * NO AUTHENTICATION, and none is possible: the HEALTHCHECK runs as `node -e`
 * inside the container with no session. So the body carries no error strings — a
 * Prisma connection failure names the internal host and port, and that is not
 * something to hand to the internet. `/api/cron` is blocked at the proxy for the
 * same reason; this one stays reachable because an external uptime monitor is
 * worth more than the commit SHA is worth hiding.
 */

/**
 * REQUIRED, not decoration.
 *
 * This handler takes no request argument and calls no dynamic API — no
 * `cookies()`, no `headers()` — so Next is free to evaluate it during
 * `next build`, where there is no database. That would bake `db: "down"` into a
 * static response that never changes again, and the deploy gate would fail every
 * release for a reason that has nothing to do with the release.
 */
export const dynamic = 'force-dynamic';

/**
 * How long the probe may take before it is called a failure.
 *
 * Prisma's own connection timeout is measured in seconds and the HEALTHCHECK
 * gives the whole request five. A probe that inherits the pool's timeout turns
 * "the database is unreachable" into "the health endpoint hangs", which reads to
 * Docker as the process being dead — exactly the restart this endpoint exists to
 * prevent.
 */
const DB_TIMEOUT_MS = 1_500;

async function probeDatabase(): Promise<{ up: boolean; latencyMs: number }> {
  const startedAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    await Promise.race([
      db.$queryRaw`SELECT 1`,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('db probe timed out')), DB_TIMEOUT_MS);
      }),
    ]);
    return { up: true, latencyMs: Date.now() - startedAt };
  } catch {
    return { up: false, latencyMs: Date.now() - startedAt };
  } finally {
    // Without this the timer holds the event loop open for its full duration on
    // every successful probe — 1.5s of keep-alive, twice a minute, forever.
    if (timer) clearTimeout(timer);
  }
}

export async function GET() {
  const database = await probeDatabase();

  return Response.json(
    {
      status: 'ok',
      db: database.up ? 'up' : 'down',
      dbLatencyMs: database.latencyMs,
      // Set by the Dockerfile from the IMAGE_TAG build arg. 'unknown' means
      // somebody built the image by hand.
      revision: process.env.APP_REVISION ?? 'unknown',
      uptimeSec: Math.round(process.uptime()),
    },
    { status: 200, headers: { 'cache-control': 'no-store' } },
  );
}
