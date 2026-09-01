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

import { loadSidecars, schemeFor } from './scheme-sidecars';
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
  // The trailing "e" is not always printed: se/2008 2/falsaf.pdf.
  { match: /(?:^|[\s_-])(?:falsafe?|philo)/i, name: { ar: ['فلسفة عامة', 'Philosophie'] } },
  { match: /(?:^|[\s_-])(?:geo|greo)/i, name: { ar: ['جغرافيا', 'Geographie'] } },
  { match: /(?:^|[\s_-])(?:ejteme|ejtema|socio)/i, name: { ar: ['اجتماع', 'Sociologie'] } },
  /*
   * "Eco", not only "econo". The newer CRDP filenames abbreviate it —
   * SE_Eco_2024_1_Fr.pdf — and because "econo" did not match, the language
   * suffix decided the subject instead: two of those were filed as FRENCH
   * papers and one as Arabic literature. A paper landing in the wrong subject
   * is worse than one left out, because it is practised as that subject.
   */
  { match: /(?:^|[\s_-])(?:ektesad|eqtesad|eco(?:no)?)/i, name: { ar: ['اقتصاد', 'Economie'] } },
  { match: /(?:^|[\s_-])(?:tarbeya|tarbia)/i, name: { ar: ['تربية وطنية', 'Education civique'] } },
  { match: /(?:^|[\s_-])(?:tarekh|terekh|tarikh|history|hsitory)/i, name: { ar: ['تاريخ', 'Histoire'] } },
  /*
   * "en" on its own is the subject too — se/2009 1/en.pdf, en_ehteyejet.pdf.
   * Added as a separate alternative REQUIRING a terminator rather than by
   * loosening "eng" to "eng?", so that every filename matching before still
   * matches and only a bare "en" token is new. Elsewhere "en" is the language
   * marker (phy_en, math_en), but the sciences are matched above this line, so
   * by the time a name reaches here "en" can only be the subject.
   */
  { match: /(?:^|[\s_-])(?:eng|english|emg)|(?:^|[\s_-])en(?:[\s_.-]|$)/i, name: { en: 'English' } },
  { match: /(?:^|[\s_-])(?:fr|french|francais)/i, name: { fr: 'Francais' } },
  /*
   * Arabic language, last on purpose.
   *
   * "ar" is also the language marker on an Arabic-medium science paper —
   * bio_ar, phy_ar, chem_ar — and those are biology and physics papers, not
   * Arabic-language ones. The sciences are matched first above, so by the time
   * a filename reaches this line the only thing "ar" can mean is the subject.
   */
  // The terminator admits a full stop, so "arabe.pdf" is Arabic literature.
  // Without it the extension itself disqualified the match, and ten papers
  // named exactly that — ls/2004 2 through ls/2019 1 — had no subject at all.
  { match: /(?:^|[\s_-])(?:arabe|arabic|arabeye|ar)(?:[\s_.-]|$)/i, name: { ar: ['أدب عربي', 'Arabe'] } },
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
/**
 * A barème reduced to something two copies of it can be compared on.
 *
 * NOT `JSON.stringify`. Postgres jsonb does not keep the key order it was
 * given — it stores keys sorted by length, then bytewise — so a barème written
 * as {criterion, points} reads back as {"points":…,"criterion":…} and the two
 * strings never match. The loader used that comparison to decide whether a
 * question had changed, so the answer was always yes: every run rewrote all
 * 3,326 questions carrying a barème and, with them, cleared 3,326 embeddings.
 *
 * That is not merely wasted work. As the note on the re-embedding step below
 * says, a question with no vector is invisible to every search in the system
 * until the backfill runs — so each load silently emptied the corpus of every
 * marked question for as long as it took somebody to notice and re-embed.
 *
 * Positional, and the number is coerced, because 2 and 2.0 are the same mark
 * and jsonb will hand back whichever it stored.
 */
