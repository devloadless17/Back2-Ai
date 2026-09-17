import 'server-only';

import { Prisma, type Language } from '@prisma/client';

import { db } from '@/lib/db';

/**
 * Taxonomy reads.
 *
 * Every function here takes the student's `trackId` and filters on it. That is
 * not a convenience — a student's track is locked at signup and determines
 * which curriculum they are entitled to see, so a subject or chapter id
 * arriving from the URL must be checked against it before anything is
 * returned. Passing an id from `params` straight into a `findUnique` is the
 * bug this module exists to prevent.
 */

export type SubjectSummary = {
  id: string;
  name: string;
  language: 'fr' | 'en' | 'ar';
  chapterCount: number;
  questionCount: number;
};

/** Subject ids the student may be served content from. The retrieval scope. */
export async function subjectIdsForTrack(trackId: string | null): Promise<string[]> {
  if (!trackId) return [];
  const subjects = await db.subject.findMany({ where: { trackId }, select: { id: true } });
  return subjects.map((s) => s.id);
}

/**
 * The same scope, narrowed to the language the student is actually taught in.
 *
 * The track alone is not the scope, and treating it as one put every science
 * subject into a student's search twice. A GS student was searching `Chimie`
 * AND `Chemistry` — the same 393-page book in two languages, competing with
 * itself on every query — so a French-medium student could be answered out of
 * the English edition they have never opened.
 *
 * The pairing has to be written down, because the two editions do not share a
 * name: they are `Chimie` and `Chemistry`, not one subject in two languages.
 * Grouping by name was the first attempt and changed nothing at all.
 *
 * Only the sciences are paired. `Francais`, `English` and `Arabe` are subjects
 * in their own right — a GS student sits all three as languages — and the
 * humanities exist only in Arabic. Filtering those by the student's medium
 * would delete their French paper from their own syllabus.
 */
const SAME_SUBJECT: string[][] = [
  ['Mathematics', 'Mathematiques', 'Mathématiques'],
  ['Physics', 'Physique'],
  ['Chemistry', 'Chimie'],
  ['Life Sciences', 'Sciences de la vie', 'Sciences de la Vie'],
];

export async function subjectIdsForStudent(
  trackId: string | null,
  language: Language,
): Promise<string[]> {
  if (!trackId) return [];
  const subjects = await db.subject.findMany({
    where: { trackId },
    select: { id: true, name: true, language: true },
  });

  const groupOf = (name: string) =>
    SAME_SUBJECT.findIndex((names) => names.includes(name));

  const paired = new Map<number, typeof subjects>();
  const scope: string[] = [];

  for (const subject of subjects) {
    const group = groupOf(subject.name);
    if (group < 0) {
      // Not a subject that comes in editions. Always in scope.
      scope.push(subject.id);
      continue;
    }
    paired.set(group, [...(paired.get(group) ?? []), subject]);
  }

  for (const editions of paired.values()) {
    /*
     * The student's medium, or all of them if this track does not offer it.
     * Dropping a science entirely would have the tutor refuse questions the
     * student's own syllabus covers, which is worse than one extra edition.
     */
    const mine = editions.filter((s) => s.language === language);
    scope.push(...(mine.length > 0 ? mine : editions).map((s) => s.id));
  }

  return scope;
}

/**
 * The same scope, named, for a student to choose from.
 *
 * Deliberately built ON TOP of `subjectIdsForStudent` rather than beside it. The
 * scope rules are not obvious — science subjects exist twice, once per language,
 * and the Arabic-taught humanities are always in regardless of medium — and a
 * second query applying its own version of them would drift from the one that
 * governs retrieval. A student must never be offered a subject their questions
 * cannot then be searched against.
 *
 * Ordered by language then name so the list groups the way a student thinks
 * about their timetable, rather than by whatever order the ids came back in.
 */
export async function listSubjectsForStudent(
  trackId: string | null,
  language: Language,
): Promise<{ id: string; name: string; language: string; chapterCount: number }[]> {
  const ids = await subjectIdsForStudent(trackId, language);
  if (ids.length === 0) return [];

  const subjects = await db.subject.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      name: true,
      language: true,
      /*
       * Chapters with something to practise, for the subject picker.
       *
       * `alsoHasQuestions`, not `questions` — what a chapter may SERVE rather
       * than where an exercise was filed, the same distinction as 6be57e6. A
       * count taken the other way understates a subject by three to five times
       * and would tell a student their programme is empty.
       */
      _count: {
        select: {
          chapters: {
            where: {
              alsoHasQuestions: { some: { question: { verifiedStatus: { not: 'rejected' } } } },
            },
          },
        },
      },
    },
    orderBy: [{ language: 'asc' }, { name: 'asc' }],
  });

  return subjects.map((s) => ({
    id: s.id,
    name: s.name,
    language: String(s.language),
    chapterCount: s._count.chapters,
  }));
}

