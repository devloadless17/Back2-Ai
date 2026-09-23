/**
 * Puts a paper under the subject and the edition it is actually written in.
 *
 *   npm run refile:editions                                  report only
 *   npm run refile:editions -- --apply --confirm-db bac2      writes
 *   npm run refile:editions -- --restore <run> --confirm-db bac2
 *
 * ---------------------------------------------------------------------------
 * 44 cycles disagree with their own subject about what language they are in: a
 * cycle stamped `.fr` under `Chemistry`, which is the English course. The
 * obvious reading is that the paper is French and the subject is wrong, and it
 * is wrong for most of them — the text on that Chemistry cycle is English. The
 * STAMP is what is wrong, and moving those papers to `Chimie` on the strength
 * of it would have taken 40-odd English papers out of the English course.
 *
 * SO IT READS THE SCRIPT, NOT THE STAMP AND NOT THE SUBJECT — the same rule
 * `refile-exam-languages.ts` states at the top of itself, for the same reason.
 * Neither column is evidence here; both are the thing being repaired.
 *
 * The test is FUNCTION WORDS, not accents. `refile-cross-language-questions.ts`
 * measured that one: an English paper quotes French titles and prints accented
 * names, so "contains é" finds dozens of false positives — which is very
 * probably how these cycles came to be stamped French in the first place.
 *
 * And the Arabic bar is 0.85, not the 0.60 used elsewhere. The 2021 physics
 * papers carry the ministry's Arabic letterhead above an English exercise and
 * land at 0.64; a genuinely Arabic paper is 90%+, which is the measurement
 * `prune-misfiled-exams.ts` already records. At 0.60 those four papers are
 * called Arabic and there is no Arabic physics course to send them to.
 *
 * THE CYCLE DECIDES, NOT THE QUESTION. A cycle is one printed paper, so the
 * language is voted on across its questions and they all move together. A
 * question whose own text is unreadable — a correction sheet that is nothing
 * but numbers — then travels with its paper instead of being stranded.
 *
 * TWO DECISIONS, AND ONLY ONE OF THEM IS A GUESS.
 *
 * WHICH SUBJECT follows from the language once it is read: the same course
 * exists under a known name per language, down `SIBLINGS`. For most of these
 * the answer is "the one it is already under", and then nothing about the
 * question changes except which cycle it hangs from.
 *
 * WHICH CHAPTER is a guess, and is only asked when the subject actually
 * changes — about 17 questions, not 61. It is chosen by the question's stored
 * embedding against the target subject's course passages, which is the loader's
 * own mechanism, and every choice is printed with its score. `FLOOR` marks the
 * ones worth a look; it does not hold a question back, because the wrong
 * subject is worse than an uncertain chapter in the right one.
 *
 * NO MODEL CALLS. Every one of these questions already carries an embedding.
 * ---------------------------------------------------------------------------
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { db } from '../../src/lib/db';

import { languageOfText, type Language } from './paper-language-rules';

const ROOT = process.cwd();

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}
const APPLY = process.argv.includes('--apply');
const RESTORE = arg('restore');
const CONFIRM_DB = arg('confirm-db');
const BACKUP_DIR = arg('backup-dir') ?? 'corpus/.mapping';

/** Worth a human look. Not a gate — see the note above. */
const FLOOR = 0.65;

/**
 * The same course under its two names.
 *
 * `English`/`Francais` is in here and is not quite like the others: they are
 * two subjects a student sits, not two printings of one. It belongs anyway,
 * because a French paper filed under `English` is a Francais paper — which is
 * exactly what `refile-cross-language-questions.ts` found four questions of,
 * and moved, leaving their cycle behind.
 */
const SIBLINGS: string[][] = [
  ['Mathematics', 'Mathematiques', 'Mathématiques'],
  ['Physics', 'Physique'],
  ['Chemistry', 'Chimie'],
  ['Life Sciences', 'Sciences de la vie', 'Sciences de la Vie'],
  ['English', 'Francais', 'Français'],
];

const backupPath = (run: string, database: string) =>
  path.join(ROOT, BACKUP_DIR, `wrong-edition-backup-${database}-${run}.json`);

type Backup = {
  run: string;
  questions: { id: string; fromCycle: string; fromChapter: string; toChapter: string }[];
  /** `question_chapters` rows removed because their chapter left the subject. */
  links: { questionId: string; chapterId: string; score: number | null }[];
  /** Cycles this run created, to be removed again on restore. */
  createdCycles: string[];
  /** Cycles this run emptied and deleted, stored whole so they can come back. */
  deletedCycles: {
    id: string;
    subjectId: string;
    year: number;
    session: string | null;
    language: Language;
    title: string;
    durationMinutes: number;
    durationIsOfficial: boolean;
  }[];
};

