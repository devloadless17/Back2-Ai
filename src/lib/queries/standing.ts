import 'server-only';

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

export async function getStanding(userId: string, trackId: string | null): Promise<Standing> {
  const [progress, practisedRow, availableRow, activeDays, nextExam] = await Promise.all([
    getProgressForUser(userId, trackId),

    // Chapters this student has actually been marked in.
    db.chapterMastery.count({ where: { userId, attemptsCount: { gt: 0 } } }),

    // Chapters that can be practised at all — those with a question in them,
    // inside the student's own track.
    db.chapter.count({
      where: {
        subject: { trackId: trackId ?? undefined },
        questions: { some: {} },
      },
    }),

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
