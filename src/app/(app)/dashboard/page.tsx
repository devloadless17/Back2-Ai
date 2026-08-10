import type { Metadata } from 'next';
import Link from 'next/link';

import { LinkButton } from '@/components/ui/button';
import { Badge, EmptyState } from '@/components/ui/feedback';
import { Meter, ReadinessDial } from '@/components/ui/progress';
import { PageHeader, Sheet, SheetBody, SheetHeader } from '@/components/ui/sheet';
import { requireUser } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { getTranslations } from '@/lib/i18n';
import { daysUntil, format, formatDate } from '@/lib/i18n/format';
import { findWeakestChapter, getProgressForUser } from '@/lib/queries/progress';
import { MIN_ATTEMPTS_FOR_WEAKNESS } from '@/lib/scoring/mastery';

// Browser-tab titles are resolved per request from the user's locale, like
// every other string — a hardcoded French title would follow an English-track
// student around the app.
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslations();
  return { title: t.dashboard.title };
}

export default async function DashboardPage() {
  const user = await requireUser();
  const { locale, t } = await getTranslations();

  const [progress, flashcardsDue, announcements, upcomingExams, recentAttempts] = await Promise.all([
    getProgressForUser(user.id, user.trackId),
    db.flashcardState.count({ where: { userId: user.id, dueDate: { lte: startOfToday() } } }),
    db.announcement.findMany({
      /*
       * Both targeting dimensions are applied.
       *
       * A subject-targeted announcement is implicitly track-targeted — subjects
       * belong to tracks — so it must not reach a student from another track
       * just because its `target_track_id` happens to be null. Filtering on
       * track alone was leaking "Physics paper moved" to the literature stream.
       */
      where: {
        AND: [
          { OR: [{ targetTrackId: null }, { targetTrackId: user.trackId }] },
          {
            OR: [
              { targetSubjectId: null },
              { targetSubject: { trackId: user.trackId ?? undefined } },
            ],
          },
        ],
      },
      select: { id: true, title: true, body: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 3,
    }),
    db.upcomingExam.findMany({
      where: { userId: user.id, examDate: { gte: startOfToday() } },
      select: { id: true, examDate: true, label: true, isBacExam: true, subject: { select: { name: true } } },
      orderBy: { examDate: 'asc' },
      take: 4,
    }),
    db.attempt.count({ where: { user: { id: user.id } } }),
  ]);

  const weakest = findWeakestChapter(progress);
  const hasAnyActivity = recentAttempts > 0;

  return (
    <>
      <PageHeader
        title={`${t.dashboard.greeting}${user.displayName ? `, ${user.displayName.split(' ')[0]}` : ''}`}
        description={t.practice.subtitle}
      />

      {/* Nothing has happened yet — say what to do rather than showing four
          empty cards that all mean "no data". */}
      {!hasAnyActivity && progress.length > 0 && (
        <EmptyState
          className="mb-6"
          tone="neutral"
          title={t.dashboard.noActivity}
          body={t.dashboard.readinessHint}
          action={
            <LinkButton href="/practice" variant="primary">
              {t.dashboard.noActivityCta}
            </LinkButton>
          }
        />
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        {/* --- Readiness per subject --- */}
        <Sheet className="lg:col-span-2">
          <SheetHeader
            title={t.dashboard.readiness}
            description={t.performance.componentsExplain}
            actions={
              <Link
                href="/performance"
                className="text-[13px] font-medium text-primary underline-offset-2 hover:underline"
              >
                {t.performance.title}
              </Link>
            }
          />
          <SheetBody>
            {progress.length === 0 ? (
              <EmptyState
                tone="pending"
                title={t.practice.noQuestions}
                body={t.practice.noQuestionsHint}
              />
            ) : (
              <div className="grid gap-6 sm:grid-cols-2">
                {progress.map((subject) =>
                  subject.readiness.reportable ? (
                    <ReadinessDial
                      key={subject.subjectId}
                      value={subject.readiness.score}
                      label={subject.subjectName}
                      sublabel={
                        subject.readiness.trend === 'up'
                          ? t.performance.trendUp
                          : subject.readiness.trend === 'down'
                            ? t.performance.trendDown
                            : t.performance.trendFlat
                      }
                    />
                  ) : (
                    <div key={subject.subjectId} className="space-y-2">
                      <p className="text-[12.5px] font-medium uppercase tracking-wide text-ink-muted">
                        {subject.subjectName}
                      </p>
                      <p className="font-serif text-lg text-ink-faint">{t.dashboard.readinessNotYet}</p>
                      <p className="text-[12.5px] leading-snug text-ink-muted">
                        {t.dashboard.readinessHint}
                      </p>
                    </div>
                  ),
                )}
              </div>
            )}
          </SheetBody>
        </Sheet>

        {/* --- Today --- */}
        <div className="space-y-5">
          <Sheet>
            <SheetHeader title={t.dashboard.dueToday} />
            <SheetBody>
              {flashcardsDue > 0 ? (
                <div className="space-y-3">
                  <p className="font-serif text-3xl font-semibold tabular-nums leading-none">
                    {flashcardsDue}
                  </p>
                  <p className="text-sm text-ink-muted">
                    {format(t.dashboard.dueTodayCount, { count: flashcardsDue })}
                  </p>
                  <LinkButton href="/flashcards/review" variant="primary" size="sm">
                    {t.flashcards.startReview}
                  </LinkButton>
                </div>
              ) : (
                <EmptyState
                  tone="positive"
                  title={t.dashboard.dueTodayNone}
                  body={t.flashcards.noneDueHint}
                  className="border-0 bg-transparent px-0 py-2"
                />
              )}
            </SheetBody>
          </Sheet>

          <Sheet>
            <SheetHeader title={t.dashboard.upcomingExams} />
            <SheetBody className="p-0">
              {upcomingExams.length === 0 ? (
                <div className="px-5 py-4">
                  <p className="text-sm text-ink-muted">{t.schedule.noUpcomingExams}</p>
                  <Link
                    href="/schedule"
                    className="mt-1 inline-block text-[13px] font-medium text-primary underline-offset-2 hover:underline"
                  >
                    {t.schedule.addExam}
                  </Link>
                </div>
              ) : (
                <ul className="ruled">
                  {upcomingExams.map((exam) => {
                    const days = daysUntil(exam.examDate);
                    return (
                      <li key={exam.id} className="flex items-baseline justify-between gap-3 px-5 py-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-ink">
                            {exam.subject?.name ?? exam.label ?? t.schedule.bacExam}
                          </p>
                          <p className="text-[12px] text-ink-faint">
                            {formatDate(locale, exam.examDate)}
                          </p>
                        </div>
                        <Badge tone={days <= 14 ? 'mark' : days <= 45 ? 'partial' : 'neutral'}>
                          {days === 0
                            ? t.dashboard.daysUntilToday
                            : days === 1
                              ? t.dashboard.daysUntilOne
                              : format(t.dashboard.daysUntil, { count: days })}
                        </Badge>
                      </li>
                    );
                  })}
                </ul>
              )}
            </SheetBody>
          </Sheet>
        </div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        {/* --- Weakest chapter, gated on sample size --- */}
        <Sheet className="lg:col-span-2">
          <SheetHeader title={weakest ? t.dashboard.weakestChapter : t.dashboard.weakestChapterLocked} />
          <SheetBody>
            {weakest ? (
              <div className="group space-y-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-serif text-lg font-semibold text-ink">{weakest.chapterName}</p>
                    <p className="text-[13px] text-ink-muted">
                      {weakest.subjectName}
                      {weakest.unitName ? ` · ${weakest.unitName}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {/* Two ways to act on a weak spot, because they are different
                        sittings: new questions in the chapter, or recall of the
                        ones already met across every weak chapter. */}
                    <LinkButton href="/flashcards/review?scope=weak" size="sm">
                      {t.flashcards.scopeWeak}
                    </LinkButton>
                    <LinkButton
                      href={`/practice/${weakest.subjectId}/${weakest.chapterId}`}
                      variant="primary"
                      size="sm"
                    >
                      {t.performance.practiseThis}
                    </LinkButton>
                  </div>
                </div>
                <Meter
                  value={weakest.masteryScore}
                  label={t.practice.mastery}
                  caption={`${weakest.attemptsCount} ${t.practice.attempts}`}
                />
              </div>
            ) : (
              <EmptyState
                tone="neutral"
                title={t.dashboard.weakestChapterLocked}
                body={format(t.dashboard.weakestChapterLockedHint, { count: MIN_ATTEMPTS_FOR_WEAKNESS })}
                className="border-0 bg-transparent px-0 py-2"
              />
            )}
          </SheetBody>
        </Sheet>

        {/* --- Announcements --- */}
        <Sheet>
          <SheetHeader title={t.dashboard.announcements} />
          <SheetBody className="p-0">
            {announcements.length === 0 ? (
              <p className="px-5 py-4 text-sm text-ink-muted">{t.dashboard.announcementsNone}</p>
            ) : (
              <ul className="ruled">
                {announcements.map((announcement) => (
                  <li key={announcement.id} className="px-5 py-3">
                    <p className="text-sm font-medium text-ink">{announcement.title}</p>
                    <p className="mt-0.5 text-[13px] leading-snug text-ink-muted">{announcement.body}</p>
                    <p className="mt-1 text-[11.5px] text-ink-faint">
                      {formatDate(locale, announcement.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </SheetBody>
        </Sheet>
      </div>
    </>
  );
}

function startOfToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
