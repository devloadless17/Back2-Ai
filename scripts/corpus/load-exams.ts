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

/**
 * Filename token -> the subject name(s) as seeded from the textbooks.
 *
 * More than one name per language, because the seeded name is whatever the
 * BOOK calls the subject and that is not always what this table guessed. Every
 * Arabic-medium subject was seeded from its Arabic title — فلسفة عامة, تاريخ,
 * أدب عربي — while this table asked for Philosophie, Histoire and Arabe. The
 * lookup missed on all seven of them, and the loader skipped roughly 630
 * exercises per run with nothing but a line in its skip report to show for it:
 * philosophy alone still holds 430 unmarkable questions.
 *
 * Both spellings are kept rather than the Arabic one substituted. Which name a
 * deployment seeded depends on which taxonomy run created its subjects, and a
 * table that only knows the current answer breaks the moment that changes back.
 */
const SUBJECTS: { match: RegExp; name: Record<string, string | string[]> }[] = [
  { match: /(?:^|[\s_-])(?:math|riyad)/i, name: { en: 'Mathematics', fr: 'Mathematiques' } },
  { match: /(?:^|[\s_-])(?:phys?|fizi)/i, name: { en: 'Physics', fr: 'Physique' } },
  { match: /(?:^|[\s_-])(?:chem|chim|kimi)/i, name: { en: 'Chemistry', fr: 'Chimie' } },
  { match: /(?:^|[\s_-])(?:bio|svt|ahya)/i, name: { en: 'Life Sciences', fr: 'Sciences de la vie' } },
  { match: /(?:^|[\s_-])(?:falsafe|philo)/i, name: { ar: ['فلسفة عامة', 'Philosophie'] } },
  { match: /(?:^|[\s_-])(?:geo|greo)/i, name: { ar: ['جغرافيا', 'Geographie'] } },
  { match: /(?:^|[\s_-])(?:ejteme|ejtema|socio)/i, name: { ar: ['اجتماع', 'Sociologie'] } },
  { match: /(?:^|[\s_-])(?:ektesad|eqtesad|econo)/i, name: { ar: ['اقتصاد', 'Economie'] } },
  { match: /(?:^|[\s_-])(?:tarbeya|tarbia)/i, name: { ar: ['تربية وطنية', 'Education civique'] } },
  { match: /(?:^|[\s_-])(?:tarekh|terekh|tarikh|history|hsitory)/i, name: { ar: ['تاريخ', 'Histoire'] } },
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
  { match: /(?:^|[\s_-])(?:arabe|arabic|arabeye|ar)(?:[\s_-]|$)/i, name: { ar: ['أدب عربي', 'Arabe'] } },
];

/**
 * A Brevet paper, which this product does not teach and must never file.
 *
 * CRDP publishes the Brevet — الشهادة المتوسطة, sat at the end of grade 9 —
 * from the same index page as the Baccalaureate, and `fetch_crdp.py` pulled 54
 * of them into corpus/crdp-inbox before it learned to filter on the
 * certificate. None has ever been loaded. The risk is not that the loader
 * mis-parses them: it is that they parse perfectly. A Brevet mechanics question
 * is a well-formed physics question, and filed against a Baccalaureate chapter
 * it becomes exam practice three years below the syllabus, indistinguishable in
 * the app from the real thing.
 *
 * So this is a guard against one careless bulk move of that folder, and it sits
 * in the loader rather than only in the fetcher because the fetcher protects
 * downloads while this protects the database. It matches the filename, which is
 * all the loader has: by the time a paper reaches here its CRDP sidecar — the
 * title that actually names the certificate — is long out of scope. Those two
 * signals were checked against each other on all 248 papers held and agreed on
 * every one.
 */
const BREVET = /(?:^|[/\\_-])BR_|brevet/i;

/**
 * The most one exercise of a paper marked out of twenty can be worth.
 *
 * Twenty exactly, not a margin above it: an exercise worth the whole paper is
 * already the limit of believable, and every value seen above it — 45, 90, 173
 * — came from a misparse rather than from a generous examiner.
 */
const MAX_EXERCISE_MARKS = 20;

