import type { Metadata } from 'next';
import Link from 'next/link';

import { SplitHero } from '@/components/dashboard/split-hero';
import { NextUpCard } from '@/components/progress/next-up-card';
import { LinkButton } from '@/components/ui/button';
import { ActivityColumns, BarRows, type BarDatum } from '@/components/ui/charts';
import { Badge, EmptyState } from '@/components/ui/feedback';
import { Meter } from '@/components/ui/progress';
import { PageHeader, Sheet, SheetBody, SheetHeader, StatTile } from '@/components/ui/sheet';
import { requireUser } from '@/lib/auth/guards';
import { cn } from '@/lib/cn';
import { db } from '@/lib/db';
import { getTranslations } from '@/lib/i18n';
import { daysUntil, format, formatDate } from '@/lib/i18n/format';
import { attemptsByDay } from '@/lib/queries/activity';
import { getNextUp } from '@/lib/queries/next-up';
import { findWeakestChapter, getProgressForUser } from '@/lib/queries/progress';
import { getStanding } from '@/lib/queries/standing';
import { MIN_ATTEMPTS_FOR_WEAKNESS } from '@/lib/scoring/mastery';
import { markOutOf20, PASS_MARK } from '@/lib/standing';

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
 * Read top to bottom it answers four questions in order: what should I do now,
 * what am I on, what have I been doing, and where are the marks I am losing.
 *
 * Every figure is a number a Lebanese candidate already understands — a mark
 * out of 20, a count of chapters, a number of days. There is no score this
 * product invented, because a score nobody can interpret is decoration.
 */
