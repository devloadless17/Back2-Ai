import 'server-only';

import { cacheCurriculum } from '@/lib/cache';
import { db } from '@/lib/db';
import {
  bandForMark,
  coverage,
  markOutOf20,
  monthlyEffort,
  overallMark,
  type Coverage,
  type MarkBand,
  type MonthlyEffort,
} from '@/lib/standing';

import { getProgressForUser } from './progress';

/**
 * The student's standing, assembled from the numbers the product already
 * computes. Nothing here is stored: it is derived on read, so it can never
 * drift from the work behind it.
 */

export type SubjectMark = {
  subjectId: string;
  subjectName: string;
  /** Null when there is not enough evidence to predict — never zero. */
  mark: number | null;
  band: MarkBand | null;
  trend: 'up' | 'flat' | 'down';
};

export type Standing = {
  overall: number | null;
  overallBand: MarkBand | null;
  subjects: SubjectMark[];
  coverage: Coverage;
  effort: MonthlyEffort;
  /** Days until the next exam on the student's calendar, null if none. */
  daysToExam: number | null;
  examLabel: string | null;
};

/**
 * The two figures the sidebar carries, without recomputing the whole picture.
 *
 * `getStanding` is expensive on purpose — it reads every chapter in the track
 * and 120 days of attempts so that the progress pages can explain themselves.
 * The sidebar shows a mark out of 20 and a day count, and it renders on *every*
 * page in the authenticated app. Paying a full recomputation per navigation, per
 * student, is the single largest avoidable cost on the read path.
 *
 * So it reads the nightly `readiness_scores` snapshot instead: two indexed reads
 * on primary keys. The number is up to a day old, which is the right trade for a
 * figure that moves by fractions of a mark and that the student can see computed
 * live one click away on /progress.
 *
 * Falls back to the live computation when there is no snapshot — a brand-new
 * account on its first evening should not see a blank sidebar because the
 * nightly job has not run yet.
 */
/**
 * How many chapters in a track can be practised at all.
 *
 * The denominator of "programme covered". Deliberately *not* the whole syllabus:
 * the chapter list comes from the textbooks and runs ahead of the questions,
 * which arrive through ingestion, so dividing by every chapter would show a
 * student 8% and blame them for a gap in our corpus.
 *
 * Track-global and static between ingestion runs — see `cacheCurriculum`.
 */
const practisableChapterCount = cacheCurriculum(
  ['practisable-chapter-count'],
  async (trackId: string | null): Promise<number> =>
    db.chapter.count({
      where: {
        subject: { trackId: trackId ?? undefined },
        questions: { some: {} },
      },
    }),
);

export async function getSidebarStanding(
  userId: string,
  trackId: string | null,
  language: string,
): Promise<{ mark: number | null; daysToExam: number | null }> {
  const [rows, nextExam] = await Promise.all([
    db.readinessScore.findMany({
      where: { userId, subject: { trackId: trackId ?? undefined } },
      select: { score: true },
    }),
    db.upcomingExam.findFirst({
      where: { userId, examDate: { gte: startOfToday() } },
      select: { examDate: true },
      orderBy: { examDate: 'asc' },
    }),
  ]);

  const daysToExam = nextExam ? daysBetween(startOfToday(), nextExam.examDate) : null;

  if (rows.length === 0) {
    // No snapshot yet. Compute it properly rather than showing nothing.
    const standing = await getStanding(userId, trackId, language);
    return { mark: standing.overall, daysToExam: standing.daysToExam };
  }

  const marks = rows.map((row) => markOutOf20(Number(row.score)));
  return { mark: overallMark(marks), daysToExam };
}

export async function getStanding(
  userId: string,
  trackId: string | null,
  language: string,
): Promise<Standing> {
  const [progress, practisedRow, availableRow, activeDays, nextExam] = await Promise.all([
    getProgressForUser(userId, trackId, language),

    // Chapters this student has actually been marked in.
    db.chapterMastery.count({ where: { userId, attemptsCount: { gt: 0 } } }),

    // Chapters that can be practised at all — those with a question in them,
    // inside the student's own track. Identical for every student in that
    // track, so it is cached against the track rather than recounted per
    // request; ingestion is the only thing that moves it.
    practisableChapterCount(trackId),

    db.attempt.findMany({
      where: { userId, attemptedAt: { gte: startOfMonth() } },
      select: { attemptedAt: true },
    }),

    db.upcomingExam.findFirst({
      where: { userId, examDate: { gte: startOfToday() } },
      select: { examDate: true, label: true, subject: { select: { name: true } } },
      orderBy: { examDate: 'asc' },
    }),
  ]);

  const subjects: SubjectMark[] = progress.map((subject) => {
    const mark = subject.readiness.reportable ? markOutOf20(subject.readiness.score) : null;
    return {
      subjectId: subject.subjectId,
      subjectName: subject.subjectName,
      mark,
      band: mark === null ? null : bandForMark(mark),
      trend: subject.readiness.trend,
    };
  });

  const reportable = subjects.map((s) => s.mark).filter((m): m is number => m !== null);
  const overall = overallMark(reportable);

  return {
    overall,
    overallBand: overall === null ? null : bandForMark(overall),
    subjects,
    coverage: coverage(practisedRow, availableRow),
    effort: monthlyEffort(activeDays.map((a) => a.attemptedAt)),
    daysToExam: nextExam ? daysBetween(startOfToday(), nextExam.examDate) : null,
    examLabel: nextExam ? (nextExam.subject?.name ?? nextExam.label ?? null) : null,
  };
}

function startOfToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function startOfMonth(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}
