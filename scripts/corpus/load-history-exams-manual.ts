/**
 * Hand-transcribed history exam questions -> questions, replacing whatever
 * extract_exams.py produced for that paper.
 *
 *   npm run tsx scripts/corpus/load-history-exams-manual.ts -- --dry
 *   npm run tsx scripts/corpus/load-history-exams-manual.ts
 *
 * Why this exists instead of the regular pipeline: extract_exams.py's
 * Arabic-marks handling is deep and already fought hard for (see its own
 * comments), but Lebanese history papers use a choose-2-of-3 "المجموعة"
 * structure it doesn't parse, and these particular papers' text layer has
 * scrambled digits (years extract reversed). The result already in the
 * database for most years is the marking SCHEME misfiled as the question
 * STATEMENT, sometimes duplicated 2-3x under different source_ref hashes -
 * confirmed by reading scripts/corpus/exams_history_lh/*.json's source
 * papers directly and comparing to what was already stored.
 *
 * Reads every scripts/corpus/exams_history_lh/<year>-<session>.json (hand
 * transcribed from the papers in corpus/exams/lh, chapters assigned from
 * direct knowledge of the syllabus, not embedding-similarity inference).
 * For each track whose تاريخ exam_cycle already exists for that year/session
 * (created earlier by extract_exams.py, however badly parsed), deletes its
 * existing questions and inserts the hand-transcribed set instead. Never
 * creates a new track's cycle - if extract_exams.py never saw a paper for
 * that track, this does not guess one into existence.
 *
 * Embeddings are left null; `npm run ingest -- --embed-missing` fills them
 * in afterwards, same as every other content in this corpus.
 */

import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();
const ROOT = path.resolve(__dirname, '..', '..');
const DIR = path.join(ROOT, 'scripts', 'corpus', 'exams_history_lh');
const SUBJECT_NAME = 'تاريخ';

type QuestionSpec = {
  index: number;
  chapter: string;
  statement: string;
  answer: string;
  marks: number;
};
type PaperSpec = { year: number; session: string; questions: QuestionSpec[] };

async function main() {
  const dry = process.argv.includes('--dry');
  // `--paper 2023-1` loads one file. Without it every paper is deleted and
  // re-inserted, and a student's attempts on those questions go with them.
  const paper = process.argv.includes('--paper') ? process.argv[process.argv.indexOf('--paper') + 1] : null;
  const files = (await readdir(DIR)).filter((f) => f.endsWith('.json') && (!paper || f === `${paper}.json`));
  if (!files.length) {
    console.log('no papers in ' + DIR);
    return;
  }

  const tracks = await db.track.findMany({ select: { id: true, code: true } });

  let papers = 0;
  let inserted = 0;
  let deleted = 0;
  const missingChapters = new Set<string>();

  for (const file of files.sort()) {
    const spec: PaperSpec = JSON.parse(await readFile(path.join(DIR, file), 'utf8'));
    papers += 1;

    for (const track of tracks) {
      const subject = await db.subject.findFirst({
        where: { trackId: track.id, name: SUBJECT_NAME, language: 'ar' },
        select: { id: true },
      });
      if (!subject) continue;

      const cycle = await db.examCycle.findUnique({
        where: {
          subjectId_year_session_language: {
            subjectId: subject.id,
            year: spec.year,
            session: spec.session,
            language: 'ar',
          },
        },
        select: { id: true },
      });
      if (!cycle) continue; // extract_exams.py never saw a paper for this track - don't invent one

      const chapters = await db.chapter.findMany({
        where: { subjectId: subject.id },
        select: { id: true, name: true },
      });
      const chapterByName = new Map(chapters.map((c) => [c.name, c.id]));

      const existing = await db.question.count({ where: { sourceExamId: cycle.id } });

      if (!dry) {
        const del = await db.question.deleteMany({ where: { sourceExamId: cycle.id } });
        deleted += del.count;
      } else {
        deleted += existing;
      }

      for (const q of spec.questions) {
        const chapterId = chapterByName.get(q.chapter);
        if (!chapterId) {
          missingChapters.add(`${track.code}: ${q.chapter}`);
          continue;
        }
        const sourceRef = createHash('sha256')
          .update(`history-manual:${track.code}:${spec.year}:${spec.session}:${q.index}`)
          .digest('hex');

        if (!dry) {
          const written = await db.question.upsert({
            where: { sourceRef },
            update: {
              chapterId,
              contentText: q.statement,
              officialSolution: q.answer,
              bareme: [{ criterion: 'العلامة الكاملة', points: q.marks }],
              orderIndex: q.index,
            },
            create: {
              chapterId,
              sourceType: 'past_exam',
              sourceExamId: cycle.id,
              sourceRef,
              questionType: 'open',
              contentText: q.statement,
              officialSolution: q.answer,
              bareme: [{ criterion: 'العلامة الكاملة', points: q.marks }],
              orderIndex: q.index,
              verifiedStatus: 'unverified',
            },
            select: { id: true },
          });
          // Practice and quizzes find a question through question_chapters;
          // without its home row it is invisible there.
          await db.$executeRaw`
            INSERT INTO question_chapters (question_id, chapter_id)
            VALUES (${written.id}::uuid, ${chapterId}::uuid)
            ON CONFLICT DO NOTHING`;
        }
        inserted += 1;
      }
    }
  }

  console.log(`${papers} paper(s), ${deleted} old question row(s) removed, ${inserted} written${dry ? ' (dry run)' : ''}`);
  if (missingChapters.size) {
    console.log('\nNo chapter row for:');
    for (const m of missingChapters) console.log('  ' + m);
  }
  console.log('\nNext: npm run ingest -- --embed-missing');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
