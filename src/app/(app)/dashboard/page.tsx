import type { Metadata } from 'next';
import Link from 'next/link';

import { ActivityColumns, BarRows, RingGauge, type BarDatum } from '@/components/ui/charts';
import { LinkButton } from '@/components/ui/button';
import { Badge, EmptyState } from '@/components/ui/feedback';
import { CountUp, Reveal } from '@/components/ui/motion';
import { Meter } from '@/components/ui/progress';
import { PageHeader, Sheet, SheetBody, SheetHeader, StatTile } from '@/components/ui/sheet';
import { requireUser } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { getTranslations } from '@/lib/i18n';
import { daysUntil, format, formatDate } from '@/lib/i18n/format';
import { attemptsByDay, streakFrom } from '@/lib/queries/activity';
import { findWeakestChapter, getProgressForUser } from '@/lib/queries/progress';
import { MIN_ATTEMPTS_FOR_WEAKNESS } from '@/lib/scoring/mastery';

// Browser-tab titles are resolved per request from the user's locale, like
// every other string — a hardcoded French title would follow an English-track
// student around the app.
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslations();
  return { title: t.dashboard.title };
}

/**
 * The dashboard.
 *
 * Read top to bottom it answers four questions in order: how ready am I, what
 * is due now, what have I been doing, and where should I go next. The tiles at
 * the top are the only place in the product that aggregates across subjects, so
 * they are the loudest thing on the screen.
 *
 * Every figure here animates in, and every figure is also plain text — the
 * count-ups and drawn arcs are decoration over numbers that are already
 * rendered. Nothing on this page requires motion to be legible.
 */
