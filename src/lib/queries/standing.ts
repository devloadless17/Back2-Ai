import 'server-only';

import { today, toStoredDate } from '@/lib/calendar';

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

import { MIN_ATTEMPTS_FOR_READINESS } from '@/lib/scoring/readiness';

import { getProgressForUser } from './progress';

/**
 * The student's standing, assembled from the numbers the product already
 * computes. Nothing here is stored: it is derived on read, so it can never
 * drift from the work behind it.
 */

/**
 * What a subject's mark is made of.
 *
 * Readiness is `mastery x coverage` plus the strict coverage and trend terms
 * (`docs/readiness-model.md`). v1 reported only the product, which is why a
 * student with two perfect chapters out of twenty read as weak rather than as
 * narrow. The two ideas are carried separately here so the UI can say which
 * one is actually short — they call for different work.
 */
export type SubjectEvidence = {
  /** How well, on chapters with at least one attempt. Zero when none. */
  mastery: number;
  /** How much of the subject has any attempt at all. */
  coverage: number;
  chaptersAttempted: number;
  chaptersTotal: number;
  attempts: number;
  /**
   * Attempts still needed before a mark may be shown, zero once reportable.
   * The difference between "we cannot say yet" and "you are weak here" is the
   * whole credibility of the number, so the UI states the gap rather than
   * leaving the student to guess how much more work is enough.
   */
  attemptsNeeded: number;
};

export type SubjectMark = {
  subjectId: string;
  subjectName: string;
  /** Null when there is not enough evidence to predict — never zero. */
  mark: number | null;
  band: MarkBand | null;
  trend: 'up' | 'flat' | 'down';
  evidence: SubjectEvidence;
};

/**
 * The track read as one, for the three figures above the subject table.
 *
 * Aggregated here rather than in the page so that Progress, the dashboard and
 * anything else asking the same question get the same arithmetic. Chapter
 * counts add exactly, so `chaptersAttempted / chaptersTotal` is a real
 * fraction and not a mean of fractions; `mastery` is the mean over every
 * attempted chapter in the track, which weights a subject by the evidence it
 * actually has rather than by being one subject among five.
 */
export type TrackEvidence = {
  mastery: number;
  chaptersAttempted: number;
  chaptersTotal: number;
  /** Marked answers behind all of it. The honest basis line. */
  markedAnswers: number;
};

export type Standing = {
  overall: number | null;
  overallBand: MarkBand | null;
  subjects: SubjectMark[];
  /**
   * STUDENT coverage: chapters attempted over chapters in the programme.
   *
   * This used to divide by "chapters that have questions", which is a fact
   * about the corpus, not about the student — and it disagreed with the
   * denominator the readiness model uses, so the headline mark and the
   * coverage figure beside it were measuring against different wholes. There
   * is now one definition. The corpus question moved to
   * `src/lib/queries/content-health.ts`, where it is named for what it counts.
   */
  coverage: Coverage;
  evidence: TrackEvidence;
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
 *
 * "Can be practised" means a chapter is allowed to SERVE a question, which is
 * `alsoHasQuestions`. It used to ask for questions FILED under the chapter, and
 * the two stopped being the same thing once an exercise could belong to several
 * chapters at once: 178 chapters serve questions with nothing filed under them.
 * That made the denominator 182 instead of 243 on GS and 194 instead of 243 on
 * LS — a quarter short, which does not show a student a smaller number but a
 * BIGGER one, because it is a divisor. Coverage read about a third higher than
 * the programme they had actually covered.
 */

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
  /*
   * Coverage no longer needs its own two queries.
   *
   * It used to count `chapter_mastery` rows for the user — WITHOUT a track
   * filter, so a student who had switched track carried the old track's
   * chapters into the numerator — over a cached count of chapters holding
   * questions. Both numbers now come out of `getProgressForUser`, which is
   * already track-scoped and already loaded here, so the figure agrees with
   * readiness by construction and two round trips disappear.
   */
  const [progress, activeDays, nextExam] = await Promise.all([
    getProgressForUser(userId, trackId, language),

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
    const r = subject.readiness;
    return {
      subjectId: subject.subjectId,
      subjectName: subject.subjectName,
      mark,
      band: mark === null ? null : bandForMark(mark),
      trend: r.trend,
      evidence: {
        mastery: r.mastery,
        coverage: r.coverage,
        chaptersAttempted: r.chaptersAttempted,
        chaptersTotal: r.chaptersTotal,
        attempts: r.totalAttempts,
        attemptsNeeded: Math.max(0, MIN_ATTEMPTS_FOR_READINESS - r.totalAttempts),
      },
    };
  });

  const reportable = subjects.map((s) => s.mark).filter((m): m is number => m !== null);
  const overall = overallMark(reportable);

  const chaptersAttempted = subjects.reduce((n, s) => n + s.evidence.chaptersAttempted, 0);
  const chaptersTotal = subjects.reduce((n, s) => n + s.evidence.chaptersTotal, 0);
  const evidence: TrackEvidence = {
    mastery:
      chaptersAttempted === 0
        ? 0
        : subjects.reduce((sum, s) => sum + s.evidence.mastery * s.evidence.chaptersAttempted, 0) /
          chaptersAttempted,
    chaptersAttempted,
    chaptersTotal,
    markedAnswers: subjects.reduce((n, s) => n + s.evidence.attempts, 0),
  };

  return {
    overall,
    overallBand: overall === null ? null : bandForMark(overall),
    subjects,
    coverage: coverage(chaptersAttempted, chaptersTotal),
    evidence,
    effort: monthlyEffort(activeDays.map((a) => a.attemptedAt)),
    daysToExam: nextExam ? daysBetween(startOfToday(), nextExam.examDate) : null,
    examLabel: nextExam ? (nextExam.subject?.name ?? nextExam.label ?? null) : null,
  };
}

/**
 * Midnight of the current Beirut day, as the value a `DATE` column compares
 * against. See `src/lib/calendar.ts` — this used to read the UTC date, so
 * between local midnight and 02:00 or 03:00 it returned yesterday.
 */
function startOfToday(): Date {
  return toStoredDate(today());
}

/** The first of the current Beirut month, for "days worked this month". */
function startOfMonth(): Date {
  return toStoredDate(today().slice(0, 7) + '-01');
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}
