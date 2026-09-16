import 'server-only';

import { db } from '@/lib/db';
import { getProgressForUser } from '@/lib/queries/progress';
import { markOutOf20 } from '@/lib/standing';

/**
 * Everything one printed readiness report needs, in one read.
 *
 * WHO IT IS FOR. Not the student — they have the dashboard, which is live and
 * interactive and better. This is for the conversation a school has with a
 * parent, and for the folder a teacher brings to a meeting. Those happen on
 * paper, in a room, with no login and no network, which is why this exists as a
 * page that prints rather than a screen that scrolls.
 *
 * WHY EXAM FREQUENCY SITS BESIDE MASTERY. A weak chapter that the examiners set
 * every year and a weak chapter they have not set since 2011 are not the same
 * problem, and a report that ranks purely by weakness sends a family to spend
 * the holidays on the second one. 99.6% of this corpus is linked to a dated
 * paper across eighteen years; putting the two numbers on one line is the whole
 * value of the page.
 *
 * NOTHING HERE IS GENERATED. Every figure is already computed and stored —
 * mastery per chapter, readiness per subject, years per chapter. A report that
 * called a model would cost money per print, vary between prints of the same
 * day, and could not be handed to a parent as a record.
 */

export type ReportChapter = {
  chapterName: string;
  masteryScore: number;
  attemptsCount: number;
  /** Years this chapter has been examined in, most recent first. */
  examYears: number[];
  /** Appearances in the last eight years — see `examFrequencyOf`. */
  recentYears: number;
};

export type ReportSubject = {
  subjectName: string;
  /** Out of 20, or null when there is not enough marked work to say. */
  mark: number | null;
  trend: 'up' | 'flat' | 'down';
  attempts: number;
  chaptersStarted: number;
  chaptersTotal: number;
  /** Weakest first, and only those the examiners still set. */
  priority: ReportChapter[];
};

export type ReadinessReport = {
  studentName: string | null;
  trackName: string | null;
  generatedAt: Date;
  overallMark: number | null;
  subjects: ReportSubject[];
};

/** How many chapters a subject is allowed to recommend. A list nobody reads is not advice. */
const PRIORITY_PER_SUBJECT = 4;
const RECENT_WINDOW = 8;

export async function readinessReport(
  userId: string,
  trackId: string | null,
  language: string,
): Promise<ReadinessReport> {
  const [user, progress] = await Promise.all([
    db.user.findUnique({
      where: { id: userId },
      select: { displayName: true, track: { select: { name: true } } },
    }),
    getProgressForUser(userId, trackId, language),
  ]);

  /*
   * Exam years for every chapter in the track, in one query. Per subject would
   * be fifteen round trips for a page that is printed, not browsed, and the
   * numbers are the same either way.
   */
  const yearRows = await db.$queryRaw<{ chapter_id: string; years: number[] }[]>`
    SELECT qc.chapter_id::text AS chapter_id,
           array_agg(DISTINCT ec.year ORDER BY ec.year DESC) AS years
      FROM question_chapters qc
      JOIN questions q ON q.id = qc.question_id AND q.verified_status <> 'rejected'
      JOIN exam_cycles ec ON ec.id = q.source_exam_id
      JOIN chapters c ON c.id = qc.chapter_id
      JOIN subjects s ON s.id = c.subject_id
     WHERE s.track_id = ${trackId}::uuid
     GROUP BY qc.chapter_id`;

  const yearsByChapter = new Map(yearRows.map((r) => [r.chapter_id, r.years]));
  const cutoff = new Date().getUTCFullYear() - RECENT_WINDOW;

  const subjects: ReportSubject[] = progress.map((subject) => {
    const chapters = subject.chapters.map((chapter) => {
      const years = yearsByChapter.get(chapter.chapterId) ?? [];
      return {
        chapterName: chapter.chapterName,
        masteryScore: Number(chapter.masteryScore ?? 0),
        attemptsCount: chapter.attemptsCount,
        examYears: years,
        recentYears: years.filter((y) => y > cutoff).length,
      };
    });

    /*
     * WEAK *AND* STILL EXAMINED, in that order.
     *
     * Ranking by weakness alone puts a chapter last set in 2011 above one set
     * in six of the last eight years, and a family acting on that report spends
     * the holidays on the wrong topic. A chapter the examiners have abandoned
     * is not a priority however badly it is known.
     */
    const priority = chapters
      .filter((c) => c.recentYears > 0)
      .sort((a, b) => a.masteryScore - b.masteryScore || b.recentYears - a.recentYears)
      .slice(0, PRIORITY_PER_SUBJECT);

    return {
      subjectName: subject.subjectName,
      mark: subject.readiness.reportable ? markOutOf20(subject.readiness.score) : null,
      trend: subject.readiness.trend,
      attempts: subject.readiness.totalAttempts,
      chaptersStarted: chapters.filter((c) => c.attemptsCount > 0).length,
      chaptersTotal: chapters.length,
      priority,
    };
  });

  const reportable = subjects.map((s) => s.mark).filter((m): m is number => m !== null);

  return {
    studentName: user?.displayName ?? null,
    trackName: user?.track?.name ?? null,
    generatedAt: new Date(),
    // The mean of the subjects that can be reported, not of all of them: a
    // subject with no marked work is unknown, and averaging it in as zero would
    // print a failing report for a student who has simply not started.
    overallMark:
      reportable.length === 0
        ? null
        : Math.round((reportable.reduce((a, b) => a + b, 0) / reportable.length) * 10) / 10,
    subjects,
  };
}
