import Link from 'next/link';

import { LinkButton } from '@/components/ui/button';
import { Badge } from '@/components/ui/feedback';
import { StreakBanner, SubjectRings, type SubjectRing } from '@/components/dashboard/subject-rings';
import { TodayTasks } from '@/components/dashboard/today-tasks';
import { Sheet, SheetBody, SheetHeader } from '@/components/ui/sheet';
import { cn } from '@/lib/cn';
import { getTranslations } from '@/lib/i18n';
import { format, formatPlural } from '@/lib/i18n/format';

/**
 * The split hero: what to do today, beside where you stand.
 *
 * Two questions a student opens the app with, answered without scrolling and
 * without waiting on anything — both halves are plain reads of rows the product
 * already computed. Nothing here calls a model, because a dashboard that pauses
 * on a network round-trip is a dashboard people stop opening.
 */

export type TodayTask = {
  id: string;
  title: string;
  durationMinutes: number | null;
  taskType: 'quiz' | 'flashcards' | 'exam_drill' | 'review' | null;
  rationale: string | null;
  status: 'planned' | 'done' | 'skipped';
  chapterId: string | null;
};

const TASK_HREF: Record<NonNullable<TodayTask['taskType']>, string> = {
  quiz: '/practice',
  flashcards: '/flashcards/review',
  exam_drill: '/exam-sim',
  review: '/practice',
};

export async function SplitHero({
  today,
  subjects,
  streak,
  focus,
  flashcardsDue,
  examLabel,
  daysToExam,
}: {
  today: TodayTask[];
  subjects: SubjectRing[];
  streak: number;
  focus: { chapterName: string; percent: number; href: string } | null;
  flashcardsDue: number;
  examLabel: string | null;
  daysToExam: number | null;
}) {
  const { t, locale } = await getTranslations();

  const taskLabel: Record<NonNullable<TodayTask['taskType']>, string> = {
    quiz: t.schedule.taskQuiz,
    flashcards: t.schedule.taskFlashcards,
    exam_drill: t.schedule.taskExamDrill,
    review: t.schedule.taskReview,
  };
  const planned = today.filter((task) => task.status === 'planned');
  const done = today.filter((task) => task.status === 'done').length;
  const totalMinutes = planned.reduce((sum, task) => sum + (task.durationMinutes ?? 0), 0);

  return (
    <div className="mb-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      <Sheet hero>
        <SheetHeader
          title={t.dashboard.todayTitle}
          description={
            planned.length > 0
              ? format(t.dashboard.todaySummary, { count: planned.length, minutes: totalMinutes })
              : t.dashboard.todayNothing
          }
          actions={
            daysToExam !== null && daysToExam >= 0 ? (
              <Badge tone={daysToExam <= 7 ? 'mark' : 'neutral'}>
                {daysToExam === 0
                  ? t.dashboard.examToday
                  : formatPlural(locale, daysToExam, t.dashboard.daysToExamLabel, {
                      label: examLabel ?? t.dashboard.yourExam,
                    })}
              </Badge>
            ) : null
          }
        />
        <SheetBody className="space-y-3">
          <StreakBanner streak={streak} />

          {planned.length === 0 ? (
            <div className="space-y-3">
              <p className="text-meta text-ink-muted">
                {done > 0
                  ? format(t.dashboard.todayAllDone, { count: done })
                  : t.dashboard.todayNoPlan}
              </p>
              <LinkButton href="/schedule" variant={done > 0 ? 'secondary' : 'primary'} size="sm">
                {done > 0 ? t.dashboard.openPlanner : t.schedule.buildPlan}
              </LinkButton>
            </div>
          ) : (
            <TodayTasks tasks={planned} />
          )}

          {/* One thing to aim at this week. Drawn from the student's own
              weakest chapter with enough evidence behind it — never a
              motivational line with no number under it. */}
          {focus ? (
            <Link
              href={focus.href}
              className="block rounded-lg bg-mark-soft px-3.5 py-3 text-meta font-semibold leading-snug text-mark hover:underline"
            >
              {format(t.dashboard.focusThisWeek, {
                chapter: focus.chapterName,
                percent: focus.percent,
              })}
            </Link>
          ) : null}

          {flashcardsDue > 0 ? (
            <p className="border-t border-rule pt-3 text-meta text-ink-muted">
              <Link href="/flashcards/review" className="font-medium text-ink hover:underline">
                {flashcardsDue === 1
                  ? t.dashboard.cardDueCountOne
                  : format(t.dashboard.cardsDueCount, { count: flashcardsDue })}
              </Link>{' '}
              — {t.dashboard.cardsDueHint}
            </p>
          ) : null}
        </SheetBody>
      </Sheet>

      <Sheet>
        <SheetHeader
          title={t.dashboard.yourSubjects}
          description={t.dashboard.yourSubjectsHint}
          actions={
            <Link href="/progress" className="text-meta font-medium hover:underline">
              {t.dashboard.allProgress}
            </Link>
          }
        />
        <SheetBody>
          {subjects.length === 0 ? (
            <p className="text-meta text-ink-muted">{t.dashboard.chaptersPending}</p>
          ) : (
            <SubjectRings subjects={subjects} />
          )}
        </SheetBody>
      </Sheet>
    </div>
  );
}