/**
 * Which subjects a student actually sits.
 *
 * The corpus carries one subject row per *book*, and the sciences were
 * published in both English and French — so Chemistry and Chimie are two rows
 * describing the same course. A student sits one or the other: the language is
 * locked at signup precisely because it is a property of their schooling, not a
 * display preference.
 *
 * Arabic-taught subjects are the exception and are always included. Arabic
 * literature, philosophy, history, geography and civics are examined in Arabic
 * for every branch and every section — an English-track candidate still sits
 * تاريخ. Filtering them out with the French science books would delete half
 * their programme.
 */
export function subjectLanguagesFor(language: string): ('en' | 'fr' | 'ar')[] {
  return language === 'ar' ? ['ar'] : [language as 'en' | 'fr', 'ar'];
}

export async function listSubjects(
  trackId: string | null,
  language: string,
): Promise<SubjectSummary[]> {
  if (!trackId) return [];

  const subjects = await db.subject.findMany({
    where: { trackId, language: { in: subjectLanguagesFor(language) } },
    select: {
      id: true,
      name: true,
      language: true,
      _count: { select: { chapters: true } },
      // Counted the same way as listChapters, so a subject's total is the sum
      // of the numbers shown against its chapters rather than a smaller figure
      // arrived at differently.
      chapters: {
        select: {
          _count: {
            select: {
              alsoHasQuestions: { where: { question: { verifiedStatus: { not: 'rejected' } } } },
            },
          },
        },
      },
    },
    orderBy: { name: 'asc' },
  });

  return subjects.map((subject) => ({
    id: subject.id,
    name: subject.name,
    language: subject.language,
    chapterCount: subject._count.chapters,
    questionCount: subject.chapters.reduce((sum, c) => sum + c._count.alsoHasQuestions, 0),
  }));
}

/** Returns the subject only if it belongs to this student's track. */
export async function getSubjectForTrack(subjectId: string, trackId: string | null) {
  if (!trackId) return null;
  return db.subject.findFirst({
    where: { id: subjectId, trackId },
    select: { id: true, name: true, language: true },
  });
}

export type ChapterSummary = {
  id: string;
  name: string;
  unitName: string | null;
  orderIndex: number;
  questionCount: number;
  /**
   * Whether the chapter has textbook material behind it, independently of
   * whether anything can be practised in it.
   *
   * The two run on different clocks. The chapter list is the syllabus, read off
   * the textbooks; questions arrive from past papers, which examine some
   * chapters every year and others never. 320 of 1,193 chapters have reading
   * and no questions — 28 in LH أدب عربي, and 782 passages behind ten rows in
   * LH English — and every one of them was a greyed-out row reading "no
   * questions", which is true and tells the student the wrong thing. There is a
   * summary page for each of them already; it was simply unreachable from here.
   */
  hasReading: boolean;
  /**
   * The years this chapter was examined in, most recent first.
   *
   * 99.6% of questions in the corpus are linked to a dated past paper running
   * from 2004 to 2024, and nothing has ever surfaced it. It is the most
   * actionable fact the product holds about a chapter and it needs no model:
   * a chapter examined in 16 of 18 years is where a student should spend
   * Sunday, and one last examined in 2011 is not.
   *
   * Counted on `question_chapters` — the chapters allowed to SERVE a question —
   * so it agrees with the question count shown beside it rather than
   * contradicting it.
   */
  examYears: number[];
  masteryScore: number;
  attemptsCount: number;
  /** Which subject this chapter belongs to. The Bac Map groups by it. */
  subjectId: string;
};

/** Chapters of a subject with this student's mastery folded in, in syllabus order. */
export async function listChapters(subjectId: string, userId: string): Promise<ChapterSummary[]> {
  return loadChapters({ subjectId }, subjectId, userId);
}

