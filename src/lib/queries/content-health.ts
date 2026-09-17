import 'server-only';

import { cacheCurriculum } from '@/lib/cache';
import { db } from '@/lib/db';

/**
 * How much of the programme the question bank actually reaches.
 *
 * This used to sit on the student's Progress page, labelled "Programme
 * covered", as a percentage beside their mastery. It was never a fact about
 * the student. The numerator was chapters they had attempted, but the
 * denominator was "chapters that hold questions" — so the figure moved when
 * ingestion ran, and it disagreed with the denominator the readiness model
 * uses. Two percentages on one page, both called coverage, measuring against
 * different wholes.
 *
 * Split in two. Student coverage — chapters attempted over chapters in the
 * programme — is the student's, and lives in `getStanding`. What is left is
 * this: a corpus measure, useful for knowing where ingestion still has work,
 * and not something to show a seventeen-year-old beside their mark.
 */
export type PastPaperCoverage = {
  /** Chapters that can serve at least one question. */
  chaptersWithQuestions: number;
  /** Every chapter in the track, questions or not. */
  chaptersTotal: number;
  /** 0..1. Zero chapters reads as zero, never as complete. */
  ratio: number;
};

/**
 * "Can serve a question" is `alsoHasQuestions`, not questions FILED under the
 * chapter. The two stopped being the same thing once an exercise could belong
 * to several chapters at once: 178 chapters serve questions with nothing filed
 * under them. Counting the filed ones gave 182 of 243 on GS instead of the
 * true figure — and because this was a divisor, understating it made coverage
 * read about a third HIGHER than it was.
 */
export const pastPaperCoverage = cacheCurriculum(
  ['past-paper-coverage'],
  async (trackId: string | null): Promise<PastPaperCoverage> => {
    const where = { subject: { trackId: trackId ?? undefined } };

    const [chaptersWithQuestions, chaptersTotal] = await Promise.all([
      db.chapter.count({
        where: {
          ...where,
          alsoHasQuestions: { some: { question: { verifiedStatus: { not: 'rejected' } } } },
        },
      }),
      db.chapter.count({ where }),
    ]);

    return {
      chaptersWithQuestions,
      chaptersTotal,
      ratio: chaptersTotal === 0 ? 0 : chaptersWithQuestions / chaptersTotal,
    };
  },
);