function baremeKey(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return JSON.stringify(
    value.map((c) => {
      const item = c as { criterion?: unknown; points?: unknown };
      return [String(item?.criterion ?? ''), Number(item?.points ?? 0)];
    }),
  );
}

/**
 * What the paper says it is, before anything about what we can store.
 *
 * The filename first, because when it says, it is authoritative. Then the
 * paper's own text, which `extract_exams.py` reads — Arabic by script, French
 * and English by function words — and which recovers the eighty-odd papers
 * whose names carry no marker at all ("phy_dr.pdf" says nothing).
 *
 * Deliberately knows nothing about which subjects exist. That separation is
 * the whole point of splitting this out: the question "what language is this
 * paper in?" has an answer that does not depend on whether we have somewhere
 * to put it.
 */
function statedLanguage(file: string, detected?: string): Language | null {
  if (/(?:^|[\s_-])(?:en|eng|english)(?:[\s_-]|$)/i.test(file)) return 'en';
  if (/(?:^|[\s_-])(?:fr|french|francais)(?:[\s_-]|$)/i.test(file)) return 'fr';
  if (/(?:^|[\s_-])(?:ar|arabe|arabic)(?:[\s_-]|$)/i.test(file)) return 'ar';
  if (detected === 'en' || detected === 'fr' || detected === 'ar') return detected;
  return null;
}

export type LanguagePick =
  | { ok: true; subjectLanguage: Language; paperLanguage: Language }
  /** The paper never said, and the subject exists in more than one language. */
  | { ok: false; reason: 'unstated' };

/**
 * Two languages, because a paper has two and they are not always the same one.
 *
 * `paperLanguage` is the edition in front of you: `SVSG_Philo_2021_1_Fr` is the
 * French printing, whatever else is true. `subjectLanguage` is which subject
 * row it is filed under — the medium the subject is *taught* in.
 *
 * For the sciences they always agree: Chemistry and Chimie are separate
 * subjects, so the French chemistry paper goes into the French subject. For the
 * humanities they do not. Philosophy is taught in Arabic and there is one
 * `فلسفة عامة`; `subjectLanguagesFor('fr')` returns `['fr', 'ar']` precisely so
 * a French-track student is shown it. The CRDP still prints that paper in three
 * languages.
 *
 * Conflating the two is what caused the damage. The old single answer let a
 * `available.length === 1` fallback overrule the filename and the extractor,
 * and every French and English philosophy paper was filed as Arabic — 254 of
 * 1,088 cycles ended up holding more than one language. Splitting them lets the
 * fallback do its real job (choose the only subject that exists) without it
 * having any opinion about what language the paper is written in, which is the
 * one thing it was never entitled to decide.
 */