async function currentDatabase(): Promise<string> {
  const rows = await db.$queryRaw<Array<{ d: string }>>`SELECT current_database() AS d`;
  return rows[0]!.d;
}

async function guardWrite() {
  const database = await currentDatabase();
  if (!CONFIRM_DB || CONFIRM_DB !== database) {
    throw new Error(
      `refusing to write: connected to "${database}", --confirm-db says "${CONFIRM_DB ?? '(none)'}"`,
    );
  }
  return database;
}

async function restore(run: string) {
  const database = await guardWrite();
  const file = backupPath(run, database);
  if (!existsSync(file)) throw new Error(`no backup for run ${run} at ${file}`);
  const backup = JSON.parse(readFileSync(file, 'utf-8')) as Backup;

  // Cycles first: a question cannot point at a cycle that is not there yet.
  for (const cycle of backup.deletedCycles) {
    await db.examCycle.upsert({ where: { id: cycle.id }, create: cycle, update: {} });
  }
  for (const question of backup.questions) {
    await db.question.update({
      where: { id: question.id },
      data: { sourceExamId: question.fromCycle, chapterId: question.fromChapter },
    });
    if (question.toChapter !== question.fromChapter) {
      await db.questionChapter
        .delete({
          where: {
            questionId_chapterId: { questionId: question.id, chapterId: question.toChapter },
          },
        })
        .catch(() => {});
    }
  }
  for (const link of backup.links) {
    await db.questionChapter.upsert({
      where: { questionId_chapterId: { questionId: link.questionId, chapterId: link.chapterId } },
      create: link,
      update: {},
    });
  }
  // Only the ones this run made, and only while still empty — a cycle someone
  // has since loaded a paper into is not this script's to remove.
  for (const id of backup.createdCycles) {
    const count = await db.question.count({ where: { sourceExamId: id } });
    if (count === 0) await db.examCycle.delete({ where: { id } }).catch(() => {});
  }

  console.log('');
  console.log(`  database ${database}: ${backup.questions.length} question(s) put back,`);
  console.log(
    `  ${backup.deletedCycles.length} cycle(s) recreated, ${backup.links.length} link(s) restored.`,
  );
  console.log('');
}

