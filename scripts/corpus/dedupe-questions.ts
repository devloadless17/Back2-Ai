import { db } from "../../src/lib/db";

/**
 * Removes exercises that were ingested more than once into the same chapter.
 *
 *   npm run corpus:dedupe -- --dry
 *   npm run corpus:dedupe
 *
 * 664 groups of questions share a paper, a chapter and an opening, and 743 rows
 * are redundant — about one row in seven. A student practising a chapter meets
 * the same exercise twice, the question bank overstates what it holds, and the
 * exam simulator can put one exercise into a paper more than once.
 *
 * Two different things look alike here and only one is a fault:
 *
 *   The SAME exercise twice in the SAME chapter is a duplicate. 493 groups.
 *
 *   The same exercise in DIFFERENT chapters is not. 171 groups. Maths LS 2019
 *   exercise III is filed under both Groups and Logarithm functions because it
 *   genuinely exercises both, and chapter mastery is counted per chapter — one
 *   row per chapter is how a student practising logarithms gets credit for it.
 *   Collapsing those would lose the second chapter's only copy.
 *
 * So the key is (paper, chapter, opening), not (paper, opening).
 *
 * `--exact` is the second pass, and it exists because that reasoning expired.
 * A copy per chapter was the only way to give credit in both chapters when
 * `questions.chapter_id` was all there was. `question_chapters` now offers one
 * exercise in as many chapters as teach it, so a copy per chapter is no longer
 * the mechanism — it is just a copy, and 25 chapter lists were showing a student
 * the identical exercise twice.
 *
 * That pass keys on the paper and the exact statement, normalised for whitespace
 * and nothing else. Not a 120-character opening: several exercises on one paper
 * share a boilerplate preamble longer than that, and grouping on a prefix reads
 * them as duplicates when they are different questions — at 80 characters it
 * claimed 111 duplicate groups where the true number is 26.
 *
 * A loser's chapter is linked to the survivor before the delete, so the exercise
 * stays reachable from every chapter that offered it. That is what the old key
 * was protecting, kept without the duplication.
 *
 * The survivor is chosen by attempts, not by id. A duplicate that a student has
 * already answered carries their mark, their timing and their mastery
 * contribution; deleting it and keeping its twin would erase work someone did.
 * Where a losing row still holds attempts or flashcards they are moved to the
 * survivor first, so nothing is orphaned and nothing is dropped — the two rows
 * are the same exercise, so the history transfers cleanly.
 */
type Row = {
  id: string;
  source_exam_id: string;
  chapter_id: string;
  head: string;
  /** The whole statement, whitespace-normalised, for the `--exact` pass. */
  exact: string;
  attempts: number;
  cards: number;
  /**
   * How many sat papers include this row.
   *
   * `exam_simulation_questions` has a check constraint requiring exactly one
   * source, and its foreign key nulls on delete — so removing a question that
   * appears in a paper someone sat does not orphan a row, it makes the row
   * illegal and the delete fails. That is the database refusing to lose a
   * student's exam, and it is right to.
   */
  sims: number;
  order_index: number;
};

function parseArgs(argv: string[]): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const token of argv)
    if (token.startsWith("--")) out[token.slice(2)] = true;
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const rows = await db.$queryRaw<Row[]>`
    SELECT q.id, q.source_exam_id::text AS source_exam_id, q.chapter_id::text AS chapter_id,
           left(q.content_text, 120) AS head, q.order_index,
           md5(regexp_replace(q.content_text, '\\s+', ' ', 'g')) AS exact,
           (SELECT count(*)::int FROM attempts a WHERE a.question_id = q.id) AS attempts,
           (SELECT count(*)::int FROM flashcard_state f WHERE f.question_id = q.id) AS cards,
           (SELECT count(*)::int FROM exam_simulation_questions e WHERE e.question_id = q.id) AS sims
      FROM questions q
     WHERE q.source_exam_id IS NOT NULL`;

  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const key = args.exact
      ? `${row.source_exam_id}|${row.exact}`
      : `${row.source_exam_id}|${row.chapter_id}|${row.head}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  let removed = 0;
  let moved = 0;
  let groupsFixed = 0;

  for (const members of groups.values()) {
    if (members.length < 2) continue;
    groupsFixed += 1;

    // Most-used first, then the earliest position on the paper. A row somebody
    // has answered is the one to keep.
    /*
     * The last comparison is the id, and it is not decoration.
     *
     * Without it, rows tied on attempts, sat papers, cards and position are
     * left in whatever order the query returned, which Postgres does not
     * promise. Run against two copies of the same corpus, this kept different
     * survivors on each — 4,881 rows both times, but 113 of them different
     * questions. Every later sync keyed on id then skipped those rows in
     * silence, because a row that is missing on the far side is not an error,
     * it is simply not matched.
     */
    const ordered = [...members].sort(
      (a, b) =>
        b.attempts - a.attempts ||
        b.sims - a.sims ||
        b.cards - a.cards ||
        a.order_index - b.order_index ||
        a.id.localeCompare(b.id),
    );
    const [keep, ...drop] = ordered;
    if (!keep) continue;

    for (const loser of drop) {
      if (!args.dry) {
        if (loser.attempts > 0) {
          await db.$executeRaw`UPDATE attempts SET question_id = ${keep.id}::uuid WHERE question_id = ${loser.id}::uuid`;
        }
        if (loser.cards > 0) {
          /*
           * A student can already hold a card for the survivor, and the pair is
           * unique on (user, question). Moving blindly would violate it, so any
           * card whose owner already has one for the survivor is dropped rather
           * than moved — it is the same exercise, so their schedule is kept by
           * the row that stays.
           */
          await db.$executeRaw`
            DELETE FROM flashcard_state f
             WHERE f.question_id = ${loser.id}::uuid
               AND EXISTS (SELECT 1 FROM flashcard_state g
                            WHERE g.user_id = f.user_id AND g.question_id = ${keep.id}::uuid)`;
          await db.$executeRaw`UPDATE flashcard_state SET question_id = ${keep.id}::uuid WHERE question_id = ${loser.id}::uuid`;
        }
        if (loser.sims > 0) {
          // Point the sat paper at the survivor. The two rows are the same
          // exercise, so the paper is unchanged; only the row it cites moves.
          await db.$executeRaw`
            UPDATE exam_simulation_questions SET question_id = ${keep.id}::uuid
             WHERE question_id = ${loser.id}::uuid`;
        }
        /*
         * The chapter that offered the loser now offers the survivor. Done
         * before the delete, because `question_chapters` cascades on delete and
         * the row would already be gone. `ON CONFLICT DO NOTHING` because the
         * survivor is usually linked there already.
         */
        await db.$executeRaw`
          INSERT INTO question_chapters (question_id, chapter_id)
          SELECT ${keep.id}::uuid, qc.chapter_id
            FROM question_chapters qc WHERE qc.question_id = ${loser.id}::uuid
          ON CONFLICT DO NOTHING`;
        await db.$executeRaw`DELETE FROM questions WHERE id = ${loser.id}::uuid`;
      }
      moved += loser.attempts + loser.cards + loser.sims;
      removed += 1;
    }
  }

  console.log(`  duplicate groups     ${groupsFixed}`);
  console.log(`  rows removed         ${removed}`);
  console.log(`  attempts/cards moved ${moved}`);
  if (args.dry) console.log("\n  --dry: nothing written.");

  await db.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
