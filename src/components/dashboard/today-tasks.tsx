'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { cn } from '@/lib/cn';
import { sendJson } from '@/lib/client/request';
import { useI18n } from '@/lib/i18n/client';

/**
 * Today's plan, tickable in place.
 *
 * A student who has just finished a session should not have to navigate to the
 * planner to say so — the friction is the whole reason plans stop being
 * updated, and a plan nobody updates stops being worth generating.
 *
 * Ticking is optimistic: the row strikes through immediately and the request
 * follows. If it fails the tick is rolled back rather than left showing a
 * completion that was never recorded, because the one thing worse than losing
 * the click is quietly telling someone they finished something they did not.
 */

export type TodayTaskView = {
  id: string;
  title: string;
  durationMinutes: number | null;
  taskType: 'quiz' | 'flashcards' | 'exam_drill' | 'review' | null;
  rationale: string | null;
  status: 'planned' | 'done' | 'skipped';
};

const TASK_HREF: Record<NonNullable<TodayTaskView['taskType']>, string> = {
  quiz: '/practice',
  flashcards: '/flashcards/review',
  exam_drill: '/exam-sim',
  review: '/practice',
};

export function TodayTasks({ tasks }: { tasks: TodayTaskView[] }) {
  const { t, format } = useI18n();
  const router = useRouter();

  const [done, setDone] = useState<Set<string>>(
    () => new Set(tasks.filter((task) => task.status === 'done').map((task) => task.id)),
  );

  const taskLabel: Record<NonNullable<TodayTaskView['taskType']>, string> = {
    quiz: t.schedule.taskQuiz,
    flashcards: t.schedule.taskFlashcards,
    exam_drill: t.schedule.taskExamDrill,
    review: t.schedule.taskReview,
  };

  async function toggle(task: TodayTaskView) {
    const wasDone = done.has(task.id);
    const next = new Set(done);
    if (wasDone) next.delete(task.id);
    else next.add(task.id);
    setDone(next);

    try {
      await sendJson(`/api/schedule/${task.id}`, 'PATCH', {
        status: wasDone ? 'planned' : 'done',
      });
      router.refresh();
    } catch {
      // Put it back. A tick that silently failed is a lie about the student's day.
      setDone((current) => {
        const rolledBack = new Set(current);
        if (wasDone) rolledBack.add(task.id);
        else rolledBack.delete(task.id);
        return rolledBack;
      });
    }
  }

  return (
    <ul className="ruled">
      {tasks.map((task) => {
        const isDone = done.has(task.id);
        return (
          <li key={task.id} className="flex items-start gap-3 py-2.5 first:pt-0">
            <button
              type="button"
              onClick={() => void toggle(task)}
              role="checkbox"
              aria-checked={isDone}
              aria-label={task.title}
              className={cn(
                'mt-0.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-lg border-2 transition-colors duration-200',
                isDone
                  ? 'border-correct-bright bg-correct-bright text-paper-raised'
                  : 'border-rule-strong hover:border-primary',
              )}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 20 20"
                aria-hidden="true"
                className={cn('transition-opacity duration-150', isDone ? 'opacity-100' : 'opacity-0')}
              >
                <polyline
                  points="4,10 8,14 16,5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>

            <div className="min-w-0 flex-1">
              <Link
                href={task.taskType ? TASK_HREF[task.taskType] : '/schedule'}
                className={cn(
                  'text-body font-semibold hover:underline',
                  isDone && 'text-ink-faint line-through',
                )}
              >
                {task.title}
              </Link>
              <p className={cn('mt-0.5 text-caption text-ink-muted', isDone && 'text-ink-faint')}>
                {task.taskType ? taskLabel[task.taskType] : null}
                {task.durationMinutes ? (
                  <>
                    {task.taskType ? ' · ' : null}
                    <span className="numeric">
                      {format(t.dashboard.minutesShort, { minutes: task.durationMinutes })}
                    </span>
                  </>
                ) : null}
                {task.rationale && !isDone ? <> · {task.rationale}</> : null}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
