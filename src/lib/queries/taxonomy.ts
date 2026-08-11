import 'server-only';

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

export async function listSubjects(trackId: string | null): Promise<SubjectSummary[]> {
  if (!trackId) return [];

  const subjects = await db.subject.findMany({
    where: { trackId },
    select: {
      id: true,
      name: true,
      language: true,
      _count: { select: { chapters: true } },
      chapters: { select: { _count: { select: { questions: true } } } },
    },
    orderBy: { name: 'asc' },
  });

  return subjects.map((subject) => ({
    id: subject.id,
    name: subject.name,
    language: subject.language,
    chapterCount: subject._count.chapters,
    questionCount: subject.chapters.reduce((sum, c) => sum + c._count.questions, 0),
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
  masteryScore: number;
  attemptsCount: number;
};

/** Chapters of a subject with this student's mastery folded in, in syllabus order. */
export async function listChapters(subjectId: string, userId: string): Promise<ChapterSummary[]> {
  const chapters = await db.chapter.findMany({
    where: { subjectId },
    select: {
      id: true,
      name: true,
      orderIndex: true,
      unit: { select: { name: true } },
      _count: { select: { questions: true } },
      chapterMastery: { where: { userId }, select: { masteryScore: true, attemptsCount: true } },
    },
    orderBy: { orderIndex: 'asc' },
  });

  return chapters.map((chapter) => ({
    id: chapter.id,
    name: chapter.name,
    unitName: chapter.unit?.name ?? null,
    orderIndex: chapter.orderIndex,
    questionCount: chapter._count.questions,
    masteryScore: Number(chapter.chapterMastery[0]?.masteryScore ?? 0),
    attemptsCount: chapter.chapterMastery[0]?.attemptsCount ?? 0,
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
