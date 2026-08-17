/**
 * corpus/exams.json -> exam_cycles + questions, with their barème.
 *
 *   npm run corpus:exams -- --dry        plan only, writes nothing
 *   npm run corpus:exams                 load everything
 *
 * Reads what scripts/corpus/extract_exams.py pulled out of the official papers
 * and files each exercise as a question under the chapter it belongs to.
 *
 * Two judgements are made here, and both are worth stating plainly.
 *
 * WHICH SUBJECT. The filenames are Lebanese written in Latin letters and are
 * not consistent — ehteyejet/ehtiyejet/ehteuejet, makfufin/makfoufen/makfofen,
 * tarekh/terekh, plus hsitory and greo. So a filename only maps to a subject
 * through an explicit table, and a paper whose subject is not in that table is
 * skipped rather than guessed at. A subject with no seeded rows is skipped for
 * the same reason — which is why adding a textbook is what unblocks its papers,
 * not a change here.
 *
 * WHICH CHAPTER. An exam paper does not say. The chapter is inferred by
 * embedding the exercise and taking the chapter of the course material nearest
 * to it, which is far better than filing everything under chapter one. It is recorded as `unverified`,
 * because an inferred chapter is a claim about the syllabus that a teacher
 * should confirm — and because tier 1 answers from these questions' official
 * solutions, so a mis-filed one is a wrong answer waiting to happen.
 *
 * Idempotent: an exercise's identity is the hash of its paper plus its position,
 * so re-running updates rather than duplicating.
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { PrismaClient, type Language, type QuestionType } from '@prisma/client';

import { embed } from '../../src/lib/ai/embeddings';

const db = new PrismaClient();
const ROOT = path.resolve(__dirname, '..', '..');
const EXAMS_JSON = path.join(ROOT, 'corpus', 'exams.json');

/** Filename token -> the subject name as seeded from the textbooks. */
const SUBJECTS: { match: RegExp; name: Record<string, string> }[] = [
  { match: /(?:^|[\s_-])(?:math|riyad)/i, name: { en: 'Mathematics', fr: 'Mathematiques' } },
  { match: /(?:^|[\s_-])(?:phys?|fizi)/i, name: { en: 'Physics', fr: 'Physique' } },
  { match: /(?:^|[\s_-])(?:chem|chim|kimi)/i, name: { en: 'Chemistry', fr: 'Chimie' } },
  { match: /(?:^|[\s_-])(?:bio|svt|ahya)/i, name: { en: 'Life Sciences', fr: 'Sciences de la vie' } },
  { match: /(?:^|[\s_-])falsafe/i, name: { ar: 'Philosophie' } },
  { match: /(?:^|[\s_-])(?:geo|greo)/i, name: { ar: 'Geographie' } },
  { match: /(?:^|[\s_-])(?:ejteme|ejtema)/i, name: { ar: 'Sociologie' } },
  { match: /(?:^|[\s_-])tarbeya/i, name: { ar: 'Education civique' } },
  { match: /(?:^|[\s_-])(?:tarekh|terekh|history|hsitory)/i, name: { ar: 'Histoire' } },
  { match: /(?:^|[\s_-])(?:eng|english|emg)/i, name: { en: 'English' } },
  { match: /(?:^|[\s_-])(?:fr|french|francais)/i, name: { fr: 'Francais' } },
  /*
   * Arabic language, last on purpose.
   *
   * "ar" is also the language marker on an Arabic-medium science paper —
   * bio_ar, phy_ar, chem_ar — and those are biology and physics papers, not
   * Arabic-language ones. The sciences are matched first above, so by the time
   * a filename reaches this line the only thing "ar" can mean is the subject.
   */
  { match: /(?:^|[\s_-])(?:arabe|arabic|arabeye|ar)(?:[\s_-]|$)/i, name: { ar: 'Arabe' } },
];

/** Language marker in the filename; Arabic-only subjects default to ar. */
function languageOf(file: string, available: string[]): Language | null {
  if (/(?:^|[\s_-])(?:en|eng|english)(?:[\s_-]|$)/i.test(file) && available.includes('en')) return 'en';
  if (/(?:^|[\s_-])(?:fr|french|francais)(?:[\s_-]|$)/i.test(file) && available.includes('fr')) return 'fr';
  if (/(?:^|[\s_-])(?:ar|arabe|arabic)(?:[\s_-]|$)/i.test(file) && available.includes('ar')) return 'ar';
  return available.length === 1 ? (available[0] as Language) : null;
}

type Part = { label: string; text: string; answer?: string; marks?: number };
type Exercise = { index: number; marks: number; title: string; statement: string; parts: Part[] };
type Exam = {
  path: string;
  sha256: string;
  track: string;
  session: string;
  file: string;
  totalMarks: number;
  answersFound: number;
  exercises: Exercise[];
};