export default async function DashboardPage() {
  const user = await requireUser();
  const { locale, t } = await getTranslations();

  const [progress, flashcardsDue, announcements, upcomingExams, totalAttempts, activity] =
    await Promise.all([
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
      attemptsByDay(user.id, 14),
    ]);

  const weakest = findWeakestChapter(progress);
  const hasAnyActivity = totalAttempts > 0;
  const streak = streakFrom(activity);

  const bandLabels = { low: t.practice.bandLow, mid: t.practice.bandMid, high: t.practice.bandHigh };

  // One figure across every subject. Only reportable subjects count — averaging
  // in a subject we have refused to score would be inventing a number.
  const reportable = progress.filter((subject) => subject.readiness.reportable);
  const overallReadiness =
    reportable.length === 0
      ? null
      : reportable.reduce((sum, subject) => sum + subject.readiness.score, 0) / reportable.length;

  // Weakest chapters across every subject, which is the list a student should
  // actually work down. Capped at six: a ranking nobody scrolls is a list.
  const chapterBars: BarDatum[] = progress
    .flatMap((subject) =>
      subject.chapters
        .filter((chapter) => chapter.attemptsCount > 0)
        .map((chapter) => ({
          id: chapter.chapterId,
          label: chapter.chapterName,
          value: chapter.masteryScore,
          detail: `${subject.subjectName} · ${chapter.attemptsCount} ${t.practice.attempts}`,
          href: `/practice/${subject.subjectId}/${chapter.chapterId}`,
        })),
    )
    .sort((a, b) => a.value - b.value)
    .slice(0, 6);

  const nextExam = upcomingExams[0];

  return (
    <>
      <PageHeader
        title={`${t.dashboard.greeting}${user.displayName ? `, ${user.displayName.split(' ')[0]}` : ''}`}
        description={t.practice.subtitle}
        actions={
          flashcardsDue > 0 ? (
            <LinkButton href="/flashcards/review" variant="accent">
              {t.flashcards.startReview}
            </LinkButton>
          ) : null
        }
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

      {/* --- The four headline figures --- */}
      <div className="stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label={t.dashboard.overallReadiness}
          value={overallReadiness === null ? '—' : <PercentFigure value={overallReadiness} />}
          caption={
            overallReadiness === null ? t.dashboard.readinessHint : t.dashboard.overallReadinessHint
          }
          icon="◎"
        />

        <StatTile
          label={t.dashboard.dueToday}
          value={<CountUp value={flashcardsDue} />}
          caption={format(t.dashboard.dueTodayCount, { count: flashcardsDue })}
          tone="accent"
          icon="✦"
          footer={
            flashcardsDue > 0 ? (
              <LinkButton href="/flashcards/review" variant="accent" size="sm">
                {t.flashcards.startReview}
              </LinkButton>
            ) : null
          }
        />

        <StatTile
          label={t.dashboard.streak}
          value={<CountUp value={streak} />}
          caption={t.dashboard.streakHint}
          tone="accent"
          icon="▲"
        />

        <StatTile
          label={t.dashboard.attemptsTotal}
          value={<CountUp value={totalAttempts} />}
          caption={t.dashboard.attemptsTotalHint}
          icon="✎"
        />
      </div>

      {/* --- Readiness per subject, and the habit strip --- */}
      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Reveal className="lg:col-span-2" index={0}>
          <Sheet hero className="h-full">
            <SheetHeader
              title={t.dashboard.readiness}
              description={t.performance.componentsExplain}
              actions={
                <Link
                  href="/performance"
                  className="text-[13px] font-bold text-primary underline-offset-4 transition-colors hover:text-accent hover:underline"
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
                <div className="flex flex-wrap justify-center gap-x-8 gap-y-6 sm:justify-start">
                  {progress.map((subject) =>
                    subject.readiness.reportable ? (
                      <RingGauge
                        key={subject.subjectId}
                        value={subject.readiness.score}
                        label={subject.subjectName}
                        size={140}
                        caption={
                          subject.readiness.trend === 'up'
                            ? `↑ ${t.performance.trendUp}`
                            : subject.readiness.trend === 'down'
                              ? `↓ ${t.performance.trendDown}`
                              : `→ ${t.performance.trendFlat}`
                        }
                      />
                    ) : (
                      <div key={subject.subjectId} className="max-w-[9rem] space-y-1.5 text-center">
                        <div
                          aria-hidden="true"
                          className="mx-auto flex h-[140px] w-[140px] items-center justify-center rounded-full border-[12px] border-dashed border-rule text-2xl text-ink-faint"
                        >
                          ?
                        </div>
                        <p className="text-[13px] font-semibold text-ink">{subject.subjectName}</p>
                        <p className="text-[12px] leading-snug text-ink-muted">
                          {t.dashboard.readinessNotYet}
                        </p>
                      </div>
                    ),
                  )}
                </div>
              )}
            </SheetBody>
          </Sheet>
        </Reveal>

        <Reveal index={1} className="space-y-5">
          <Sheet>
            <SheetHeader title={t.dashboard.activity} description={t.dashboard.activityHint} />
            <SheetBody>
              <ActivityColumns
                data={activity.map((day) => ({
                  id: day.date.toISOString(),
                  label: formatDate(locale, day.date, { day: 'numeric', month: 'short' }),
                  value: day.count,
                  caption: formatDate(locale, day.date, { weekday: 'short', day: 'numeric' }),
                }))}
                emptyLabel={t.dashboard.activityEmpty}
              />
            </SheetBody>
          </Sheet>

          <Sheet>
            <SheetHeader
              title={t.dashboard.upcomingExams}
              actions={
                nextExam ? (
                  <Badge tone={daysUntil(nextExam.examDate) <= 14 ? 'mark' : 'primary'}>
                    {countdownLabel(daysUntil(nextExam.examDate), t)}
                  </Badge>
                ) : null
              }
            />
            <SheetBody className="p-0">
              {upcomingExams.length === 0 ? (
                <div className="px-5 py-4">
                  <p className="text-sm text-ink-muted">{t.schedule.noUpcomingExams}</p>
                  <Link
                    href="/schedule"
                    className="mt-1 inline-block text-[13px] font-bold text-primary underline-offset-4 hover:underline"
                  >
                    {t.schedule.addExam}
                  </Link>
                </div>
              ) : (
                <ul className="ruled">
                  {upcomingExams.map((exam) => {
                    const days = daysUntil(exam.examDate);
                    return (
                      <li
                        key={exam.id}
                        className="flex items-baseline justify-between gap-3 px-5 py-3 transition-colors duration-150 hover:bg-primary-soft/40"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-ink">
                            {exam.subject?.name ?? exam.label ?? t.schedule.bacExam}
                          </p>
                          <p className="text-[12px] text-ink-faint">
                            {formatDate(locale, exam.examDate)}
                          </p>
                        </div>
                        <Badge tone={days <= 14 ? 'mark' : days <= 45 ? 'partial' : 'neutral'}>
                          {countdownLabel(days, t)}
                        </Badge>
                      </li>
                    );
                  })}
                </ul>
              )}
            </SheetBody>
          </Sheet>
        </Reveal>
      </div>

      {/* --- Where to go next --- */}
      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Reveal index={0} className="lg:col-span-2">
          <Sheet className="h-full">
            <SheetHeader title={t.dashboard.topChapters} description={t.dashboard.topChaptersHint} />
            <SheetBody>
              <BarRows
                data={chapterBars}
                bandLabels={bandLabels}
                emptyLabel={t.performance.noDataHint}
              />
            </SheetBody>
          </Sheet>
        </Reveal>

        <Reveal index={1} className="space-y-5">
          {/* Weakest chapter, gated on sample size. */}
          <Sheet>
            <SheetHeader
              title={weakest ? t.dashboard.weakestChapter : t.dashboard.weakestChapterLocked}
            />
            <SheetBody>
              {weakest ? (
                <div className="space-y-3">
                  <div className="min-w-0">
                    <p className="text-[17px] font-extrabold tracking-tight text-ink">
                      {weakest.chapterName}
                    </p>
                    <p className="text-[13px] text-ink-muted">
                      {weakest.subjectName}
                      {weakest.unitName ? ` · ${weakest.unitName}` : ''}
                    </p>
                  </div>

                  <Meter
                    value={weakest.masteryScore}
                    label={t.practice.mastery}
                    caption={`${weakest.attemptsCount} ${t.practice.attempts}`}
                  />

                  {/* Two ways to act on a weak spot, because they are different
                      sittings: new questions in this chapter, or recall of the
                      ones already met across every weak chapter. */}
                  <div className="flex flex-wrap gap-2 pt-1">
                    <LinkButton
                      href={`/practice/${weakest.subjectId}/${weakest.chapterId}`}
                      variant="primary"
                      size="sm"
                    >
                      {t.performance.practiseThis}
                    </LinkButton>
                    <LinkButton href="/flashcards/review?scope=weak" size="sm">
                      {t.flashcards.scopeWeak}
                    </LinkButton>
                  </div>
                </div>
              ) : (
                <EmptyState
                  tone="neutral"
                  title={t.dashboard.weakestChapterLocked}
                  body={format(t.dashboard.weakestChapterLockedHint, {
                    count: MIN_ATTEMPTS_FOR_WEAKNESS,
                  })}
                  className="border-0 bg-transparent px-0 py-2"
                />
              )}
            </SheetBody>
          </Sheet>

          <Sheet>
            <SheetHeader title={t.dashboard.announcements} />
            <SheetBody className="p-0">
              {announcements.length === 0 ? (
                <p className="px-5 py-4 text-sm text-ink-muted">{t.dashboard.announcementsNone}</p>
              ) : (
                <ul className="ruled">
                  {announcements.map((announcement) => (
                    <li key={announcement.id} className="px-5 py-3">
                      <p className="text-sm font-bold text-ink">{announcement.title}</p>
                      <p className="mt-0.5 text-[13px] leading-snug text-ink-muted">
                        {announcement.body}
                      </p>
                      <p className="mt-1 text-[11.5px] text-ink-faint">
                        {formatDate(locale, announcement.createdAt)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </SheetBody>
          </Sheet>
        </Reveal>
      </div>
    </>
  );
}

/** Counts up through the percentage rather than jumping to it. */
function PercentFigure({ value }: { value: number }) {
  return <CountUp value={value} format={(v) => `${Math.round(v * 100)}%`} />;
}

function countdownLabel(days: number, t: { dashboard: { daysUntil: string; daysUntilOne: string; daysUntilToday: string } }): string {
  if (days === 0) return t.dashboard.daysUntilToday;
  if (days === 1) return t.dashboard.daysUntilOne;
  return format(t.dashboard.daysUntil, { count: days });
}

function startOfToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