async function main() {
  if (RESTORE) return restore(RESTORE);

  const database = await currentDatabase();

  /*
   * Prisma cannot compare two columns in a `where`, so the set is read in SQL.
   * Everything after this is Prisma against known ids.
   */
  const misfiled = await db.$queryRaw<
    {
      cycle_id: string;
      year: number;
      session: string | null;
      cycle_language: Language;
      title: string;
      duration_minutes: number;
      duration_is_official: boolean;
      subject_id: string;
      subject_name: string;
      subject_language: Language;
      track_id: string | null;
      track_code: string | null;
    }[]
  >`
    SELECT c.id AS cycle_id, c.year, c.session, c.language::text AS cycle_language, c.title,
           c.duration_minutes, c.duration_is_official,
           s.id AS subject_id, s.name AS subject_name, s.language::text AS subject_language,
           s.track_id, t.code AS track_code
      FROM exam_cycles c
      JOIN subjects s ON s.id = c.subject_id
      LEFT JOIN tracks t ON t.id = s.track_id
     WHERE s.language <> 'ar' AND c.language <> s.language
     ORDER BY t.code, s.name, c.year, c.session
  `;

  const backup: Backup = { run: '', questions: [], links: [], createdCycles: [], deletedCycles: [] };
  const unreadable: string[] = [];
  const bilingual: string[] = [];
  const homeless: string[] = [];
  const restamped: string[] = [];
  const rehomed: string[] = [];
  let weak = 0;
  let movedQuestions = 0;

  for (const cycle of misfiled) {
    const questions = await db.question.findMany({
      where: { sourceExamId: cycle.cycle_id },
      select: { id: true, chapterId: true, contentText: true },
      orderBy: { orderIndex: 'asc' },
    });
    if (questions.length === 0) continue;

    const label =
      `${cycle.track_code}  ${cycle.subject_name} .${cycle.subject_language}` +
      `  ${cycle.year} ${cycle.session ?? ''}  stamped .${cycle.cycle_language}`;

    // The cycle is one printed paper, so its questions vote on one language.
    const votes = new Map<Language, number>();
    let doubled = 0;
    for (const question of questions) {
      const language = languageOfText(question.contentText);
      if (language === 'mixed') doubled += 1;
      else if (language) votes.set(language, (votes.get(language) ?? 0) + 1);
    }

    /*
     * A row holding both printings cannot go to either edition, and the rest of
     * the paper must not be moved out from under it. The whole cycle waits for
     * that row to be re-extracted.
     */
    if (doubled > 0) {
      bilingual.push(
        `    ${label}   ${doubled} of ${questions.length} question(s) hold two printings in one row`,
      );
      continue;
    }

    const winner = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
    if (!winner) {
      unreadable.push(
        `    ${label}   ${questions.length} question(s), too little prose to read a language from`,
      );
      continue;
    }
    const actual = winner[0];

    const group = SIBLINGS.find((names) => names.includes(cycle.subject_name));
    const target =
      actual === cycle.subject_language
        ? { id: cycle.subject_id, name: cycle.subject_name }
        : group
          ? await db.subject.findFirst({
              where: { trackId: cycle.track_id, name: { in: group }, language: actual },
              select: { id: true, name: true },
            })
          : null;

    if (!target) {
      homeless.push(`    ${label}   reads as .${actual}, and no .${actual} edition of that course exists`);
      continue;
    }

    const movesSubject = target.id !== cycle.subject_id;
    const targetTitle = cycle.title.startsWith(cycle.subject_name)
      ? target.name + cycle.title.slice(cycle.subject_name.length)
      : `${target.name} ${cycle.track_code ?? ''} ${cycle.year}`.trim();

    let targetCycle = await db.examCycle.findFirst({
      where: { subjectId: target.id, year: cycle.year, session: cycle.session, language: actual },
      select: { id: true },
    });

    const wouldCreate = !targetCycle;
    if (!targetCycle && APPLY) {
      targetCycle = await db.examCycle.create({
        data: {
          subjectId: target.id,
          year: cycle.year,
          session: cycle.session,
          language: actual,
          title: targetTitle,
          // Carried across, not re-guessed: it is the same printed paper.
          durationMinutes: cycle.duration_minutes,
          durationIsOfficial: cycle.duration_is_official,
        },
        select: { id: true },
      });
      backup.createdCycles.push(targetCycle.id);
    }

    const headline =
      `  ${label}  ->  ${movesSubject ? target.name + ' ' : ''}.${actual}` +
      `${wouldCreate ? '   (new cycle)' : '   (merged into the existing paper)'}`;
    (movesSubject ? rehomed : restamped).push(headline);
    const lines = movesSubject ? rehomed : restamped;

    for (const question of questions) {
      /*
       * The chapter is only reconsidered when the subject changes. When the
       * stamp was the only thing wrong, the question is already filed under a
       * chapter of the right course, and re-deciding it by embedding would
       * churn a correct row for nothing.
       */
      let chapterId = question.chapterId;
      let note = '';

      if (movesSubject) {
        const ranked = await db.$queryRaw<{ chapter_id: string; name: string; similarity: number }[]>`
          SELECT ch.id AS chapter_id, ch.name,
                 max(1 - (cc.embedding <=> (SELECT embedding FROM questions WHERE id = ${question.id}::uuid))) AS similarity
            FROM content_chunks cc
            JOIN chapter_content_chunks link ON link.chunk_id = cc.id
            JOIN chapters ch ON ch.id = link.chapter_id
           WHERE ch.subject_id = ${target.id}::uuid
             AND ch.cancelled_at IS NULL
             AND cc.embedding IS NOT NULL
           GROUP BY ch.id, ch.name
           ORDER BY similarity DESC
           LIMIT 1
        `;

        /*
         * No passages in the target subject, so nothing can rank its chapters.
         * The first live chapter is not a claim about the question — it is a
         * place to stand inside the right subject, and the report says so.
         */
        const fallback = ranked[0]
          ? null
          : await db.chapter.findFirst({
              where: { subjectId: target.id, cancelledAt: null },
              orderBy: { orderIndex: 'asc' },
              select: { id: true, name: true },
            });
        if (!ranked[0] && !fallback) {
          lines.push(`      SKIPPED — ${target.name} has no live chapter to file into`);
          continue;
        }

        chapterId = ranked[0]?.chapter_id ?? fallback!.id;
        const chapterName = ranked[0]?.name ?? fallback!.name;
        const similarity = ranked[0] ? Number(ranked[0].similarity) : null;
        if (similarity !== null && similarity < FLOOR) weak += 1;
        note =
          `${similarity === null ? ' none' : similarity.toFixed(2)}` +
          `${similarity !== null && similarity < FLOOR ? ' ?' : '  '} ${chapterName.slice(0, 34).padEnd(36)}`;
      }

      lines.push(
        `      ${note}${note ? '' : '(chapter kept)'.padEnd(44)}` +
          `  ${question.contentText.replace(/\s+/g, ' ').slice(0, 50)}`,
      );
      movedQuestions += 1;

      if (!APPLY) continue;

      const stale = movesSubject
        ? await db.questionChapter.findMany({
            where: { questionId: question.id, chapter: { subjectId: { not: target.id } } },
            select: { questionId: true, chapterId: true, score: true },
          })
        : [];

      await db.$transaction([
        db.question.update({
          where: { id: question.id },
          data: { sourceExamId: targetCycle!.id, chapterId },
        }),
        /*
         * The old links have to go, and `corpus:link-chapters` cannot do it:
         * it only ever widens, and never removes a chapter that already offers
         * an exercise. Left behind, they would keep serving this question to
         * the subject it just left.
         */
        ...(movesSubject
          ? [
              db.questionChapter.deleteMany({
                where: { questionId: question.id, chapter: { subjectId: { not: target.id } } },
              }),
              db.questionChapter.upsert({
                where: { questionId_chapterId: { questionId: question.id, chapterId } },
                create: { questionId: question.id, chapterId, score: null },
                update: {},
              }),
            ]
          : []),
      ]);

      backup.questions.push({
        id: question.id,
        fromCycle: cycle.cycle_id,
        fromChapter: question.chapterId,
        toChapter: chapterId,
      });
      backup.links.push(...stale);
    }

    if (APPLY) {
      const left = await db.question.count({ where: { sourceExamId: cycle.cycle_id } });
      const sittings = await db.examSimulation.count({ where: { examCycleId: cycle.cycle_id } });
      if (left === 0 && sittings === 0) {
        backup.deletedCycles.push({
          id: cycle.cycle_id,
          subjectId: cycle.subject_id,
          year: cycle.year,
          session: cycle.session,
          language: cycle.cycle_language,
          title: cycle.title,
          durationMinutes: cycle.duration_minutes,
          durationIsOfficial: cycle.duration_is_official,
        });
        await db.examCycle.delete({ where: { id: cycle.cycle_id } });
      }
    }
  }

  console.log('');
  console.log(`  database ${database}`);
  console.log(`  cycles disagreeing with their subject   ${misfiled.length}`);
  console.log(`  questions to move                       ${movedQuestions}`);
  console.log(`  chapter guesses under ${FLOOR}              ${weak}   marked ? below`);
  console.log('');

  console.log('  THE STAMP WAS WRONG — the paper is in the language its subject teaches,');
  console.log('  so it goes back to that edition of the same course and nothing else changes.');
  console.log('');
  for (const line of restamped) console.log(line);
  console.log('');

  console.log('  THE SUBJECT WAS WRONG — the paper really is in another language, so it moves');
  console.log('  to that course. Its chapter is re-chosen, and that part is a guess.');
  console.log('');
  for (const line of rehomed) console.log(line);
  console.log('');

  if (bilingual.length > 0) {
    console.log('  LEFT ALONE — one row holds both printings, so no edition can claim it.');
    console.log('  A separate defect, and the fix is re-extraction, not re-filing:');
    for (const line of bilingual) console.log(line);
    console.log('');
  }
  if (unreadable.length > 0) {
    console.log('  LEFT ALONE — not enough prose to read a language from:');
    for (const line of unreadable) console.log(line);
    console.log('');
  }
  if (homeless.length > 0) {
    console.log('  LEFT ALONE — no edition of that course exists in the language it is in:');
    for (const line of homeless) console.log(line);
    console.log('    These stay where they are, and stay hidden by OWN_EDITION_ONLY.');
    console.log('');
  }

  if (!APPLY) {
    console.log(`  DRY RUN — nothing was written. Re-run with --apply --confirm-db ${database}.`);
    console.log('');
    return;
  }

  await guardWrite();
  const run = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '');
  backup.run = run;
  const file = backupPath(run, database);
  writeFileSync(file, JSON.stringify(backup));

  console.log(
    `  moved ${backup.questions.length} question(s); created ${backup.createdCycles.length} cycle(s);`,
  );
  console.log(
    `  deleted ${backup.deletedCycles.length} emptied cycle(s); dropped ${backup.links.length} stale chapter link(s).`,
  );
  console.log(`  backup: ${path.relative(ROOT, file)}`);
  console.log(`  restore: npm run refile:editions -- --restore ${run} --confirm-db ${database}`);
  console.log('');
  console.log('  Then rebuild the links the moved questions lost:');
  console.log('    npm run corpus:link-chapters     the other chapters that may offer them');
  console.log('    npm run corpus:share-tracks      the same course on the other tracks');
  console.log('');
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
