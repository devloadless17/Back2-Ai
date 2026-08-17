import Link from 'next/link';

import { LinkButton } from '@/components/ui/button';
import { Badge } from '@/components/ui/feedback';
import { Sheet, SheetBody, SheetHeader } from '@/components/ui/sheet';
import { cn } from '@/lib/cn';
import { getTranslations } from '@/lib/i18n';
import { format } from '@/lib/i18n/format';

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

export type MasteryTile = {
  chapterId: string;
  chapterName: string;
  subjectName: string;
  masteryScore: number;
  attemptsCount: number;
};

const TASK_HREF: Record<NonNullable<TodayTask['taskType']>, string> = {
  quiz: '/practice',
  flashcards: '/flashcards/review',
  exam_drill: '/exam-sim',
  review: '/practice',
};

/**
 * Four bands, and never colour alone.
 *
 * Each tile prints its percentage as well as its shade, and untouched chapters
 * are drawn as an outline rather than a colour — "we have no idea yet" is a
 * different statement from "you are weak here", and collapsing the two would
 * tell a student they are failing something they have simply not started.
 */
function band(
  tile: MasteryTile,
  labels: { weak: string; developing: string; solid: string; strong: string; notStarted: string },
): { className: string; label: string } {
  if (tile.attemptsCount === 0) {
    return { className: 'border border-dashed border-rule text-ink-faint', label: labels.notStarted };
  }
  const score = tile.masteryScore;
  if (score < 0.4) return { className: 'bg-viz-4 text-paper', label: labels.weak };
  if (score < 0.7) return { className: 'bg-viz-3 text-paper', label: labels.developing };
  if (score < 0.85) return { className: 'bg-viz-2 text-ink', label: labels.solid };
  return { className: 'bg-viz-1 text-ink', label: labels.strong };
}

/**
 * How many tiles the grid shows before it stops.
 *
 * A branch carries up to 190 chapters, nearly all of them untouched for a new
 * student. Rendering every one turns the hero into a wall of identical empty
 * squares that says less than sixty would. Tiles are sorted weakest-first, so
 * the cap only ever hides the part nobody is scanning for.
 */
const MAX_TILES = 72;

export async function SplitHero({
  today,
  tiles,
  flashcardsDue,
  examLabel,
  daysToExam,
}: {
  today: TodayTask[];
  tiles: MasteryTile[];
  flashcardsDue: number;
  examLabel: string | null;
  daysToExam: number | null;
}) {
  const { t } = await getTranslations();

  const taskLabel: Record<NonNullable<TodayTask['taskType']>, string> = {
    quiz: t.schedule.taskQuiz,
    flashcards: t.schedule.taskFlashcards,
    exam_drill: t.schedule.taskExamDrill,
    review: t.schedule.taskReview,
  };
  const bandLabels = {
    weak: t.dashboard.bandWeak,
    developing: t.dashboard.bandDeveloping,
    solid: t.dashboard.bandSolid,
    strong: t.dashboard.bandStrong,
    notStarted: t.dashboard.bandNotStarted,
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
                  : format(t.dashboard.daysToExamLabel, {
                      days: daysToExam,
                      label: examLabel ?? t.dashboard.yourExam,
                    })}
              </Badge>
            ) : null
          }
        />
        <SheetBody className="space-y-3">
          {planned.length === 0 ? (
            <div className="space-y-3">
              <p className="text-[13px] text-ink-muted">
                {done > 0
                  ? format(t.dashboard.todayAllDone, { count: done })
                  : t.dashboard.todayNoPlan}
              </p>
              <LinkButton href="/schedule" variant={done > 0 ? 'secondary' : 'primary'} size="sm">
                {done > 0 ? t.dashboard.openPlanner : t.schedule.buildPlan}
              </LinkButton>
            </div>
          ) : (
            <ul className="space-y-2.5">
              {planned.map((task) => (
                <li key={task.id} className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                  {task.taskType ? <Badge tone="neutral">{taskLabel[task.taskType]}</Badge> : null}
                  {task.durationMinutes ? (
                    <span className="tabular-nums text-[13px] text-ink-muted">{task.durationMinutes} min</span>
                  ) : null}
                  <Link
                    href={task.taskType ? TASK_HREF[task.taskType] : '/schedule'}
                    className="text-[13px] font-medium hover:underline"
                  >
                    {task.title}
                  </Link>
                  {task.rationale ? (
                    <span className="w-full text-[12px] leading-snug text-ink-muted">{task.rationale}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {flashcardsDue > 0 ? (
            <p className="border-t border-rule pt-3 text-[13px] text-ink-muted">
              <Link href="/flashcards/review" className="font-medium text-ink hover:underline">
                {format(t.dashboard.cardsDueCount, { count: flashcardsDue })}
              </Link>{' '}
              — {t.dashboard.cardsDueHint}
            </p>
          ) : null}
        </SheetBody>
      </Sheet>

      <Sheet>
        <SheetHeader
          title={t.dashboard.standingTitle}
          description={t.dashboard.standingSubtitle}
          actions={
            <Link href="/progress" className="text-[13px] font-medium hover:underline">
              {t.dashboard.allProgress}
            </Link>
          }
        />
        <SheetBody className="space-y-4">
          {tiles.length === 0 ? (
            <p className="text-[13px] text-ink-muted">
              {t.dashboard.chaptersPending}
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-1">
                {tiles.slice(0, MAX_TILES).map((tile) => {
                  const { className, label } = band(tile, bandLabels);
                  const percent = Math.round(tile.masteryScore * 100);
                  return (
                    <Link
                      key={tile.chapterId}
                      href={`/practice?chapter=${tile.chapterId}`}
                      title={format(
                        tile.attemptsCount > 0
                          ? t.dashboard.tileDetailWithScore
                          : t.dashboard.tileDetail,
                        {
                          subject: tile.subjectName,
                          chapter: tile.chapterName,
                          band: label,
                          percent,
                          attempts: tile.attemptsCount,
                        },
                      )}
                      aria-label={format(t.dashboard.tileDetail, {
                        subject: tile.subjectName,
                        chapter: tile.chapterName,
                        band: label,
                      })}
                      className={cn(
                        'h-6 w-6 rounded-[4px] transition hover:ring-2 hover:ring-primary/40',
                        className,
                      )}
                    />
                  );
                })}
              </div>

              {tiles.length > MAX_TILES ? (
                <p className="text-[12px] text-ink-muted">
                  {format(t.dashboard.showingWeakest, { count: MAX_TILES })}{' '}
                  <Link href="/progress" className="font-medium text-ink hover:underline">
                    {format(t.dashboard.seeAllChapters, { count: tiles.length })}
                  </Link>
                </p>
              ) : null}

              <div className="flex flex-wrap gap-x-4 gap-y-1.5 border-t border-rule pt-3 text-[12px] text-ink-muted">
                {[
                  { className: 'bg-viz-4', label: bandLabels.weak },
                  { className: 'bg-viz-3', label: bandLabels.developing },
                  { className: 'bg-viz-2', label: bandLabels.solid },
                  { className: 'bg-viz-1', label: bandLabels.strong },
                  { className: 'border border-dashed border-rule', label: bandLabels.notStarted },
                ].map((entry) => (
                  <span key={entry.label} className="flex items-center gap-1.5">
                    <span className={cn('h-3 w-3 rounded-[3px]', entry.className)} />
                    {entry.label}
                  </span>
                ))}
              </div>
            </>
          )}
        </SheetBody>
      </Sheet>
    </div>
  );
}
