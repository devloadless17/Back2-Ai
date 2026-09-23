import 'server-only';

import { db } from '@/lib/db';
import { LIVE_CHAPTER, OWN_EDITION_ONLY, subjectLanguagesFor } from '@/lib/queries/taxonomy';
import { MIN_ATTEMPTS_FOR_WEAKNESS } from '@/lib/scoring/mastery';
import { WEAKNESS_MASTERY_CEILING } from '@/lib/queries/flashcards';

/**
 * Everything one subject offers a student, counted.
 *
 * The subject page used to be a list of chapters, which answers "what is in
 * this course" and not "what should I do next" — and the second is the question
 * somebody opens a revision app with. So the page is organised by intent —
 * learn, practise, review — and every entry carries a real number.
 *
 * The numbers are the point. A card saying "Question bank" tells a student
 * nothing about whether it is worth opening; "Question bank · 1,181 questions"
 * does, and "Past papers · none yet" saves them the trip. Every count here is a
 * plain read of rows the product already has, so the page never waits on a
 * model and never shows a figure it cannot substantiate.
 */
export type SubjectHub = {
  chapters: number;
  /** Chapters with any course material behind them — what "the book" can show. */
  chaptersWithMaterial: number;
  questions: number;
  /** Past papers a student can open, in a language they read. */
  papers: number;
  /** Flashcards due today in this subject. */
  cardsDue: number;
  /** Cards in this subject's deck at all, due or not. */
  cardsTotal: number;
  /** Chapters with enough evidence behind them to call weak. */
  weakChapters: number;
  /** Questions answered in this subject, ever. */
  attempts: number;
  /** Whether enough marked past-exam questions exist to assemble a mock paper. */
  canAssemble: boolean;
};

export async function getSubjectHub(
  subjectId: string,
  userId: string,
  studyLanguage: string,
): Promise<SubjectHub> {
  const [chapters, chaptersWithMaterial, questions, papers, cardsDue, cardsTotal, weak, attempts, markable] =
    await Promise.all([
      db.chapter.count({ where: { subjectId, ...LIVE_CHAPTER } }),

      db.chapter.count({
        where: { subjectId, contentChunks: { some: {} }, ...LIVE_CHAPTER },
      }),

      db.question.count({
        where: { chapter: { subjectId }, verifiedStatus: { not: 'rejected' } },
      }),

      /*
       * Papers, in an edition the student can read.
       *
       * The same filter the past-paper list uses: their own language plus
       * Arabic, because the humanities are taught in Arabic and a French-track
       * student is shown them. Counting every edition would promise three times
       * the papers that are actually useful to them.
       */
      db.examCycle.count({
        where: {
          subjectId,
          language: { in: subjectLanguagesFor(studyLanguage) },
          ...OWN_EDITION_ONLY,
          questions: { some: { verifiedStatus: { not: 'rejected' } } },
        },
      }),

      db.flashcardState.count({
        where: {
          userId,
          dueDate: { lte: startOfToday() },
          OR: [
            { question: { chapter: { subjectId } } },
            { generatedCard: { retiredAt: null, chapter: { subjectId } } },
          ],
        },
      }),

      db.flashcardState.count({
        where: {
          userId,
          OR: [
            { question: { chapter: { subjectId } } },
            { generatedCard: { retiredAt: null, chapter: { subjectId } } },
          ],
        },
      }),

      /*
       * Weak chapters, on the product's own definition rather than a new one.
       *
       * Both thresholds are the ones the planner and the dashboard already use,
       * so this card and the focus line on the dashboard can never disagree
       * about what "weak" means.
       */
      db.chapterMastery.count({
        where: {
          userId,
          chapter: { subjectId },
          attemptsCount: { gte: MIN_ATTEMPTS_FOR_WEAKNESS },
          masteryScore: { lt: WEAKNESS_MASTERY_CEILING },
        },
      }),

      db.attempt.count({ where: { userId, question: { chapter: { subjectId } } } }),

      // Enough marked questions to assemble a paper out of 20. Three is the
      // minimum a paper can be, so below that the mode is not offered.
      db.question.count({
        where: {
          chapter: { subjectId },
          sourceType: 'past_exam',
          verifiedStatus: { not: 'rejected' },
        },
      }),
    ]);

  return {
    chapters,
    chaptersWithMaterial,
    questions,
    papers,
    cardsDue,
    cardsTotal,
    weakChapters: weak,
    attempts,
    canAssemble: markable >= 3,
  };
}

function startOfToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
