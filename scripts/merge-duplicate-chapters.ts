/**
 * Merges chapters that are the same chapter listed twice in one subject.
 *
 *   npm run merge:chapters            what it would merge
 *   npm run merge:chapters -- --apply
 *
 * A subject served by a textbook AND its workbook got each chapter twice. The
 * seeder gave every book its own contiguous range of `orderIndex` and never
 * asked whether the subject already had a chapter of that name, so "Learning
 * from Our Past" exists once holding the textbook's passages and once holding
 * the workbook's. The student's index listed both, and the second read "No
 * practice questions for this chapter yet".
 *
 * `taxonomy-loader.ts` no longer creates them. This clears the ones already in
 * the database, which that fix cannot reach: the seeder never deletes a chapter
 * with content filed under it, so the second copy would sit there for ever.
 *
 * THE SURVIVOR IS THE LOWEST orderIndex. That is the earlier book in catalog
 * order, which is the textbook — the one whose chapter list came from a taught
 * syllabus rather than an exercise book. Everything filed under the loser moves
 * onto it; nothing is deleted except the empty chapter row at the end.
 *
 * MATCHED ON THE EXACT FOLDED NAME, never on similarity. Two SE readers print
 * "Socio-economic Issues: Employment, Immigration, Living Standards" and
 * "Socio-economic Issues: Emigration, Employment, Production, Living Standards".
 * A person can see those are one chapter; no rule here can, and fusing two real
 * chapters would take a student's mastery with it. They stay separate and are
 * reported so somebody can decide.
 *
 * A REPEATED TITLE IS NOT ALWAYS A DUPLICATE. The English Themes readers repeat
 * "The World Within Us" once inside each of their three thematic units, by the
 * book's own design — see `looksUnparsed` in prisma/taxonomy-loader.ts. So a
 * name appearing N times because ONE book lists it N times must not be merged.
 * Only copies beyond the largest number any single book asks for are merged,
 * and the book's own count comes from the taxonomy JSON rather than being
 * guessed from the database.
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { db } from '@/lib/db';

const APPLY = process.argv.includes('--apply');
const TAXONOMY = path.join(process.cwd(), 'corpus', 'taxonomy');

const fold = (s: string) => s.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * The most times any ONE book lists a given chapter title.
 *
 * This is the number of rows that title is entitled to. Read from the taxonomy
 * files rather than inferred, because the database cannot tell "listed three
 * times by one book" from "listed once by three books" — and those need
 * opposite treatment.
 */
async function entitlement(): Promise<Map<string, number>> {
  const most = new Map<string, number>();
  let files: string[] = [];
  try {
    files = (await readdir(TAXONOMY)).filter((f) => f.endsWith('.json'));
  } catch {
    return most;
  }
  for (const file of files) {
    let parsed: { chapters?: { title?: string }[] };
    try {
      parsed = JSON.parse(await readFile(path.join(TAXONOMY, file), 'utf8'));
    } catch {
      continue;
    }
    const perBook = new Map<string, number>();
    for (const chapter of parsed.chapters ?? []) {
      if (!chapter.title) continue;
      const key = fold(chapter.title);
      perBook.set(key, (perBook.get(key) ?? 0) + 1);
    }
    for (const [key, n] of perBook) most.set(key, Math.max(most.get(key) ?? 0, n));
  }
  return most;
}

type Row = {
  id: string;
  name: string;
  orderIndex: number;
  subjectId: string;
  subject: string;
  track: string | null;
  passages: number;
  questions: number;
  mastery: number;
};

