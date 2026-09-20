import type { Metadata } from 'next';
import Link from 'next/link';

import { FirstSteps } from '@/components/dashboard/first-steps';
import { SplitHero } from '@/components/dashboard/split-hero';
import { streakFrom, type SubjectRing } from '@/components/dashboard/subject-rings';
import { WelcomeHero } from '@/components/dashboard/welcome-hero';
import { NextMove } from '@/components/dashboard/next-move';
import { ReadinessPanel } from '@/components/dashboard/readiness-panel';
import { RecurringLossesCard } from '@/components/dashboard/recurring-losses-card';
import { LinkButton } from '@/components/ui/button';
import { bandForMastery } from '@/components/ui/band';
import { ActivityColumns, BarRows, type BarDatum } from '@/components/ui/charts';
import { Badge, EmptyState } from '@/components/ui/feedback';
import { Meter } from '@/components/ui/progress';
import { Sheet, SheetBody, SheetHeader, StatTile } from '@/components/ui/sheet';
import { requireUser } from '@/lib/auth/guards';
import { cn } from '@/lib/cn';
import { today, toStoredDate } from '@/lib/calendar';
import { db } from '@/lib/db';
import { getTranslations } from '@/lib/i18n';
import { daysUntil, format, formatDate } from '@/lib/i18n/format';
import { attemptsByDay, weeklyEffort } from '@/lib/queries/activity';
import { getFirstSteps } from '@/lib/queries/first-steps';
import { recurringLosses } from '@/lib/queries/recurring-losses';
import { getNextUp } from '@/lib/queries/next-up';
import { nextMoveReason } from '@/lib/queries/next-move';
import { findWeakestChapter, getProgressForUser } from '@/lib/queries/progress';
import { getStanding } from '@/lib/queries/standing';
import { MIN_ATTEMPTS_FOR_WEAKNESS } from '@/lib/scoring/mastery';
import { MIN_ATTEMPTS_FOR_READINESS } from '@/lib/scoring/readiness';
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

  const [
    progress,
    flashcardsDue,
    announcements,
    upcomingExams,
    activity,
    standing,
    nextUp,
    todaySessions,
    week,
    firstSteps,
    losses,
  ] = await Promise.all([
    getProgressForUser(user.id, user.trackId, user.preferredLanguage),
    db.flashcardState.count({ where: { userId: user.id, dueDate: { lte: startOfToday() } } }),
    db.announcement.findMany({
      /*
       * Both targeting dimensions are applied.
       *
       * A subject-targeted announcement is implicitly track-targeted — subjects
       * belong to tracks — so it must not reach a student from another track
       * just because no track was named on the announcement itself.
       *
       * NO TRACK ROWS MEANS EVERY TRACK, which is why `none` is the permissive
       * half of that OR rather than a missing case. Reading it as "targets
       * nothing, show nobody" would silently hide every cohort-wide
       * announcement ever posted.
       */
      where: {
        AND: [
          {
            OR: [
              { tracks: { none: {} } },
              ...(user.trackId ? [{ tracks: { some: { trackId: user.trackId } } }] : []),
            ],
          },
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
    getStanding(user.id, user.trackId, user.preferredLanguage),
    getNextUp(user.id, user.trackId, user.preferredLanguage),
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
    // The last seven days, for the hero's three figures.
    weeklyEffort(user.id),
    getFirstSteps(user.id),
    /*
     * A plain read of what is already stored — no model call. The dashboard
     * must never wait on one, and this is the card a student is most likely to
     * act on, so it must not be the card that makes the page slow.
     */
    recurringLosses(user.id),
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

  // One ring per subject: mean chapter mastery fills it, the predicted mark
  // sits in the middle when there is enough evidence to state one.
  const markBySubject = new Map(standing.subjects.map((s) => [s.subjectId, s.mark]));
  const subjectRings: SubjectRing[] = progress.map((subject) => {
    const chapters = subject.chapters;
    const attemptsCount = chapters.reduce((sum, c) => sum + c.attemptsCount, 0);
    const mastery =
      chapters.length === 0
        ? 0
        : chapters.reduce((sum, c) => sum + c.masteryScore, 0) / chapters.length;
    return {
      subjectId: subject.subjectId,
      subjectName: subject.subjectName,
      mastery,
      mark: markBySubject.get(subject.subjectId) ?? null,
      attemptsCount,
    };
  });

  const streak = streakFrom(activity);

  // Chapters the product would actually call weak — the same threshold the
  // planner and the focus line use, so the hero's count and the card below it
  // can never disagree about what "weak" means.
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

  // The focus line only fires on a chapter with enough attempts behind it to
  // mean something — the same threshold the planner uses to call a chapter weak.
  const focus =
    weakest && weakest.attemptsCount >= MIN_ATTEMPTS_FOR_WEAKNESS
      ? {
          chapterName: weakest.chapterName,
          percent: Math.round(weakest.masteryScore * 100),
          href: `/practice/${weakest.subjectId}/${weakest.chapterId}`,
        }
      : null;

  const nextExam = upcomingExams[0] ?? null;

  /** Minutes still planned for today. Real sessions, real durations. */
  const todayPlannedMinutes = todaySessions
    .filter((session) => session.status === 'planned')
    .reduce((sum, session) => sum + (session.durationMinutes ?? 0), 0);

  /*
   * THE NEXT MOVE, AND THE ARGUMENT FOR IT.
   *
   * The action comes from `getNextUp`, which already ranks what to do. The
   * reason comes from `nextMoveReason`, which ranks what we are ENTITLED to say
   * about it — see that file for the ladder and the tests that pin it. They are
   * separate because a good action with a made-up justification is worse than a
   * good action with none: the first teaches a student the product is guessing.
   */
  const reason = nextMoveReason({ next: nextUp, losses, weakest });

  const reasonText =
    reason.kind === 'recurringLoss'
      ? t.nextMove.reasonLoss
          .replace('{times}', String(reason.times))
          .replace('{subject}', reason.subjectName)
          // The criterion is an examiner's sentence and can run long; the card
          // has to stay readable, so it is cut where a reader can still tell
          // which criterion is meant.
          .replace('{criterion}', reason.criterion.replace(/\s+/g, ' ').slice(0, 90))
          .replace('{points}', String(reason.pointsLost))
      : reason.kind === 'weakChapter'
        ? t.nextMove.reasonWeak
            .replace('{chapter}', reason.chapterName)
            .replace('{percent}', String(reason.percent))
        : reason.kind === 'flashcards'
          ? t.nextMove.reasonCards.replace('{count}', String(reason.count))
          : reason.kind === 'notStarted'
            ? t.nextMove.reasonNew.replace('{chapter}', reason.chapterName)
            : null;

  /* What the action is called, from the same `nextUp` the reason was read from. */
  const moveTitle =
    nextUp.kind === 'flashcards'
      ? t.standing.nextUpDue.replace('{count}', String(nextUp.count))
      : nextUp.kind === 'weakChapter' || nextUp.kind === 'newChapter'
        ? nextUp.chapterName
        : nextUp.kind === 'examSim'
          ? t.standing.nextUpPaper
          : t.standing.nextUpCaughtUp;

  const moveSubject =
    nextUp.kind === 'newChapter'
      ? nextUp.subjectName
      : reason.kind === 'recurringLoss'
        ? reason.subjectName
        : null;

  return (
    <>
      {/*
        Above the hero, not below it. Every number on this page is zero for a
        student who has just signed up, and a card explaining what to do sits
        badly underneath the empty rings it is there to fill.
      */}
      <FirstSteps steps={firstSteps} />

      <WelcomeHero
        firstName={user.displayName?.split(' ')[0] ?? ''}
        sessionCount={todaySessions.filter((s) => s.status === 'planned').length}
        totalMinutes={todaySessions
          .filter((s) => s.status === 'planned')
          .reduce((sum, s) => sum + (s.durationMinutes ?? 0), 0)}
        doneCount={todaySessions.filter((s) => s.status === 'done').length}
        daysToExam={nextExam ? daysUntil(nextExam.examDate) : null}
        streak={streak}
        weekAccuracy={week.accuracy}
        weekAnswered={week.answered}
        weakSpots={weakSpots}
      />

      {/*
        THE DECISION, THEN THE STANDING. In that order and at that weight.
        Everything under this pair is context for a choice the student has
        already been helped to make; putting the statistics first turns the page
        into a report about them rather than an instrument they use.

        Two columns from `lg` and stacked below it, next-move first in both —
        on a phone the readiness figure must not be what a tired student has to
        scroll past to reach the thing to do.
      */}
      <div className="mb-5 grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <NextMove
          eyebrow={t.nextMove.eyebrow}
          subjectName={moveSubject}
          title={moveTitle}
          reason={reasonText}
          href={nextUp.href}
          cta={t.nextMove.start}
          meta={
            todayPlannedMinutes > 0
              ? t.dashboard.minutesShort.replace('{minutes}', String(todayPlannedMinutes))
              : null
          }
        />

        <ReadinessPanel
          mark={standing.overall}
          trend={standing.subjects[0]?.trend ?? null}
          evidenceCount={totalAttempts}
          evidenceNeeded={MIN_ATTEMPTS_FOR_READINESS}
          labels={{
            title: t.nextMove.readinessTitle,
            outOf: t.nextMove.outOf,
            basis: t.nextMove.basis,
            emptyTitle: t.nextMove.emptyTitle,
            emptyBody: t.nextMove.emptyBody,
            emptyProgress: t.nextMove.emptyProgress,
            trendUp: t.nextMove.trendUp,
            trendFlat: t.nextMove.trendFlat,
            trendDown: t.nextMove.trendDown,
          }}
        />
      </div>

      {/*
        Today's plan and the subject rings, demoted from a hero to context. The
        capability is unchanged — same component, same data — but it now sits
        below the decision rather than competing with it.
      */}
      <SplitHero
        today={todaySessions}
        subjects={subjectRings}
        streak={streak}
        focus={focus}
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


      {/*
        Directly under "what to do next", because it is what to watch for while
        doing it. The card removes itself when there is no pattern to report —
        see RecurringLossesCard.
      */}
      {losses.length > 0 && (
        <div className="mb-5">
          <RecurringLossesCard
            losses={losses}
            labels={{
              title: t.dashboard.lossesTitle,
              subtitle: t.dashboard.lossesSubtitle,
              timesLost: t.dashboard.lossesTimes,
              marksLost: t.dashboard.lossesMarks,
              practise: t.dashboard.lossesPractise,
            }}
          />
        </div>
      )}

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
        {/*
          The one figure here a student can act on, so it is the way to act on
          it. The deck overview lost its sidebar entry when the study group was
          cut to the subject and asking — this is now how it is reached, which
          is the right place for it anyway: nobody goes looking for "flashcards"
          without first wondering what is due.
        */}
        <StatTile
          href="/flashcards"
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
                className="text-meta text-primary underline-offset-2 hover:underline"
              >
                {t.standing.title}
              </Link>
            }
          />
          <SheetBody className="p-0">
            {standing.subjects.length === 0 ? (
              <p className="px-5 py-4 text-sm text-ink-muted">{t.practice.noStanding}</p>
            ) : (
              <ul className="ruled">
                {standing.subjects.map((subject) => (
                  <li
                    key={subject.subjectId}
                    className="flex items-baseline justify-between gap-4 px-5 py-3"
                  >
                    <span className="min-w-0 truncate text-sm text-ink">{subject.subjectName}</span>
                    {subject.mark === null ? (
                      <span className="shrink-0 text-meta text-ink-faint">
                        {t.standing.notEnoughYet}
                      </span>
                    ) : (
                      <span
                        className={cn(
                          'figure shrink-0 text-body',
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
                  className="mt-1 inline-block text-meta text-primary underline-offset-2 hover:underline"
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
                        <p className="text-caption text-ink-faint">
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
                    <p className="text-meta text-ink-muted">
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
                      <p className="mt-0.5 text-meta leading-snug text-ink-muted">
                        {announcement.body}
                      </p>
                      <p className="mt-1 text-caption text-ink-faint">
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