/**
 * Every chapter in a track, for the Bac Map.
 *
 * The map runs Track -> Subject -> Chapter, and calling `listChapters` once per
 * subject would be two round trips per subject on a page showing all of them —
 * fourteen queries for a track with seven subjects, growing with the
 * curriculum. This is the same two queries with a wider WHERE.
 *
 * It shares its loader with `listChapters` deliberately. A chapter's title,
 * order, subject, question availability and reading availability must read the
 * same on the Bac Map as on the practice index; two implementations of that is
 * two chances for them to disagree, and a student who sees "12 questions" on
 * one page and "no questions" on the other has no reason to trust either.
 */
export async function listChaptersForTrack(
  trackId: string,
  userId: string,
): Promise<ChapterSummary[]> {
  return loadChapters({ subject: { trackId } }, trackId, userId);
}

async function loadChapters(
  where: Prisma.ChapterWhereInput,
  scopeId: string,
  userId: string,
): Promise<ChapterSummary[]> {
  const byTrack = 'subject' in where;
  const chapters = await db.chapter.findMany({
    where,
    select: {
      id: true,
      name: true,
      orderIndex: true,
      unit: { select: { name: true } },
      /*
       * Every question this chapter may ASK, not only those filed under it.
       *
       * `questions.chapter_id` says where an exercise was filed and where its
       * mastery is credited; `alsoHasQuestions` says which chapters are allowed
       * to offer it, and a Lebanese exercise belongs to several by design. The
       * quiz page has always used the second. This list used the first, so the
       * index a student reads understated what practice would actually serve
       * them — GS Chemistry showed 69 questions against 352 available, and
       * Mathématiques 170 against 592. A student could reasonably conclude the
       * subject was empty and stop.
       *
       * Rejected questions are excluded here and by the quiz, which the plain
       * `_count` did not do either.
       */
      _count: {
        select: {
          alsoHasQuestions: { where: { question: { verifiedStatus: { not: 'rejected' } } } },
        },
      },
      // Existence, not a count: the list only asks whether there is anything to
      // read, and counting 782 join rows to answer a yes/no costs more than the
      // answer is worth.
      contentChunks: { select: { chunkId: true }, take: 1 },
      chapterMastery: { where: { userId }, select: { masteryScore: true, attemptsCount: true } },
      subjectId: true,
    },
    // Subjects have no explicit order in the schema, so the Bac Map groups by
    // subject in the caller and relies on syllabus order within each.
    orderBy: [{ subjectId: 'asc' }, { orderIndex: 'asc' }],
  });

  /*
   * One query for the whole subject rather than one per chapter. A subject can
   * hold sixty chapters and this is rendered on a page a student opens
   * constantly; sixty round trips to answer "which years" would be the slowest
   * thing on the screen.
   */
  const yearRows = await db.$queryRaw<{ chapter_id: string; years: number[] }[]>`
    SELECT qc.chapter_id::text AS chapter_id,
           array_agg(DISTINCT ec.year ORDER BY ec.year DESC) AS years
      FROM question_chapters qc
      JOIN questions q ON q.id = qc.question_id AND q.verified_status <> 'rejected'
      JOIN exam_cycles ec ON ec.id = q.source_exam_id
      JOIN chapters c ON c.id = qc.chapter_id
      JOIN subjects s ON s.id = c.subject_id
     WHERE ${byTrack ? Prisma.sql`s.track_id = ${scopeId}::uuid` : Prisma.sql`c.subject_id = ${scopeId}::uuid`}
     GROUP BY qc.chapter_id`;

  const yearsByChapter = new Map(yearRows.map((r) => [r.chapter_id, r.years]));

  return chapters.map((chapter) => ({
    id: chapter.id,
    name: chapter.name,
    unitName: chapter.unit?.name ?? null,
    orderIndex: chapter.orderIndex,
    questionCount: chapter._count.alsoHasQuestions,
    hasReading: chapter.contentChunks.length > 0,
    examYears: yearsByChapter.get(chapter.id) ?? [],
    masteryScore: Number(chapter.chapterMastery[0]?.masteryScore ?? 0),
    attemptsCount: chapter.chapterMastery[0]?.attemptsCount ?? 0,
    subjectId: chapter.subjectId,
  }));
}

/** Returns the chapter only if it sits under a subject in this student's track. */
export async function getChapterForTrack(chapterId: string, trackId: string | null) {
  if (!trackId) return null;
  return db.chapter.findFirst({
    where: { id: chapterId, subject: { trackId } },
    select: {
      id: true,
      name: true,
      orderIndex: true,
      unit: { select: { id: true, name: true } },
      subject: { select: { id: true, name: true, language: true } },
    },
  });
}