/**
 * PDF text extraction occasionally yields a NUL byte, and Postgres rejects it
 * outright — one such character in one paper aborted the whole load. Other C0
 * controls carry no meaning in a question statement either, so they go too;
 * tabs and newlines stay because the layout of a maths question depends on them.
 */
const TAB = 9;
const NEWLINE = 10;
const FIRST_PRINTABLE = 32;

function clean(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    const control = code < FIRST_PRINTABLE && code !== NEWLINE && code !== TAB;
    out += control ? ' ' : ch;
  }
  return out.trim();
}

function yearOf(session: string): number | null {
  const m = /(20\d\d)/.exec(session);
  return m ? Number(m[1]) : null;
}

function sessionOf(session: string): string {
  return /\s2$/.test(session) ? 'session2' : 'session1';
}

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry');
  const limit = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : 0;

  /*
   * Re-file existing questions against the current chapter list.
   *
   * A question's chapter is inferred, and the inference is only as good as the
   * chapter list it ran against. When that list changes underneath it — as it
   * did when two books sharing a subject stopped overwriting each other, and
   * GS mathematics went from 24 chapters to 44 — every question filed under
   * that subject is pointing at a row whose name has since changed. Nothing
   * errors; the question simply sits under the wrong chapter, and mastery for
   * that chapter is quietly wrong.
   *
   * This recomputes the assignment for one subject, or for all of them.
   */
  if (args.includes('--refile')) {
    const only = args.includes('--subject') ? args[args.indexOf('--subject') + 1] : null;
    const questions = await db.question.findMany({
      where: {
        sourceType: 'past_exam',
        ...(only ? { chapter: { subject: { name: only } } } : {}),
      },
      select: { id: true, contentText: true, chapter: { select: { subjectId: true, name: true } } },
    });

    let moved = 0;
    for (const question of questions) {
      const vector = await embed(question.contentText.slice(0, 4000), 'query');
      const nearest = await db.$queryRaw<{ chapter_id: string; name: string }[]>`
        SELECT ch.id AS chapter_id, ch.name
        FROM content_chunks cc
        JOIN chapter_content_chunks l ON l.chunk_id = cc.id
        JOIN chapters ch ON ch.id = l.chapter_id
        WHERE ch.subject_id = ${question.chapter.subjectId}::uuid AND cc.embedding IS NOT NULL
        ORDER BY cc.embedding <=> ${`[${vector.join(',')}]`}::vector
        LIMIT 1
      `;
      const target = nearest[0];
      if (!target || target.name === question.chapter.name) continue;
      await db.question.update({ where: { id: question.id }, data: { chapterId: target.chapter_id } });
      moved += 1;
    }

    console.log('');
    console.log(`${questions.length} question(s) checked, ${moved} moved to a different chapter.`);
    return;
  }

  let exams: Exam[];
  try {
    exams = JSON.parse(await readFile(EXAMS_JSON, 'utf8')) as Exam[];
  } catch {
    console.error('corpus/exams.json not found — run: python scripts/corpus/extract_exams.py');
    process.exitCode = 1;
    return;
  }
  if (limit) exams = exams.slice(0, limit);

  // Chapter lookup by nearest course material, cached per subject.
  const chapterCache = new Map<string, { id: string; name: string }[]>();

  const skipped = new Map<string, number>();
  const note = (reason: string) => skipped.set(reason, (skipped.get(reason) ?? 0) + 1);

  let cycles = 0;
  let questions = 0;
  let withSolution = 0;
  let withBareme = 0;

  for (const exam of exams) {
    const subject = SUBJECTS.find((s) => s.match.test(exam.file));
    if (!subject) {
      note('subject not in the table (history, Arabic literature, …)');
      continue;
    }
    const language = languageOf(exam.file, Object.keys(subject.name));
    if (!language) {
      note('language not stated in the filename');
      continue;
    }
    const subjectName = subject.name[language];
    if (!subjectName) {
      note(`no ${language} variant of this subject`);
      continue;
    }

    const track = await db.track.findUnique({ where: { code: exam.track }, select: { id: true } });
    if (!track) {
      note(`unknown track ${exam.track}`);
      continue;
    }
    const subjectRow = await db.subject.findFirst({
      where: { trackId: track.id, name: subjectName, language },
      select: { id: true },
    });
    if (!subjectRow) {
      note(`${subjectName}/${language} is not seeded for ${exam.track}`);
      continue;
    }

    const year = yearOf(exam.session);
    if (!year) {
      note('no year in the folder name');
      continue;
    }

    if (!chapterCache.has(subjectRow.id)) {
      chapterCache.set(
        subjectRow.id,
        await db.chapter.findMany({
          where: { subjectId: subjectRow.id },
          select: { id: true, name: true },
          orderBy: { orderIndex: 'asc' },
        }),
      );
    }
    const chapters = chapterCache.get(subjectRow.id)!;
    if (!chapters.length) {
      note(`${subjectName}/${language} has no chapters`);
      continue;
    }

    let cycleId: string | null = null;
    if (!dry) {
      const cycle = await db.examCycle.upsert({
        where: {
          subjectId_year_session: { subjectId: subjectRow.id, year, session: sessionOf(exam.session) },
        },
        update: {},
        create: {
          subjectId: subjectRow.id,
          year,
          session: sessionOf(exam.session),
          title: `${subjectName} ${exam.track} ${year} — ${sessionOf(exam.session) === 'session2' ? 'session 2' : 'session 1'}`,
        },
        select: { id: true },
      });
      cycleId = cycle.id;
      cycles += 1;
    }

    for (const [order, exercise] of exam.exercises.entries()) {
      const statement = clean([exercise.title, exercise.statement].filter(Boolean).join('\n'));
      if (statement.length < 80) {
        note('exercise statement too short to be usable');
        continue;
      }

      const answered = exercise.parts.filter((p) => p.answer);
      const solution = answered.length ? clean(answered.map((p) => `${p.label} ${p.answer}`).join('\n')) : null;
      const bareme = exercise.parts
        .filter((p) => typeof p.marks === 'number')
        .map((p) => ({ criterion: clean(`${p.label} ${p.text}`).slice(0, 300), points: p.marks }));

      questions += 1;
      if (solution) withSolution += 1;
      if (bareme.length) withBareme += 1;
      // Counted before the dry-run exit, so --dry reports what it would write
      // rather than reporting zero.
      if (dry) continue;

      /*
       * Already loaded? Then stop here.
       *
       * Checked before the embedding below, not after it. Finding the chapter
       * costs one embedding call per exercise, and re-running this over a
       * corpus that is already loaded — which is what happens whenever a new
       * book unblocks a subject — would otherwise pay to embed all of them
       * again to discover there was nothing to write.
       *
       * Scoped to this subject: the same paper can legitimately appear under
       * two tracks, and each track files its own copy against its own chapters.
       */
      const alreadyLoaded = await db.question.findFirst({
        where: { contentText: statement, chapter: { subjectId: subjectRow.id } },
        select: { id: true },
      });
      if (alreadyLoaded) continue;

      /*
       * The chapter, inferred. The exercise is embedded once and matched
       * against this subject's own course material; the chapter of the closest
       * passage is the one recorded. Restricted to the subject, so a physics
       * exercise can never land in a chemistry chapter however the wording
       * reads.
       */
      const vector = await embed(statement.slice(0, 4000), 'query');
      const nearest = await db.$queryRaw<{ chapter_id: string; similarity: number }[]>`
        SELECT ch.id AS chapter_id, 1 - (cc.embedding <=> ${`[${vector.join(',')}]`}::vector) AS similarity
        FROM content_chunks cc
        JOIN chapter_content_chunks l ON l.chunk_id = cc.id
        JOIN chapters ch ON ch.id = l.chapter_id
        WHERE ch.subject_id = ${subjectRow.id}::uuid AND cc.embedding IS NOT NULL
        ORDER BY cc.embedding <=> ${`[${vector.join(',')}]`}::vector
        LIMIT 1
      `;
      const chapterId = nearest[0]?.chapter_id ?? chapters[0]!.id;

      // Identity: this paper, this position. Stable across re-runs.
      const ref = createHash('sha256').update(`${exam.sha256}:${exercise.index}:${order}`).digest('hex');

      const existing = await db.$queryRaw<{ id: string }[]>`
        SELECT id FROM questions WHERE content_text = ${statement} AND chapter_id = ${chapterId}::uuid LIMIT 1
      `;
      if (existing.length) continue;

      await db.question.create({
        data: {
          chapterId,
          sourceType: 'past_exam',
          sourceExamId: cycleId,
          questionType: (exercise.parts.length > 1 ? 'problem' : 'open') as QuestionType,
          contentText: statement,
          officialSolution: solution,
          bareme: bareme.length ? bareme : undefined,
          orderIndex: order,
          verifiedStatus: 'unverified',
        },
      });
      void ref;
    }
  }

  console.log('');
  console.log(`  papers read              ${exams.length}`);
  console.log(`  exam cycles              ${cycles}`);
  console.log(`  questions ${dry ? 'to write' : 'written  '}      ${questions}`);
  console.log(`  with an official solution ${withSolution}`);
  console.log(`  with a barème             ${withBareme}`);
  if (skipped.size) {
    console.log('');
    console.log('  skipped:');
    for (const [reason, count] of [...skipped].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(count).padStart(5)}  ${reason}`);
    }
  }
}

main()
  .catch((e) => {
    console.error('Loading exams failed:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
