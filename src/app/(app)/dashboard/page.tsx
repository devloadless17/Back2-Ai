import type { Metadata } from 'next';
import Link from 'next/link';

import { SubjectCircles, type SubjectCircle } from '@/components/dashboard/subject-circles';
import { streakFrom } from '@/components/dashboard/subject-rings';
import { WelcomeHero } from '@/components/dashboard/welcome-hero';
import { bandForMastery } from '@/components/ui/band';
import { requireUser } from '@/lib/auth/guards';
import { today, toStoredDate } from '@/lib/calendar';
import { db } from '@/lib/db';
import { getTranslations } from '@/lib/i18n';
import { daysUntil } from '@/lib/i18n/format';
import { attemptsByDay, weeklyEffort } from '@/lib/queries/activity';
import { getProgressForUser } from '@/lib/queries/progress';
import { MIN_ATTEMPTS_FOR_WEAKNESS } from '@/lib/scoring/mastery';

// Browser-tab titles are resolved per request from the user's locale, like
// every other string — a hardcoded French title would follow an English-track
// student around the app.
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslations();
  return { title: t.dashboard.title };
}

/**
 * The dashboard: the welcome header, then the student's subjects.
 *
 * Kept to those two on request (2026-09-30). The next-move card, today's plan,
 * the marks table, chapter ranking, exams, activity and announcements each
 * still live on their own page — Progress, Planner, Flashcards — and a student
 * opening the app should meet their subjects, not a report about themselves.
 */
export default async function DashboardPage() {
  const user = await requireUser();
  const { t } = await getTranslations();

  const [progress, activity, todaySessions, week, nextExam] = await Promise.all([
    getProgressForUser(user.id, user.trackId, user.preferredLanguage),
    attemptsByDay(user.id, 14),
    db.studySession.findMany({
      where: { userId: user.id, scheduledDate: startOfToday() },
      select: { status: true, durationMinutes: true },
    }),
    weeklyEffort(user.id),
    db.upcomingExam.findFirst({
      where: { userId: user.id, examDate: { gte: startOfToday() } },
      select: { examDate: true },
      orderBy: { examDate: 'asc' },
    }),
  ]);

  // One circle per subject; mean chapter mastery is the small figure under it.
  const subjectCircles: SubjectCircle[] = progress.map((subject) => {
    const chapters = subject.chapters;
    return {
      subjectId: subject.subjectId,
      subjectName: subject.subjectName,
      mastery:
        chapters.length === 0
          ? 0
          : chapters.reduce((sum, c) => sum + c.masteryScore, 0) / chapters.length,
      attemptsCount: chapters.reduce((sum, c) => sum + c.attemptsCount, 0),
    };
  });

  // Same threshold the planner uses, so the header's count means what "weak"
  // means everywhere else.
  const weakSpots = progress.reduce(
    (count, subject) =>
      count +
      subject.chapters.filter(
        (chapter) =>
          chapter.attemptsCount >= MIN_ATTEMPTS_FOR_WEAKNESS &&
          bandForMastery(chapter.masteryScore, chapter.attemptsCount) === 'weak',
      ).length,
    0,
  );

  const planned = todaySessions.filter((s) => s.status === 'planned');

  return (
    <>
      <WelcomeHero
        firstName={user.displayName?.split(' ')[0] ?? ''}
        sessionCount={planned.length}
        totalMinutes={planned.reduce((sum, s) => sum + (s.durationMinutes ?? 0), 0)}
        doneCount={todaySessions.filter((s) => s.status === 'done').length}
        daysToExam={nextExam ? daysUntil(nextExam.examDate) : null}
        streak={streakFrom(activity)}
        weekAccuracy={week.accuracy}
        weekAnswered={week.answered}
        weakSpots={weakSpots}
      />

      {/* Open, not boxed: a row of circles on the page itself, the way a
          student picks a subject — no card around it, no table of figures. */}
      <section className="py-6 sm:py-8">
        <h2 className="mb-7 text-center font-display text-title font-bold text-ink">
          {t.dashboard.yourSubjects}
        </h2>
        {subjectCircles.length === 0 ? (
          <p className="text-center text-meta text-ink-muted">{t.dashboard.chaptersPending}</p>
        ) : (
          <SubjectCircles subjects={subjectCircles} />
        )}
        <p className="mt-8 text-center">
          <Link href="/progress" className="text-meta font-medium text-ink-muted hover:text-ink hover:underline">
            {t.dashboard.allProgress}
          </Link>
        </p>
      </section>
    </>
  );
}

/**
 * Midnight of the current BEIRUT day, as a `DATE` column compares it.
 *
 * Read the UTC date until now, which made Today, the due-card count and the
 * exam countdown all answer yesterday between local midnight and 02:00 or
 * 03:00. See `src/lib/calendar.ts`.
 */
function startOfToday(): Date {
  return toStoredDate(today());
}