async function main() {
  const allowed = await entitlement();

  const chapters = await db.$queryRaw<Row[]>`
    SELECT c.id, c.name, c.order_index AS "orderIndex", c.subject_id AS "subjectId",
           s.name AS subject, t.code AS track,
           (SELECT count(*)::int FROM chapter_content_chunks x WHERE x.chapter_id = c.id) AS passages,
           (SELECT count(*)::int FROM questions q WHERE q.chapter_id = c.id) AS questions,
           (SELECT count(*)::int FROM chapter_mastery m WHERE m.chapter_id = c.id) AS mastery
    FROM chapters c
    JOIN subjects s ON s.id = c.subject_id
    LEFT JOIN tracks t ON t.id = s.track_id
    ORDER BY c.subject_id, c.order_index
  `;

  const groups = new Map<string, Row[]>();
  for (const row of chapters) {
    const key = `${row.subjectId}::${fold(row.name)}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  let merged = 0;
  let moved = { passages: 0, questions: 0, mastery: 0 };
  const kept: string[] = [];

  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    const name = fold(list[0]!.name);
    const entitled = allowed.get(name) ?? 1;
    if (list.length <= entitled) {
      kept.push(
        `${list[0]!.subject} ${list[0]!.track ?? ''} — "${list[0]!.name}" x${list.length}: one book lists it ${entitled} time(s), so these are different chapters`,
      );
      continue;
    }

    // Lowest orderIndex first; the survivor is the earlier book's row.
    list.sort((a, b) => a.orderIndex - b.orderIndex);
    const survivor = list[0]!;
    const losers = list.slice(entitled > 1 ? entitled : 1);
    if (losers.length === 0) continue;

    for (const loser of losers) {
      merged += 1;
      moved.passages += loser.passages;
      moved.questions += loser.questions;
      moved.mastery += loser.mastery;

      console.log(
        `  ${survivor.subject} ${survivor.track ?? ''}  "${survivor.name}"` +
          `  <- idx ${loser.orderIndex} (${loser.passages}p ${loser.questions}q ${loser.mastery}m)`,
      );

      if (!APPLY) continue;

      await db.$transaction(async (tx) => {
        // Join tables first: their primary keys collide when both chapters
        // already hold the same row, so the move is insert-then-delete rather
        // than update.
        await tx.$executeRaw`
          INSERT INTO chapter_content_chunks (chapter_id, chunk_id)
          SELECT ${survivor.id}::uuid, x.chunk_id FROM chapter_content_chunks x
          WHERE x.chapter_id = ${loser.id}::uuid
          ON CONFLICT DO NOTHING`;
        await tx.$executeRaw`DELETE FROM chapter_content_chunks WHERE chapter_id = ${loser.id}::uuid`;

        await tx.$executeRaw`
          INSERT INTO question_chapters (question_id, chapter_id, score)
          SELECT qc.question_id, ${survivor.id}::uuid, qc.score FROM question_chapters qc
          WHERE qc.chapter_id = ${loser.id}::uuid
          ON CONFLICT DO NOTHING`;
        await tx.$executeRaw`DELETE FROM question_chapters WHERE chapter_id = ${loser.id}::uuid`;

        /*
         * Mastery is per (user, chapter). A student with a record on both rows
         * keeps the survivor's — it is the chapter they will go on practising —
         * and the loser's is dropped rather than summed, because these two rows
         * describe the same chapter twice and adding them would inflate a
         * student's history for having been shown a duplicated index.
         */
        await tx.$executeRaw`
          UPDATE chapter_mastery m SET chapter_id = ${survivor.id}::uuid
          WHERE m.chapter_id = ${loser.id}::uuid
            AND NOT EXISTS (
              SELECT 1 FROM chapter_mastery k
              WHERE k.chapter_id = ${survivor.id}::uuid AND k.user_id = m.user_id)`;
        await tx.$executeRaw`DELETE FROM chapter_mastery WHERE chapter_id = ${loser.id}::uuid`;

        // Plain references: no uniqueness to collide with.
        await tx.$executeRaw`UPDATE questions SET chapter_id = ${survivor.id}::uuid WHERE chapter_id = ${loser.id}::uuid`;
        await tx.$executeRaw`UPDATE attempts SET chapter_id = ${survivor.id}::uuid WHERE chapter_id = ${loser.id}::uuid`;
        await tx.$executeRaw`UPDATE chapter_summaries SET chapter_id = ${survivor.id}::uuid WHERE chapter_id = ${loser.id}::uuid`;
        await tx.$executeRaw`UPDATE generated_cards SET chapter_id = ${survivor.id}::uuid WHERE chapter_id = ${loser.id}::uuid`;
        await tx.$executeRaw`UPDATE generated_problems SET chapter_id = ${survivor.id}::uuid WHERE chapter_id = ${loser.id}::uuid`;
        await tx.$executeRaw`UPDATE study_sessions SET chapter_id = ${survivor.id}::uuid WHERE chapter_id = ${loser.id}::uuid`;
        await tx.$executeRaw`UPDATE todos SET linked_chapter_id = ${survivor.id}::uuid WHERE linked_chapter_id = ${loser.id}::uuid`;

        await tx.$executeRaw`DELETE FROM chapters WHERE id = ${loser.id}::uuid`;
      });
    }
  }

  console.log('');
  console.log(`  duplicate chapter rows   ${merged}`);
  console.log(`  passages moved           ${moved.passages}`);
  console.log(`  questions moved          ${moved.questions}`);
  console.log(`  mastery rows moved       ${moved.mastery}`);

  if (kept.length) {
    console.log('');
    console.log('  left alone — a single book lists the title more than once:');
    for (const line of kept) console.log(`    ${line}`);
  }

  if (!APPLY) console.log('\nNothing changed. Re-run with --apply.');
  await db.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await db.$disconnect();
  process.exit(1);
});
