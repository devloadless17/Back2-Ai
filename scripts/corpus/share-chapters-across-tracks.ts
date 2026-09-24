import { db } from '../../src/lib/db';

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
    WITH ch AS (
      SELECT c.id, c.name, c.subject_id, s.name AS subject, s.language, s.track_id
        FROM chapters c JOIN subjects s ON s.id = c.subject_id
    ),
    pairs AS (
      SELECT DISTINCT qc.question_id, target.id AS chapter_id
        FROM ch source
        JOIN question_chapters qc ON qc.chapter_id = source.id
        JOIN questions q ON q.id = qc.question_id AND q.verified_status <> 'rejected'
        JOIN ch target
          ON target.subject = source.subject
         AND target.language = source.language
         AND target.name = source.name
         AND target.track_id <> source.track_id
         -- The other track must study the book this chapter comes out of.
         AND EXISTS (
           SELECT 1
             FROM chapter_content_chunks cl
             JOIN content_chunks cc ON cc.id = cl.chunk_id
             JOIN source_documents d ON d.id = cc.source_document_id
             JOIN tracks tt ON tt.id = target.track_id
            WHERE cl.chapter_id = source.id
              AND tt.code = ANY(d.tracks))
    )
    SELECT count(*)::bigint AS n FROM pairs`;

  const planned = Number(rows[0]?.n ?? 0);
  console.log(`  shared links implied  ${planned}`);

  if (args.dry) {
    console.log('\n  --dry: nothing written.');
    await db.$disconnect();
    return;
  }

  const written = await db.$executeRaw`
    INSERT INTO question_chapters (question_id, chapter_id)
    SELECT DISTINCT qc.question_id, target.id
      FROM chapters sc
      JOIN subjects ss ON ss.id = sc.subject_id
      JOIN question_chapters qc ON qc.chapter_id = sc.id
      JOIN questions q ON q.id = qc.question_id AND q.verified_status <> 'rejected'
      JOIN chapters target ON target.name = sc.name
      JOIN subjects ts ON ts.id = target.subject_id
     WHERE ts.name = ss.name
       AND ts.language = ss.language
       AND ts.track_id <> ss.track_id
       -- The same book test as the count above. Both statements must agree, or
       -- the report describes a set the insert does not write.
         AND EXISTS (
           SELECT 1
             FROM chapter_content_chunks cl
             JOIN content_chunks cc ON cc.id = cl.chunk_id
             JOIN source_documents d ON d.id = cc.source_document_id
             JOIN tracks tt ON tt.id = ts.track_id
            WHERE cl.chapter_id = sc.id
              AND tt.code = ANY(d.tracks))
    ON CONFLICT DO NOTHING`;

  console.log(`  rows inserted         ${written}`);
  console.log(`  already present       ${planned - written}`);

  await db.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
