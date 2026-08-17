/**
 * CLI for the real curriculum taxonomy.
 *
 *   npm run db:seed:taxonomy            # apply
 *   npm run db:seed:taxonomy -- --dry   # show what would change
 *
 * The loading itself lives in `taxonomy-loader.ts`, because `seed.ts` runs the
 * same code — the ordinary seed should produce the real curriculum, not a
 * parallel invented one.
 */

import { PrismaClient } from '@prisma/client';

import { loadCorpusTaxonomy } from './taxonomy-loader';

const db = new PrismaClient();

async function main() {
  const dry = process.argv.includes('--dry');
  const result = await loadCorpusTaxonomy(db, { dry });

  if (!result.corpusPresent) {
    console.log('');
    console.log('No corpus catalog found at scripts/corpus/catalog.csv.');
    console.log('Nothing to seed — the transcribed books are not in this checkout.');
    return;
  }

  console.log('');
  console.log(dry ? 'Would write:' : 'Written:');
  console.log(`  subjects  ${result.subjects}`);
  console.log(`  units     ${result.units}`);
  console.log(`  chapters  ${result.chapters}`);

  if (result.skipped.length) {
    // The same list carries two different things: books that could not be
    // seeded at all, and chapters kept back because content is already filed
    // under them. Calling all of it "skipped" reads as a corpus full of holes
    // when nothing was actually dropped.
    const kept = result.skipped.filter((s) => s.includes('— kept '));
    const dropped = result.skipped.filter((s) => !s.includes('— kept '));

    if (dropped.length) {
      console.log('');
      console.log('Skipped — no chapters to seed:');
      for (const s of dropped) console.log(`  ${s}`);
    }
    if (kept.length) {
      console.log('');
      console.log(`Kept — ${kept.length} chapter(s) not in the current taxonomy but still in use:`);
      for (const s of kept) console.log(`  ${s}`);
    }
  }

  if (!dry) {
    const counts = await db.$queryRaw<{ code: string; subjects: bigint; chapters: bigint }[]>`
      SELECT t.code,
             COUNT(DISTINCT s.id) AS subjects,
             COUNT(c.id)          AS chapters
      FROM tracks t
      LEFT JOIN subjects s ON s.track_id = t.id
      LEFT JOIN chapters c ON c.subject_id = s.id
      GROUP BY t.code
      ORDER BY t.code
    `;
    console.log('');
    console.log('In the database now:');
    for (const r of counts) {
      console.log(`  ${r.code.padEnd(4)} ${Number(r.subjects)} subjects, ${Number(r.chapters)} chapters`);
    }
  }
}

main()
  .catch((error) => {
    console.error('Seeding the taxonomy failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
