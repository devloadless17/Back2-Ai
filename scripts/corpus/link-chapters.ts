import { db } from '../../src/lib/db';

/**
 * Links an exercise to the other chapters it also belongs to.
 *
 *   npm run corpus:link-chapters -- --subject Chemistry --dry
 *   npm run corpus:link-chapters
 *
 * A Lebanese exam exercise is cross-topic on purpose. One chemistry question
 * runs from an alcohol through its oxidation to an aldehyde and on to the
 * carboxylic acid — three consecutive chapters, one exercise, and
 * `questions.chapter_id` can hold one of them. The other two never offer it, so
 * a student revising aldehydes never meets a question that is half about
 * aldehydes.
 *
 * `check:filing` measured this on GS Chemistry: 41% of exercises have no single
 * best chapter, and every "mis-filing" it found was a swap between adjacent
 * organic chapters at a margin of 0.03. Those are not filing errors to correct.
 * They are one column being asked to hold something that belongs in several.
 *
 * A chapter is linked when its best passage scores within MARGIN of the winner
 * and clears the same floor the filing check uses. The margin is deliberately
 * the one that produced the finding, so this adds exactly the links that
 * analysis said were being lost — not a looser rule that would pull in the
 * whole subject.
 *
 * Only chapters of the question's own subject are considered, and the primary
 * chapter is never removed. Nothing here can take an exercise away from a
 * chapter that already offers it; it can only widen.
 *
 * The ranking is ordered by similarity and then by chapter id, and the second
 * key is not decoration. Chapters that tie are otherwise returned in whatever
 * order Postgres finds convenient, and both LIMIT 6 and MAX_LINKS cut at a
 * fixed position — so a tie at either boundary decides which chapter gets the
 * link by accident. Run against two copies of the same corpus this produced
 * different links on each: same counts, different chapters. That is the same
 * fault the deduplicator had, and it is invisible until two databases are
 * compared.
 */
const MARGIN = 0.03;
const FLOOR = 0.65;
/** Beyond this a "cross-topic" exercise is really an unfiled one. */
const MAX_LINKS = 3;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const subject = arg('--subject');
  const dry = process.argv.includes('--dry');
  const limit = Number(arg('--limit')) || 100_000;

  // Two whole queries rather than one with an interpolated fragment: a nested
  // `db.$queryRaw` inside a template is not a fragment, it is a second query,
  // and Postgres receives the placeholder rather than the clause.
  const questions = subject
    ? await db.$queryRaw<{ id: string; subject_id: string }[]>`
        SELECT q.id, c.subject_id::text AS subject_id
          FROM questions q
          JOIN chapters c ON c.id = q.chapter_id
          JOIN subjects s ON s.id = c.subject_id
         WHERE q.embedding IS NOT NULL AND s.name = ${subject}
         LIMIT ${limit}`
    : await db.$queryRaw<{ id: string; subject_id: string }[]>`
        SELECT q.id, c.subject_id::text AS subject_id
          FROM questions q
          JOIN chapters c ON c.id = q.chapter_id
         WHERE q.embedding IS NOT NULL
         LIMIT ${limit}`;

  console.log(`  questions considered: ${questions.length}`);

  let linked = 0;
  let widened = 0;

  for (const question of questions) {
    /*
     * Ranked against the question's own embedding, over the passages of every
     * chapter in its subject. This is the same comparison the loader made when
     * it chose one chapter; the difference is that it keeps the runners-up.
     */
    const ranked = await db.$queryRaw<{ chapter_id: string; similarity: number }[]>`
      SELECT c.id::text AS chapter_id,
             max(1 - (cc.embedding <=> q.embedding)) AS similarity
        FROM questions q
        JOIN chapters c ON c.subject_id = ${question.subject_id}::uuid
        JOIN chapter_content_chunks j ON j.chapter_id = c.id
        JOIN content_chunks cc ON cc.id = j.chunk_id
       WHERE q.id = ${question.id}::uuid AND cc.embedding IS NOT NULL
       GROUP BY c.id
       ORDER BY similarity DESC, c.id
       LIMIT 6`;

    if (ranked.length < 2) continue;
    const best = Number(ranked[0]?.similarity ?? 0);
    if (best < FLOOR) continue;

    const alsoIn = ranked
      .slice(1, MAX_LINKS + 1)
      .filter((r) => Number(r.similarity) >= FLOOR && best - Number(r.similarity) <= MARGIN);

    if (alsoIn.length === 0) continue;
    widened += 1;

    for (const row of alsoIn) {
      if (!dry) {
        // `skipDuplicates` rather than a check: the primary chapter is already
        // linked by the migration, and it can legitimately appear here too.
        await db.questionChapter.createMany({
          data: [{ questionId: question.id, chapterId: row.chapter_id, score: Number(row.similarity) }],
          skipDuplicates: true,
        });
      }
      linked += 1;
    }
  }

  console.log(`  exercises widened   ${widened}`);
  console.log(`  links added         ${linked}`);
  if (dry) console.log('\n  --dry: nothing written.');

  await db.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
