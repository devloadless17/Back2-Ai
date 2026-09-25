import { Prisma } from '@prisma/client';

import { db } from '../../src/lib/db';

/**
 * Every (question, chapter) pair the sharing rule implies — ONE definition,
 * used by both the count and the insert, so the report can never describe a
 * set the insert does not write.
 *
 * TWO RULES AGAINST DUPLICATES, both added after the fact.
 *
 * The same paper is filed once per track: GS and LS sit the same history,
 * civics and geography papers, and the corpus keeps a copy under each track.
 * Sharing every copy into every track put each question in front of a student
 * up to four times — history reached 640 rows and 207 distinct questions.
 *
 *   A copy is not shared into a subject that already has its own copy of the
 *   same text. That track sat the paper; it has it.
 *
 *   Where several other tracks hold the same text, one copy is shared, not
 *   one per track. The lowest id, so re-runs pick the same row.
 *
 * A paper only one track sat still reaches the others, which is the point.
 */
const PAIRS = Prisma.sql`
  WITH cand AS (
    SELECT qc.question_id, target.id AS chapter_id, q.content_text
      FROM chapters sc
      JOIN subjects ss ON ss.id = sc.subject_id
      JOIN question_chapters qc ON qc.chapter_id = sc.id
      JOIN questions q ON q.id = qc.question_id AND q.verified_status <> 'rejected'
      JOIN chapters target ON target.name = sc.name
      JOIN subjects ts ON ts.id = target.subject_id
     WHERE ts.name = ss.name
       AND ts.language = ss.language
       AND ts.track_id <> ss.track_id
       -- The other track must study the book this chapter comes out of.
       AND EXISTS (
         SELECT 1
           FROM chapter_content_chunks cl
           JOIN content_chunks cc ON cc.id = cl.chunk_id
           JOIN source_documents d ON d.id = cc.source_document_id
           JOIN tracks tt ON tt.id = ts.track_id
          WHERE cl.chapter_id = sc.id
            AND tt.code = ANY(d.tracks))
       -- Not into a subject that already holds its own copy of this text.
       -- Compared with whitespace removed: two tracks' copies of one paper
       -- differ in line breaks, and an exact comparison let 100 of them in.
       AND NOT EXISTS (
         SELECT 1
           FROM questions twin
           JOIN chapters tc ON tc.id = twin.chapter_id
          WHERE tc.subject_id = ts.id
            AND twin.verified_status <> 'rejected'
            AND regexp_replace(twin.content_text, '\\s+', '', 'g') = regexp_replace(q.content_text, '\\s+', '', 'g'))
  ),
  pairs AS (
    -- One copy per text per target chapter.
    SELECT DISTINCT ON (chapter_id, md5(regexp_replace(content_text, '\\s+', '', 'g'))) question_id, chapter_id
      FROM cand
     ORDER BY chapter_id, md5(regexp_replace(content_text, '\\s+', '', 'g')), question_id
  )`;

/**
 * Offers an exercise to every track that studies the same chapter.
 *
 *   npm run corpus:share-tracks -- --dry
 *   npm run corpus:share-tracks
 *   npm run corpus:share-tracks -- --undo
 *
 * GS and LS sit the same chemistry, from the same book, examined by the same
 * ministry. The corpus keeps a separate `subjects` row per track, so "Alcohols"
 * exists twice and each copy only ever offered the exercises from its own
 * track's papers. A GS student revising alcohols met 17 questions while 5 more,
 * on the same reactions in the same language, sat unreachable behind a track
 * label — and the reverse for LS.
 *
 * That is the whole change: where two tracks have a chapter of the same name, in
 * the same subject and the same language, each is offered the other's exercises.
 * Nothing is moved and nothing is deleted. `questions.chapter_id` still records
 * where an exercise came from, and the shared rows are additions to
 * `question_chapters` — the same table, and the same mechanism, that already
 * lets one exercise belong to several chapters within a subject.
 *
 * Matching is on the chapter name AND ON THE BOOK, and the second half was
 * missing. Name alone says two tracks use the same word, not that they study
 * the same thing: GS and LH both have a chapter called "Radioactivity" and both
 * have one called "Current Medicinal Drugs", out of different textbooks, at
 * different depths. Name alone also shared maths across all four tracks, which
 * have four separate books — `math-gs-*`, `math-ls-*`, `math-se-*`,
 * `math-lh-*` — and LH philosophy with the other three, which sit `falsafe-gsls`
 * while LH sits `falsafe-lh`. 3,600 links of the 16,148 were of that kind.
 *
 * `source_documents.tracks` already records which tracks a book serves, so the
 * test is: the book this chapter's passages come from must be one the other
 * track studies. Nothing is hardcoded and nothing needs maintaining — a new
 * book serving two tracks shares on the next run, and one serving a single
 * track never does.
 *
 * What it still cannot see is depth WITHIN a shared book, and that limit is
 * real but much smaller: two tracks issued the same textbook are examined on
 * the same material even where one is asked harder questions about it. So this
 * widens supply, and the curriculum work that decides what each track should
 * actually be asked comes after it, with `--undo` to clear the ground.
 *
 * `--undo` is exact, because the rows are self-identifying: a shared link is one
 * where the question's subject is not the chapter's subject. Nothing else in the
 * corpus produces those, so there is no marker to keep and nothing to get out of
 * step. Everything this writes, that removes.
 */
