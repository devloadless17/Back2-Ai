import 'server-only';

import { today, toStoredDate } from '@/lib/calendar';

import { db } from '@/lib/db';
import { findWeakestChapter, getProgressForUser, type SubjectProgress } from '@/lib/queries/progress';

/**
 * "What should I do right now?"
 *
 * The most common reason a revision session does not happen is not laziness —
 * it is opening the app, seeing nine subjects and fifty-five chapters, and
 * closing it again. This picks one thing and names it.
 *
 * The order is a triage, not a ranking of importance:
 *
 *   1. **Cards due.** Spaced repetition only works if the reviews happen on the
 *      day they are scheduled. A missed review costs more than a skipped new
 *      chapter, so it goes first.
 *   2. **The weakest chapter.** Once recall is safe, the marks are wherever
 *      mastery is lowest — but only once there are enough attempts to trust it.
 *   3. **An untouched chapter.** With nothing weak enough to name, breadth is
 *      the next best use of an hour.
 *   4. **A full paper.** For a student who has practised but never sat one, the
 *      gap is exam conditions, not knowledge.
 *   5. **Anything.** Said plainly, rather than inventing a task.
 */

export type NextUp =
  | { kind: 'flashcards'; href: string; count: number }
  | { kind: 'weakChapter'; href: string; chapterName: string; masteryScore: number }
  | { kind: 'newChapter'; href: string; chapterName: string; subjectName: string }
  | { kind: 'examSim'; href: string }
  | { kind: 'anything'; href: string };

export async function getNextUp(
  userId: string,
  trackId: string | null,
  language: string,
  preloadedProgress?: SubjectProgress[],
): Promise<NextUp> {
  const today = startOfToday();

  const [dueCount, progress, examCount] = await Promise.all([
    db.flashcardState.count({ where: { userId, dueDate: { lte: today } } }),
    preloadedProgress ?? getProgressForUser(userId, trackId, language),
    db.examSimulation.count({ where: { userId, status: { in: ['submitted', 'graded'] } } }),
  ]);

  if (dueCount > 0) {
    return { kind: 'flashcards', href: '/flashcards/review', count: dueCount };
  }

  const weakest = findWeakestChapter(progress);
  if (weakest) {
    return {
      kind: 'weakChapter',
      href: `/practice/${weakest.subjectId}/${weakest.chapterId}`,
      chapterName: weakest.chapterName,
      masteryScore: weakest.masteryScore,
    };
  }

  // Resolve availability once for every untouched chapter. The previous loop
  // issued one count query per candidate until it found a usable chapter; on a
  // new account that could mean dozens of serial database round trips.
  const untouched = progress.flatMap((subject) =>
    subject.chapters
      .filter((chapter) => chapter.attemptsCount === 0)
      .map((chapter) => ({ ...chapter, subjectName: subject.subjectName })),
  );
  const availableRows = untouched.length === 0
    ? []
    : await db.questionChapter.findMany({
        where: {
          chapterId: { in: untouched.map((chapter) => chapter.chapterId) },
          question: { verifiedStatus: { not: 'rejected' } },
        },
        select: { chapterId: true },
        distinct: ['chapterId'],
      });
  const available = new Set(availableRows.map((row) => row.chapterId));
  const nextUntouched = untouched.find((chapter) => available.has(chapter.chapterId));

  if (nextUntouched) {
    return {
      kind: 'newChapter',
      href: `/practice/${nextUntouched.subjectId}/${nextUntouched.chapterId}`,
      chapterName: nextUntouched.chapterName,
      subjectName: nextUntouched.subjectName,
    };
  }

  if (examCount === 0) {
    return { kind: 'examSim', href: '/exam-sim/new' };
  }

  return { kind: 'anything', href: '/practice' };
}

/**
 * Midnight of the current Beirut day, as the value a `DATE` column compares
 * against. See `src/lib/calendar.ts` — this used to read the UTC date, so
 * between local midnight and 02:00 or 03:00 it returned yesterday.
 */
function startOfToday(): Date {
  return toStoredDate(today());
}
