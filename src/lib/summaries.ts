import 'server-only';

import { db } from '@/lib/db';

/**
 * A chapter's revision material, read straight from the textbook.
 *
 * This used to compose an AI overview of a chapter's passages. That is gone:
 * a summary reads as authoritative and gets revised from without being
 * questioned, and the safer thing to show a student under that trust is the
 * textbook's own words, not a model's paraphrase of them — however carefully
 * grounded. What follows is a plain read of `content_chunks`, in the order a
 * student would want to revise them: definitions and results first, worked
 * examples last.
 */

/** Definitions and theorems first, exercises last. */
function rank(kind: string): number {
  return kind === 'definition'
    ? 0
    : kind === 'theorem'
      ? 1
      : kind === 'formula'
        ? 2
        : kind === 'worked_example'
          ? 3
          : 4;
}

export type ChapterPassage = {
  id: string;
  kind: string;
  title: string | null;
  contentText: string;
  contentLatex: string | null;
};

export type ChapterContent = {
  chapterId: string;
  chapterName: string;
  subjectName: string;
  subjectLanguage: 'fr' | 'en' | 'ar';
  passages: ChapterPassage[];
  /** How many past-exam questions this chapter carries, for weighting revision. */
  pastQuestions: number;
  status: 'ok' | 'no_material';
};

export async function getChapterContent(chapterId: string): Promise<ChapterContent> {
  const blank = {
    chapterId,
    chapterName: '',
    subjectName: '',
    subjectLanguage: 'en' as const,
    passages: [],
    pastQuestions: 0,
  };

  const chapter = await db.chapter.findUnique({
    where: { id: chapterId },
    select: {
      id: true,
      name: true,
      subject: { select: { name: true, language: true } },
      // What this chapter may ASK, not where an exercise was filed — the same
      // distinction as 6be57e6. Shown to the student as "past questions".
      _count: {
        select: {
          alsoHasQuestions: { where: { question: { verifiedStatus: { not: 'rejected' } } } },
        },
      },
    },
  });
  if (!chapter) return { ...blank, status: 'no_material' };

  const passages = await db.contentChunk.findMany({
    where: { chapters: { some: { chapterId } } },
    select: { id: true, kind: true, title: true, contentText: true, contentLatex: true },
  });
  if (passages.length === 0) {
    return {
      ...blank,
      chapterName: chapter.name,
      subjectName: chapter.subject.name,
      subjectLanguage: chapter.subject.language,
      status: 'no_material',
    };
  }

  return {
    chapterId: chapter.id,
    chapterName: chapter.name,
    subjectName: chapter.subject.name,
    subjectLanguage: chapter.subject.language,
    passages: [...passages].sort((a, b) => rank(a.kind) - rank(b.kind)),
    pastQuestions: chapter._count.alsoHasQuestions,
    status: 'ok',
  };
}
