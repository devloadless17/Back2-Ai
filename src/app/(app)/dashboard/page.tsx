import type { Metadata } from 'next';
import Link from 'next/link';

import { SubjectCircles, type SubjectCircle } from '@/components/dashboard/subject-circles';
import { requireUser } from '@/lib/auth/guards';
import { getTranslations } from '@/lib/i18n';
import { format } from '@/lib/i18n/format';
import { getProgressForUser } from '@/lib/queries/progress';

// Browser-tab titles are resolved per request from the user's locale, like
// every other string — a hardcoded French title would follow an English-track
// student around the app.
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslations();
  return { title: t.dashboard.title };
}

/**
 * The dashboard: one light header and the student's subjects, nothing else.
 *
 * Cut down on request (2026-09-30, then 2026-10-01 for the blue banner). The
 * plan, the next-move card, marks, rankings, exams and announcements each
 * still live on their own page — Progress, Planner, Flashcards. A student
 * opening the app meets one question and the subjects to answer it with.
 */
export default async function DashboardPage() {
  const user = await requireUser();
  const { t } = await getTranslations();

  const progress = await getProgressForUser(user.id, user.trackId, user.preferredLanguage);

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

  const firstName = user.displayName?.split(' ')[0] ?? '';
  // The title is a template with one word lifted out, so the highlighted word
  // can sit where each language puts it rather than always last.
  const [before, after] = t.dashboard.homeTitle.split('{word}');

  return (
    <section className="home-band rounded-3xl px-5 pb-10 pt-12 sm:px-10 sm:pb-12 sm:pt-16">
      {firstName && (
        <p className="text-center text-meta font-medium text-ink-muted">
          {format(t.dashboard.homeHello, { name: firstName })}
        </p>
      )}
      <h1 className="mx-auto mt-2 max-w-3xl text-balance text-center font-display text-display font-bold leading-tight text-ink sm:text-hero">
        {before}
        <span className="home-word mx-1 inline-block rounded-2xl px-3 py-0.5">{t.dashboard.homeWord}</span>
        {after}
      </h1>

      <div className="mt-10 sm:mt-12">
        {subjectCircles.length === 0 ? (
          <p className="text-center text-meta text-ink-muted">{t.dashboard.chaptersPending}</p>
        ) : (
          <SubjectCircles subjects={subjectCircles} />
        )}
      </div>

      <p className="mt-10 text-center">
        <Link href="/progress" className="text-meta font-medium text-ink-muted hover:text-ink hover:underline">
          {t.dashboard.allProgress}
        </Link>
      </p>
    </section>
  );
}