function parseArgs(argv: string[]): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const token of argv) if (token.startsWith('--')) out[token.slice(2)] = true;
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.undo) {
    const removed = await db.$executeRaw`
      DELETE FROM question_chapters qc
       USING questions q, chapters home, chapters target
       WHERE qc.question_id = q.id
         AND home.id = q.chapter_id
         AND target.id = qc.chapter_id
         AND home.subject_id <> target.subject_id`;
    console.log(`  shared links removed  ${removed}`);
    await db.$disconnect();
    return;
  }

  /*
   * Every (question, chapter) pair the sharing rule implies, computed in one
   * statement and inserted in one statement.
   *
   * `ON CONFLICT DO NOTHING` rather than a prior existence check: a question can
   * already be linked to the target chapter by the within-subject linker, and
   * the pair is unique, so the database is the right place to settle it.
   *
   * `score` is left null. The within-subject links carry the similarity that
   * earned them; these were not earned by similarity, they were earned by two
   * tracks studying the same chapter, and putting a number there would invite
   * someone to rank the two kinds against each other as though they meant the
   * same thing.
   */
  const rows = await db.$queryRaw<{ n: bigint }[]>`
    ${PAIRS}
    SELECT count(*)::bigint AS n FROM pairs`;

  const planned = Number(rows[0]?.n ?? 0);
  console.log(`  shared links implied  ${planned}`);

  if (args.dry) {
    console.log('\n  --dry: nothing written.');
    await db.$disconnect();
    return;
  }

  const written = await db.$executeRaw`
    ${PAIRS}
    INSERT INTO question_chapters (question_id, chapter_id)
    SELECT question_id, chapter_id FROM pairs
    ON CONFLICT DO NOTHING`;

  console.log(`  rows inserted         ${written}`);

  /*
   * COUNTED FROM THE DATABASE, NOT `planned - written`.
   *
   * That subtraction assumes the count above and the insert below describe the
   * same set, and reports the difference as "already present" when they do not.
   * A production run printed `implied 3967 / inserted 0 / already present 3967`
   * while 67 of those pairs were demonstrably absent from the table — the
   * arithmetic turned a silent failure into a clean bill of health, which is
   * the worst thing a report can do.
   *
   * So the run ends by asking the database what is still missing. If anything
   * is, it says so and exits non-zero; nobody should have to notice a wrong
   * number to find out the job did not finish.
   */
  const missingRows = await db.$queryRaw<{ n: bigint }[]>`
    WITH ch AS (
      SELECT c.id, c.name, s.name AS subject, s.language, s.track_id
        FROM chapters c JOIN subjects s ON s.id = c.subject_id
    )
    SELECT count(*)::bigint AS n FROM (
      SELECT DISTINCT qc.question_id, target.id AS chapter_id
        FROM ch source
        JOIN question_chapters qc ON qc.chapter_id = source.id
        JOIN questions q ON q.id = qc.question_id AND q.verified_status <> 'rejected'
        JOIN ch target
          ON target.subject = source.subject
         AND target.language = source.language
         AND target.name = source.name
         AND target.track_id <> source.track_id
       WHERE EXISTS (
         SELECT 1
           FROM chapter_content_chunks cl
           JOIN content_chunks cc ON cc.id = cl.chunk_id
           JOIN source_documents d ON d.id = cc.source_document_id
           JOIN tracks tt ON tt.id = target.track_id
          WHERE cl.chapter_id = source.id
            AND tt.code = ANY(d.tracks))
    ) implied
    WHERE NOT EXISTS (
      SELECT 1 FROM question_chapters qc2
       WHERE qc2.question_id = implied.question_id
         AND qc2.chapter_id = implied.chapter_id)`;

  const missing = Number(missingRows[0]?.n ?? 0);
  console.log(`  already present       ${planned - written}`);
  console.log('');
  if (missing === 0) {
    console.log('  verified: every link the rule implies is in the table.');
  } else {
    console.log(`  NOT DONE: ${missing} link(s) the rule implies are still missing.`);
    console.log('  The insert reported success and did not write them. Do not treat this run');
    console.log('  as finished — re-run, and if the number does not fall, the insert and the');
    console.log('  count above have drifted apart and the rule needs diffing against itself.');
    process.exitCode = 1;
  }

  await db.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