/**
 * Which language a paper is set in.
 *
 * The filename first, because when it says, it is authoritative. Then the paper
 * itself: `extract_exams.py` reads the language off the text — Arabic by script,
 * French and English by function words — which recovers the eighty-odd papers
 * whose names carry no marker at all ("phy_dr.pdf" says nothing). Only then the
 * fallback of a subject that exists in one language anyway.
 */
function languageOf(file: string, available: string[], detected?: string): Language | null {
  if (/(?:^|[\s_-])(?:en|eng|english)(?:[\s_-]|$)/i.test(file) && available.includes('en')) return 'en';
  if (/(?:^|[\s_-])(?:fr|french|francais)(?:[\s_-]|$)/i.test(file) && available.includes('fr')) return 'fr';
  if (/(?:^|[\s_-])(?:ar|arabe|arabic)(?:[\s_-]|$)/i.test(file) && available.includes('ar')) return 'ar';
  if (detected && available.includes(detected)) return detected as Language;
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
  /** Read off the paper's own text when its name does not say. */
  language?: string;
  /** The text printed on the paper, for the papers that examine one. */
  passage?: string;
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

/**
 * One criterion covering a whole exercise, for a paper that says what the
 * exercise is worth without saying how it splits.
 *
 * 1,953 of 3,360 exercises are in this position — 13,646 sub-questions — and
 * they are the whole of the remaining barème gap. Only 107 exercises state
 * nothing at all. So the marks were never missing; the SPLIT was.
 *
 * The obvious move is to divide the total evenly over the parts, and it is
 * wrong. It invents a weighting — a sub-question worth half a mark and one
 * worth three and a half would both be given two — and it would pass the
 * existing sum check without any difficulty, because an even split sums to the
 * stated total by construction. That is the guard being satisfied while its
 * purpose is defeated, which is a worse state than having no guard.
 *
 * So nothing is split. The exercise carries one criterion worth exactly what
 * the paper says the exercise is worth, and the marker judges it whole. The
 * sub-questions are listed inside the criterion so the marker can still see
 * the structure it is marking against; they simply do not carry points of
 * their own, because nobody told us what those points are.
 *
 * The cost is real and worth stating: feedback is per exercise rather than per
 * part. The alternative on offer was no score at all for half the papers.
 */
function wholeExerciseCriterion(exercise: Exercise): string {
  const parts = exercise.parts
    .map((p) => clean(`${p.label} ${p.text}`))
    .filter(Boolean)
    .join('\n');
  const title = clean(exercise.title || exercise.statement);
  return clean(parts ? `${title}\n${parts}` : title).slice(0, 2000);
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
  let written = 0;
  let revised = 0;
  let adopted = 0;
  let withSolution = 0;
  let withBareme = 0;
  let withPassage = 0;
  /** Barèmes carrying one criterion for the whole exercise, not one per part. */
  let wholeExercise = 0;
  /** Exercises scored out of less than the paper says they are worth. */
  let understated = 0;
  /** Barèmes refused because their total cannot be right. */
  let implausible = 0;
  /** Exercises whose unmarked parts were given the shortfall as one criterion. */
  let completed = 0;

  /*
   * What this run produced, for the reconciliation at the end.
   *
   * A ref is an exercise's identity. A cycle is a paper's. Both are needed:
   * absence from `seenRefs` only means "not produced this run", which is
   * indistinguishable from "its paper was skipped this run" unless the paper is
   * known to have been read.
   */
  const seenRefs = new Set<string>();
  const touchedCycles = new Set<string>();

  for (const exam of exams) {
    if (BREVET.test(exam.file) || BREVET.test(exam.path)) {
      note('Brevet (grade 9), not the Baccalaureate');
      continue;
    }
    const subject = SUBJECTS.find((s) => s.match.test(exam.file));
    if (!subject) {
      note('subject not in the table (history, Arabic literature, …)');
      continue;
    }
    const language = languageOf(exam.file, Object.keys(subject.name), exam.language);
    if (!language) {
      note('language not stated in the filename');
      continue;
    }
    const candidates = [subject.name[language] ?? []].flat();
    if (!candidates.length) {
      note(`no ${language} variant of this subject`);
      continue;
    }
    const subjectName = candidates[0]!;

    const track = await db.track.findUnique({ where: { code: exam.track }, select: { id: true } });
    if (!track) {
      note(`unknown track ${exam.track}`);
      continue;
    }
    const subjectRow = await db.subject.findFirst({
      where: { trackId: track.id, name: { in: candidates }, language },
      select: { id: true },
    });
    if (!subjectRow) {
      note(`${candidates.join(' / ')} (${language}) is not seeded for ${exam.track}`);
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
      touchedCycles.add(cycle.id);
      cycles += 1;
    }

    for (const [order, exercise] of exam.exercises.entries()) {
      const statement = clean([exercise.title, exercise.statement].filter(Boolean).join('\n'));
      /*
       * The paper's own text, carried onto every question from that paper.
       *
       * Per question rather than per paper because that is how it gets read: a
       * student is looking at one question, and the tutor needs the extract
       * that question is about without a join through a table that does not
       * exist. It is the same text on each, and a comprehension paper sets four
       * or five questions, so the duplication is small and the alternative is a
       * second table for no gain.
       */
      const passage = exam.passage?.trim() ? clean(exam.passage).slice(0, 12000) : null;

      if (statement.length < 80) {
        note('exercise statement too short to be usable');
        continue;
      }

      const answered = exercise.parts.filter((p) => p.answer);
      const solution = answered.length ? clean(answered.map((p) => `${p.label} ${p.answer}`).join('\n')) : null;
      const perPart = exercise.parts
        .filter((p) => typeof p.marks === 'number')
        .map((p) => ({ criterion: clean(`${p.label} ${p.text}`).slice(0, 300), points: p.marks as number }));

      // Per-part marks where the paper gives them; otherwise the exercise as a
      // whole, worth what its header states. See `wholeExerciseCriterion`.
      const bareme =
        perPart.length > 0
          ? perPart
          : exercise.marks > 0
            ? [{ criterion: wholeExerciseCriterion(exercise), points: exercise.marks }]
            : [];

      /*
       * An exercise whose parts carry only SOME of its marks was scored out of
       * those marks rather than out of what the paper says it is worth. Four
       * points of exercise with two points of criteria marked the student out
       * of two — their total came back wrong and nothing on screen explained
       * why. 520 exercises were in that state.
       *
       * The shortfall is not invented: the paper states the exercise total and
       * the parts state their own marks, so the difference is arithmetic. What
       * is unknown is only how it divides among the parts that printed no mark,
       * so it is not divided — those parts are named in one criterion worth the
       * remainder, the same refusal to guess a weighting that
       * `wholeExerciseCriterion` makes.
       *
       * Only when there ARE unmarked parts to attach it to. A shortfall with
       * every part already marked means a mark was misread somewhere, and
       * inventing a criterion for it would paper over that.
       */
      if (perPart.length > 0 && exercise.marks > 0) {
        const covered = perPart.reduce((sum, c) => sum + c.points, 0);
        const missing = exercise.marks - covered;
        const unmarked = exercise.parts.filter((p) => typeof p.marks !== 'number');
        if (missing > 0.01 && unmarked.length > 0) {
          bareme.push({
            criterion: clean(unmarked.map((p) => `${p.label} ${p.text}`).join('\n')).slice(0, 2000),
            points: Math.round(missing * 100) / 100,
          });
          completed += 1;
        }
      }

      /*
       * A barème that adds up to more than the paper does is not a barème.
       *
       * A Lebanese paper is marked out of twenty and an exercise is a part of
       * one, so an exercise worth 173 — the worst of these — is a misparse: a
       * page number read as an award, a mark column counted twice, a header
       * whose bracketed number was something else. 229 questions were already
       * stored that way before this change and 63 more arrived with it.
       *
       * Dropped rather than clamped. Clamping to twenty would turn an
       * unrecognised number into a confident wrong one, and the student is
       * shown a mark either way. Refusing leaves the question unmarkable,
       * which is what it honestly is, and the count is printed.
       */
      const total = bareme.reduce((sum, c) => sum + c.points, 0);
      if (bareme.length && (total <= 0 || total > MAX_EXERCISE_MARKS)) {
        implausible += 1;
        bareme.length = 0;
      }

      questions += 1;
      if (solution) withSolution += 1;
      if (bareme.length) withBareme += 1;
      if (!perPart.length && bareme.length) wholeExercise += 1;

      /*
       * An exercise whose parts carry SOME of its marks is scored out of those
       * marks and not out of what the paper says it is worth. Four points'
       * worth of exercise with two points of criteria reads to the student as
       * a mark out of two, and to the exam simulation as an exercise worth two.
       *
       * Not fixed here, because the honest fix is the same one refused above —
       * inventing where the missing marks belong. Reported so the size of it is
       * known rather than discovered by a student whose total does not add up.
       */
      if (perPart.length > 0 && exercise.marks > 0) {
        const covered = perPart.reduce((sum, c) => sum + c.points, 0);
        if (covered < exercise.marks - 0.01) understated += 1;
      }
      if (passage) withPassage += 1;
      // Counted before the dry-run exit, so --dry reports what it would write
      // rather than reporting zero.
      if (dry) continue;

      /*
       * Identity: this paper, this exercise, this part. Stable across re-runs,
       * and in particular stable across improvements to the parser.
       *
       * The text itself used to serve as the key, which quietly broke every
       * time extraction got better. Correcting 70 statements produced 70 new
       * questions sitting beside the 70 worse copies they were meant to
       * replace, because a corrected statement matches nothing.
       *
       * Scoped by the paper's own hash, so the same exam filed under two tracks
       * still gets one row per track: `subjectRow` differs, and so does the
       * chapter each track files it against.
       */
      const ref = createHash('sha256')
        .update(`${subjectRow.id}:${exam.sha256}:${exercise.index}:${order}`)
        .digest('hex');
      seenRefs.add(ref);

      /*
       * Checked before the embedding below, not after it. Finding the chapter
       * costs one embedding call per exercise, and re-running this over a
       * corpus that is already loaded — which is what happens whenever a new
       * book unblocks a subject — would otherwise pay to embed all of them
       * again to discover there was nothing to write.
       */
      const known = await db.$queryRaw<
        {
          id: string;
          content_text: string;
          official_solution: string | null;
          bareme: unknown;
          source_passage: string | null;
        }[]
      >`
        SELECT id, content_text, official_solution, bareme, source_passage
        FROM questions WHERE source_ref = ${ref} LIMIT 1
      `;
      if (known.length) {
        /*
         * Re-extraction improved it: correct the question in place rather than
         * adding a second one and leaving a student to meet whichever wins.
         *
         * The solution and the barème are compared as well as the statement.
         * Comparing the statement alone meant a parser that learned to read a
         * new kind of marking scheme changed nothing: the philosophy questions
         * already existed with the same wording, so 921 of them kept their
         * empty solution while the extractor was producing one for each.
         */
        const priorBareme = JSON.stringify(known[0]!.bareme ?? null);
        const nextBareme = JSON.stringify(bareme.length ? bareme : null);
        if (
          known[0]!.content_text !== statement ||
          (known[0]!.official_solution ?? null) !== solution ||
          priorBareme !== nextBareme ||
          (known[0]!.source_passage ?? null) !== passage
        ) {
          await db.$executeRaw`
            UPDATE questions
            SET content_text = ${statement},
                official_solution = ${solution},
                bareme = ${bareme.length ? JSON.stringify(bareme) : null}::jsonb,
                source_passage = ${passage},
                embedding = NULL
            WHERE id = ${known[0]!.id}::uuid
          `;
          revised += 1;
        }
        continue;
      }

      /*
       * Adoption pass, for the rows written before this key existed.
       *
       * Without it the first run under the new scheme would treat the entire
       * corpus as unseen and load a second copy of all of it. A row whose text
       * matches exactly is the same exercise; it gets stamped and from then on
       * is updated rather than duplicated.
       */
      const adoptable = await db.question.findFirst({
        where: { contentText: statement, sourceRef: null, chapter: { subjectId: subjectRow.id } },
        select: { id: true },
      });
      if (adoptable) {
        await db.$executeRaw`UPDATE questions SET source_ref = ${ref} WHERE id = ${adoptable.id}::uuid`;
        adopted += 1;
        continue;
      }

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

      const created = await db.question.create({
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
      /*
       * Written by raw SQL beside source_ref rather than through the generated
       * client. Both are columns the client's types can lag behind — `prisma
       * generate` cannot run while a dev server holds the query engine — and a
       * corpus load must not depend on whether somebody restarted it.
       */
      await db.$executeRaw`
        UPDATE questions SET source_ref = ${ref}, source_passage = ${passage}
        WHERE id = ${created.id}::uuid
      `;
      written += 1;
    }
  }

  console.log('');
  console.log(`  papers read              ${exams.length}`);
  console.log(`  exam cycles              ${cycles}`);
  console.log(`  exercises in the corpus   ${questions}`);
  if (!dry) {
    console.log(`  newly written             ${written}`);
    console.log(`  corrected in place        ${revised}`);
    console.log(`  adopted (already present) ${adopted}`);
  }
  console.log(`  with an official solution ${withSolution}`);
  console.log(`  with a barème             ${withBareme}`);
  console.log(`    of those, marked whole  ${wholeExercise}   (paper states a total, not a split)`);
  console.log(`  with the paper's passage  ${withPassage}`);
  if (completed) {
    console.log(`  shortfall given to the unmarked parts ${completed}   (was scored out of less than the paper says)`);
  }
  if (implausible) {
    console.log(`  barème refused, total impossible ${implausible}   (over ${MAX_EXERCISE_MARKS} marks, or zero)`);
  }
  if (understated) {
    console.log(`  scored out of less than the paper says ${understated}   (some parts carry marks, some do not)`);
  }
  /*
   * Rows the extractor has stopped producing.
   *
   * Re-extraction gets better, and getting better means some exercises are
   * correctly no longer produced — an "exercise" that was really a marking
   * scheme, a statement that was mostly answer key. This loader only ever
   * inserts and updates, so those rows sat on in the database, retrievable and
   * answerable, while the file they came from had been cleaned. Fixing
   * `exams.json` and leaving the database is fixing it for nobody.
   *
   * Scoped to cycles this run actually read. A ref missing from a partial run
   * means nothing, so a limited or dry run does not reconcile at all — the
   * alternative is a `--limit 20` retiring the other 5,000 questions.
   *
   * Nothing is deleted, following `retire-superseded`: the rows are marked
   * `rejected`, which retrieval, practice and exam composition already skip, so
   * no attempt or simulation loses the row it points at and the change is one
   * UPDATE from being undone.
   */
  if (!dry && !limit && touchedCycles.size > 0) {
    const stale = await db.question.findMany({
      where: {
        sourceType: 'past_exam',
        sourceExamId: { in: [...touchedCycles] },
        sourceRef: { not: null },
        verifiedStatus: { not: 'rejected' },
      },
      select: { id: true, sourceRef: true, contentText: true },
    });
    const gone = stale.filter((q) => q.sourceRef && !seenRefs.has(q.sourceRef));

    if (gone.length > 0) {
      await db.question.updateMany({
        where: { id: { in: gone.map((q) => q.id) } },
        data: { verifiedStatus: 'rejected' },
      });
    }
    console.log('');
    console.log(`  retired, no longer extracted ${gone.length}`);
    for (const question of gone.slice(0, 3)) {
      console.log(`    ${question.contentText.replace(/\s+/g, ' ').slice(0, 70)}`);
    }
  }

  if (skipped.size) {
    console.log('');
    console.log('  skipped:');
    for (const [reason, count] of [...skipped].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(count).padStart(5)}  ${reason}`);
    }
  }

  /*
   * A corrected question has its embedding cleared, because the old vector
   * describes text that no longer exists. Until it is recomputed the row is
   * invisible to every search in the system, and nothing anywhere says so —
   * which is how a run that improved 1,067 questions also removed all of them
   * from retrieval, and how LS philosophy came to hold 78 barèmes that the
   * essay path could not find one of.
   *
   * `load-chunks.ts` prints this for the same reason. Both loaders write rows
   * that are not searchable yet, and both should say what the next step is.
   */
  if (!dry) {
    const [pending] = await db.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) AS count FROM questions WHERE embedding IS NULL
    `;
    const waiting = Number(pending?.count ?? 0);
    console.log('');
    console.log(`  ${waiting} question(s) await an embedding and cannot be retrieved until they have one.`);
    if (waiting > 0) console.log('  Next:  npm run ingest -- --embed-missing');
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