export default async function DashboardPage() {
  const user = await requireUser();
  const { locale, t } = await getTranslations();

  const [progress, flashcardsDue, announcements, upcomingExams, activity, standing, nextUp, todaySessions] =
    await Promise.all([
      getProgressForUser(user.id, user.trackId),
      db.flashcardState.count({ where: { userId: user.id, dueDate: { lte: startOfToday() } } }),
      db.announcement.findMany({
        /*
         * Both targeting dimensions are applied.
         *
         * A subject-targeted announcement is implicitly track-targeted — subjects
         * belong to tracks — so it must not reach a student from another track
         * just because its `target_track_id` happens to be null.
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
        select: { id: true, examDate: true, label: true, subject: { select: { name: true } } },
        orderBy: { examDate: 'asc' },
        take: 4,
      }),
      attemptsByDay(user.id, 14),
      getStanding(user.id, user.trackId),
      getNextUp(user.id, user.trackId),
      // Today's plan. A plain read — the dashboard must never wait on a model.
      db.studySession.findMany({
        where: { userId: user.id, scheduledDate: startOfToday() },
        select: {
          id: true,
          title: true,
          durationMinutes: true,
          taskType: true,
          rationale: true,
          status: true,
          chapterId: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

  const weakest = findWeakestChapter(progress);
  const totalAttempts = progress.reduce(
    (sum, subject) => sum + subject.chapters.reduce((n, c) => n + c.attemptsCount, 0),
    0,
  );
  const scale = markOutOf20(1);

  const bandLabels = { low: t.practice.bandLow, mid: t.practice.bandMid, high: t.practice.bandHigh };

  // Weakest chapters across every subject — the list a student should work
  // down. Capped at six: a ranking nobody scrolls is a list.
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

  const heroTiles = progress
    .flatMap((subject) =>
      subject.chapters.map((chapter) => ({
        chapterId: chapter.chapterId,
        chapterName: chapter.chapterName,
        subjectName: subject.subjectName,
        masteryScore: chapter.masteryScore,
        attemptsCount: chapter.attemptsCount,
      })),
    )
    // Weakest first: the grid is scanned, not read, so the thing that needs
    // attention has to be in the first row rather than wherever the syllabus
    // happens to put it.
    .sort((a, b) => {
      if (a.attemptsCount === 0 && b.attemptsCount > 0) return 1;
      if (b.attemptsCount === 0 && a.attemptsCount > 0) return -1;
      return a.masteryScore - b.masteryScore;
    });

  const nextExam = upcomingExams[0] ?? null;

  return (
    <>
      <PageHeader
        title={`${t.dashboard.greeting}${user.displayName ? `, ${user.displayName.split(' ')[0]}` : ''}`}
        description={t.practice.subtitle}
        actions={
          flashcardsDue > 0 ? (
            <LinkButton href="/flashcards/review" variant="primary" size="sm">
              {t.flashcards.startReview}
            </LinkButton>
          ) : null
        }
      />

      <SplitHero
        today={todaySessions}
        tiles={heroTiles}
        flashcardsDue={flashcardsDue}
        examLabel={nextExam?.label ?? nextExam?.subject?.name ?? null}
        daysToExam={nextExam ? daysUntil(nextExam.examDate) : null}
      />

      {totalAttempts === 0 && progress.length > 0 && (
        <EmptyState
          className="mb-5"
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

      <div className="mb-5">
        <NextUpCard next={nextUp} />
      </div>

      {/* --- What am I on ------------------------------------------------- */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label={t.standing.predictedMark}
          tone="mark"
          value={
            standing.overall === null
              ? '—'
              : format(t.standing.outOf, { mark: standing.overall, scale })
          }
          caption={
            standing.overall === null ? t.standing.notEnoughYetHint : t.standing.predictedMarkHint
          }
        />
        <StatTile
          label={t.standing.coverage}
          value={`${Math.round(standing.coverage.ratio * 100)}%`}
          caption={format(t.standing.coverageHint, {
            practised: standing.coverage.practised,
            available: standing.coverage.available,
          })}
        />
        <StatTile
          label={t.dashboard.dueToday}
          value={flashcardsDue}
          caption={format(t.dashboard.dueTodayCount, { count: flashcardsDue })}
        />
        <StatTile
          label={t.standing.daysLeft}
          value={standing.daysToExam === null ? '—' : standing.daysToExam}
          caption={
            standing.examLabel
              ? format(t.standing.daysLeftFor, { label: standing.examLabel })
              : t.standing.noExamDate
          }
        />
      </div>

      {/* --- Marks per subject, and the exam calendar ---------------------- */}
      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Sheet className="lg:col-span-2">
          <SheetHeader
            title={t.standing.bySubject}
            description={t.standing.equalWeighting}
            actions={
              <Link
                href="/progress"
                className="text-[13px] text-primary underline-offset-2 hover:underline"
              >
                {t.standing.title}
              </Link>
            }
          />
          <SheetBody className="p-0">
            {standing.subjects.length === 0 ? (
              <p className="px-5 py-4 text-sm text-ink-muted">{t.practice.noQuestionsHint}</p>
            ) : (
              <ul className="ruled">
                {standing.subjects.map((subject) => (
                  <li
                    key={subject.subjectId}
                    className="flex items-baseline justify-between gap-4 px-5 py-3"
                  >
                    <span className="min-w-0 truncate text-sm text-ink">{subject.subjectName}</span>
                    {subject.mark === null ? (
                      <span className="shrink-0 text-[12.5px] text-ink-faint">
                        {t.standing.notEnoughYet}
                      </span>
                    ) : (
                      <span
                        className={cn(
                          'figure shrink-0 text-[15px]',
                          subject.mark < PASS_MARK ? 'text-mark' : 'text-ink',
                        )}
                      >
                        {format(t.standing.outOf, { mark: subject.mark, scale })}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
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
                  className="mt-1 inline-block text-[13px] text-primary underline-offset-2 hover:underline"
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
                        <p className="truncate text-sm text-ink">
                          {exam.subject?.name ?? exam.label ?? t.schedule.bacExam}
                        </p>
                        <p className="text-[12px] text-ink-faint">
                          {formatDate(locale, exam.examDate)}
                        </p>
                      </div>
                      <Badge tone={days <= 14 ? 'mark' : 'neutral'}>
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

      {/* --- Where the marks are going ------------------------------------ */}
      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Sheet className="lg:col-span-2">
          <SheetHeader title={t.dashboard.topChapters} description={t.dashboard.topChaptersHint} />
          <SheetBody>
            <BarRows data={chapterBars} bandLabels={bandLabels} emptyLabel={t.performance.noDataHint} />
          </SheetBody>
        </Sheet>

        <div className="space-y-5">
          <Sheet>
            <SheetHeader title={t.dashboard.activity} description={t.standing.effort} />
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
              title={weakest ? t.dashboard.weakestChapter : t.dashboard.weakestChapterLocked}
            />
            <SheetBody className="space-y-3">
              {weakest ? (
                <>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">{weakest.chapterName}</p>
                    <p className="text-[12.5px] text-ink-muted">
                      {weakest.subjectName}
                      {weakest.unitName ? ` · ${weakest.unitName}` : ''}
                    </p>
                  </div>

                  <Meter
                    value={weakest.masteryScore}
                    label={t.practice.mastery}
                    caption={`${weakest.attemptsCount} ${t.practice.attempts}`}
                  />

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
                </>
              ) : (
                <p className="text-sm text-ink-muted">
                  {format(t.dashboard.weakestChapterLockedHint, { count: MIN_ATTEMPTS_FOR_WEAKNESS })}
                </p>
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
                      <p className="text-sm font-medium text-ink">{announcement.title}</p>
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
        </div>
      </div>
    </>
  );
}

function startOfToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
