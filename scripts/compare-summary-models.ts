import { ai } from '@/lib/ai';
import { db } from '@/lib/db';
import { costMicros } from '@/lib/ai/budget';
import { summariseChapter } from '@/lib/summaries';

/**
 * What a chapter summary is worth on the cheap model instead of the flagship.
 *
 *   npm run compare:summary-models
 *   npm run compare:summary-models -- --chapters 3
 *
 * WHY THIS QUESTION IS OPEN. `summariseChapter` writes its final summary on the
 * default model at high effort, and that is the most expensive single thing a
 * student can trigger by clicking — roughly seven times the price of the same
 * call on the verify model. It also runs far more often than it used to: the
 * practice index now links 320 chapters that hold reading and no questions
 * straight into this page, and the cache behind it holds four rows out of
 * 1,157 readable chapters.
 *
 * The default is not obviously right. The batched path inside the same function
 * already hands these exact passages to the cheap model to take notes from, so
 * the codebase already trusts it to READ this material; only the final write-up
 * is on the flagship.
 *
 * WHAT THIS SCRIPT DOES AND DOES NOT SETTLE. It prints both summaries side by
 * side with what each cost, and stops there. Cost is measured; quality is for a
 * person to read, because "is this a good revision summary for a Lebanese
 * Baccalaureate student" is not a number and pretending otherwise would be the
 * same mistake as scoring a chapter split with a benchmark that cannot reward
 * splitting. Read both. If the cheap one is as good, the saving is real and
 * large. If it is thinner, the default stays and this script is the record of
 * why.
 *
 * Neither run touches the cache, in either direction — see `skipCache`.
 */

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Cost of one chapter's summary, read off the meter rather than estimated. */
async function spentSince(mark: Date): Promise<{ usd: number; calls: number }> {
  const rows = await db.aiUsage.findMany({
    where: { createdAt: { gt: mark } },
    select: { model: true, inputTokens: true, cachedInputTokens: true, outputTokens: true },
  });
  const micros = rows.reduce(
    (sum, r) =>
      sum +
      costMicros({
        model: r.model,
        inputTokens: r.inputTokens,
        cachedInputTokens: r.cachedInputTokens,
        outputTokens: r.outputTokens,
      }),
    0n,
  );
  return { usd: Number(micros) / 1_000_000, calls: rows.length };
}

function show(label: string, summary: Awaited<ReturnType<typeof summariseChapter>>, cost: { usd: number; calls: number }) {
  console.log(`\n  ${'─'.repeat(72)}`);
  console.log(`  ${label}   $${cost.usd.toFixed(4)} in ${cost.calls} call(s)${summary.batched ? '  [batched]' : ''}`);
  console.log(`  ${'─'.repeat(72)}`);
  console.log(`\n  OVERVIEW\n  ${summary.overview.replace(/\n/g, '\n  ')}`);
  console.log(`\n  KEY POINTS (${summary.keyPoints.length})`);
  for (const point of summary.keyPoints) {
    console.log(`    • ${point.heading}`);
    console.log(`      ${point.detail.replace(/\n/g, ' ')}`);
  }
  console.log(`\n  WATCH OUT (${summary.watchOut.length})`);
  for (const line of summary.watchOut) console.log(`    ! ${line}`);
}

async function main() {
  const wanted = Number(arg('chapters') ?? '1');
  const cheap = arg('cheap') ?? ai().verifyModel;

  /*
   * Chapters of a middling size, deliberately. A three-passage chapter is too
   * thin to tell two models apart and a 697-passage one is answered by the
   * batching path rather than by the model under test.
   */
  const chapters = await db.$queryRaw<{ id: string; name: string; subject: string; n: number }[]>`
    SELECT c.id::text, c.name, s.name AS subject, count(*)::int AS n
      FROM chapters c
      JOIN subjects s ON s.id = c.subject_id
      JOIN chapter_content_chunks x ON x.chapter_id = c.id
     GROUP BY c.id, c.name, s.name
    HAVING count(*) BETWEEN 8 AND 22
     ORDER BY md5(c.id::text)
     LIMIT ${wanted}`;

  if (chapters.length === 0) {
    console.log('  no chapter of a usable size found');
    await db.$disconnect();
    return;
  }

  console.log(`\n  default model: ${ai().defaultModel}      cheap model: ${cheap}`);

  for (const chapter of chapters) {
    console.log(`\n\n  ══ ${chapter.subject} — ${chapter.name}  (${chapter.n} passages)`);

    /*
     * Three variants, because the first comparison showed the cost is not where
     * it looks. Input was 4,632 tokens and output 4,752 — so $0.143 of a
     * $0.166 summary is output at the flagship's output rate, and most of that
     * output is reasoning nobody reads. Changing the MODEL trades away the
     * writing; changing the EFFORT might not.
     */
    const variants: { label: string; opts: Parameters<typeof summariseChapter>[1] }[] = [
      { label: `AS SHIPPED  ${ai().defaultModel} / high`, opts: { skipCache: true } },
      {
        label: `LESS EFFORT ${ai().defaultModel} / medium`,
        opts: { skipCache: true, effort: 'medium' },
      },
      { label: `CHEAPER     ${cheap} / high`, opts: { skipCache: true, model: cheap } },
    ];

    for (const variant of variants) {
      const mark = new Date();
      const summary = await summariseChapter(chapter.id, variant.opts);
      // The meter is written fire-and-forget so the request is never delayed by
      // it. Give it a moment to land before reading, or the cost reads zero.
      await new Promise((resolve) => setTimeout(resolve, 1500));
      show(variant.label, summary, await spentSince(mark));
    }
  }

  console.log('\n  Nothing was cached. Read both before changing the default.\n');
  await db.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