function languageOf(file: string, available: string[], detected?: string): LanguagePick {
  const stated = statedLanguage(file, detected);

  // The subject side keeps the fallback, which is now safe: it only picks where
  // to file the paper, and can no longer misdescribe what the paper is.
  const subjectLanguage =
    stated && available.includes(stated)
      ? stated
      : available.length === 1
        ? (available[0] as Language)
        : null;

  if (!subjectLanguage) return { ok: false, reason: 'unstated' };

  // If nothing stated a language, the paper is whatever its subject is.
  return { ok: true, subjectLanguage, paperLanguage: stated ?? subjectLanguage };
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
  let fromScheme = 0;
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

  /*
   * The schemes recovered by `corpus:schemes`, if any have been.
   *
   * Read once rather than per paper: there is one small file per paper and a
   * full corpus load walks every paper, so opening the directory each time
   * would be thousands of redundant reads of data that cannot change during
   * the run. An empty directory is the normal case on a machine that has
   * never run the reader, and everything below then behaves as it did before.
   */
  const sidecars = loadSidecars(path.resolve('corpus/schemes'));
  if (sidecars.size > 0) console.log(`  marking schemes on hand    ${sidecars.size} paper(s)`);

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
    const picked = languageOf(exam.file, Object.keys(subject.name), exam.language);
    if (!picked.ok) {
      note('language not stated in the filename');
      continue;
    }
    /*
     * `language` selects the subject; `paperLanguage` stamps the cycle. They
     * differ for every French or English humanities paper, which is the whole
     * point of the split.
     */
    const language = picked.subjectLanguage;
    const paperLanguage = picked.paperLanguage;
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
          subjectId_year_session_language: {
            subjectId: subjectRow.id,
            year,
            session: sessionOf(exam.session),
            language: paperLanguage,
          },
        },
        update: {},
        create: {
          subjectId: subjectRow.id,
          year,
          session: sessionOf(exam.session),
          /*
           * Must match the `where` above.
           *
           * Without it the column falls back to its schema default of `ar`, so
           * a lookup for the French cycle finds nothing, the create inserts an
           * Arabic one, and it collides with the Arabic cycle that already
           * exists — which is exactly how this failed the first time it ran.
           */
          language: paperLanguage,
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

      /*
       * The paper's own marking scheme, where `corpus:schemes` recovered it.
       *
       * Preferred over everything inferred below, and not as a better guess:
       * the text path is trying to RECONSTRUCT this table from marks printed
       * beside the questions, and where a paper prints none it falls back to
       * one criterion covering the whole exercise. 2,221 questions are in that
       * state, which marks a six-part exercise as a single lump and tells a
       * student who got four parts right only that they lost marks somewhere.
       * The scheme is the ministry's own row-by-row version of exactly that.
       *
       * Per exercise, not per paper. A scheme read only in part still gives
       * its exercises to the questions it covered, and the rest fall through
       * to the text path rather than being blanked.
       */
      const sidecar = sidecars.get(exam.sha256);
      const scheme = sidecar ? schemeFor(sidecar, exercise.index, order + 1) : null;

      const answered = exercise.parts.filter((p) => p.answer);
      const solution = scheme?.solution
        ? clean(scheme.solution)
        : answered.length
          ? clean(answered.map((p) => `${p.label} ${p.answer}`).join('\n'))
          : null;
      const perPart = exercise.parts
        .filter((p) => typeof p.marks === 'number')
        .map((p) => ({ criterion: clean(`${p.label} ${p.text}`).slice(0, 300), points: p.marks as number }));

      // Per-part marks where the paper gives them; otherwise the exercise as a
      // whole, worth what its header states. See `wholeExerciseCriterion`.
      const bareme =
        scheme && scheme.bareme.length > 0
          ? scheme.bareme.map((c) => ({ ...c }))
          : perPart.length > 0
            ? perPart
            : exercise.marks > 0
              ? [{ criterion: wholeExerciseCriterion(exercise), points: exercise.marks }]
              : [];
      const baremeFromScheme = Boolean(scheme && scheme.bareme.length > 0);

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
      // Not against a scheme-derived barème. The shortfall rule exists because
      // the text path recovers only SOME parts' marks; a scheme that already
      // reconciled against the exercise total has no shortfall to explain, and
      // inventing a criterion for a rounding difference would corrupt an
      // official reading.
      if (!baremeFromScheme && perPart.length > 0 && exercise.marks > 0) {
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
      if (baremeFromScheme) fromScheme += 1;
      /*
       * A multi-part exercise carrying ONE criterion for the whole of it.
       *
       * Keyed off the barème that was actually stored, not off `perPart`.
       * Keying it off `perPart` measured whether the TEXT path found per-part
       * marks, which stopped being the same question the moment a scheme could
       * supply them instead: 529 exercises went from a single lump to a
       * row-by-row breakdown and this counter did not move, because it was
       * still reporting on a path they no longer take.
       *
       * What matters to a student is whether their marks come back split by
       * part or as one number, so that is what is counted.
       */
      if (bareme.length === 1 && exercise.parts.length > 1) wholeExercise += 1;

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
        const priorBareme = baremeKey(known[0]!.bareme);
        const nextBareme = baremeKey(bareme.length ? bareme : null);

        /*
         * THE EMBEDDING IS CLEARED ONLY WHEN THE STATEMENT CHANGED.
         *
         * The vector is computed from `content_text` and nothing else — see the
         * `embed(statement)` call below. A solution, a barème or a passage can
         * change without moving it by a thousandth, so clearing it for those is
         * not conservative, it is destructive: a question with no vector is
         * invisible to every search in the system until a backfill runs.
         *
         * This file already carries that warning, against the jsonb key-order
         * bug that used to rewrite all 3,326 marked questions every load. That
         * fix corrected the COMPARISON and left the INVALIDATION as wide as it
         * had always been, so the same failure came back through a different
         * door: loading 129 recovered marking schemes changed 528 questions'
         * solutions and barèmes — their statements untouched — and emptied 528
         * valid vectors, taking those questions out of retrieval entirely.
         *
         * Narrow the invalidation to what the vector is actually made of.
         */
        const statementChanged = known[0]!.content_text !== statement;
        const anythingChanged =
          statementChanged ||
          (known[0]!.official_solution ?? null) !== solution ||
          priorBareme !== nextBareme ||
          (known[0]!.source_passage ?? null) !== passage;

        if (anythingChanged) {
          if (statementChanged) {
            await db.$executeRaw`
              UPDATE questions
              SET content_text = ${statement},
                  official_solution = ${solution},
                  bareme = ${bareme.length ? JSON.stringify(bareme) : null}::jsonb,
                  source_passage = ${passage},
                  embedding = NULL
              WHERE id = ${known[0]!.id}::uuid
            `;
          } else {
            await db.$executeRaw`
              UPDATE questions
              SET official_solution = ${solution},
                  bareme = ${bareme.length ? JSON.stringify(bareme) : null}::jsonb,
                  source_passage = ${passage}
              WHERE id = ${known[0]!.id}::uuid
            `;
          }
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
  if (fromScheme > 0) {
    console.log(`    from the paper's own scheme ${fromScheme}   (row by row, on the paper's scale)`);
  }
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

    /*
     * The same exercise, held twice.
     *
     * 946 past-exam rows predate `source_ref`. The loader keys on that ref, so
     * it never matches them, never rewrites them — and the pass above only
     * considers rows that HAVE a ref, so it never retires them either. The
     * adoption pass is supposed to absorb them, but it requires the statement
     * to match EXACTLY, and every improvement to the extractor breaks that
     * match. Each improvement therefore left the old row in place and wrote a
     * fresh keyed one beside it: 459 exercises stored twice, once as the paper
     * reads today and once as it read before the letterhead came out of it.
     *
     * Only a refless row with a keyed TWIN is retired. A refless row with no
     * twin is the only copy of its question — the Arabic-medium science papers
     * have no loadable subject and would be silently deleted by a broader rule
     * — so the twin is the whole justification and is required.
     *
     * Compared on the first 120 characters with whitespace removed, because
     * the two copies differ exactly where the extractor improved: a banner
     * excised, a label re-read. Marked `rejected` rather than deleted, like
     * everything else here, so the 69 attempts pointing at these rows keep the
     * question they were answering.
     */
    const twinned = await db.$executeRaw`
      UPDATE questions a
      SET verified_status = 'rejected'
      WHERE a.source_ref IS NULL
        AND a.source_type = 'past_exam'
        AND a.verified_status <> 'rejected'
        AND EXISTS (
          SELECT 1 FROM questions b
          WHERE b.source_ref IS NOT NULL
            AND b.source_type = 'past_exam'
            AND b.verified_status <> 'rejected'
            AND b.chapter_id = a.chapter_id
            AND left(regexp_replace(b.content_text, '\s+', '', 'g'), 120)
              = left(regexp_replace(a.content_text, '\s+', '', 'g'), 120)
        )
    `;
    if (twinned > 0) {
      console.log(`  retired, superseded by a keyed copy ${twinned}`);
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
