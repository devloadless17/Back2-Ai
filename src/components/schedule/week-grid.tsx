'use client';

import { useMemo, useState } from 'react';

import { Badge } from '@/components/ui/feedback';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n/client';
import type { PlannerExam, PlannerSession } from '@/components/schedule/schedule-planner';

/**
 * The week, as a week.
 *
 * The list this sits beside answers "what do I do next" and answers it well:
 * only days with something on them appear, each with its actions to hand. What
 * it cannot show is the shape of a week — where the free evenings are, which
 * day is already full, how many days are left before Thursday's paper. A
 * student trying to feel on top of their revision is asking the second question,
 * and a list of three dated headings is the wrong instrument for it.
 *
 * So: seven columns, including the empty ones, because the empty ones are the
 * information. A gap you can see is a gap you can plan into.
 *
 * The one thing taken from the competitor's version and deliberately reversed:
 * theirs prints "no tasks this day" in every empty column, so a new student's
 * first view of their planner is the same sentence five times over. An empty day
 * here is quiet — a faint outline and a plus. The grid should show you the gap,
 * not lecture you about it.
 */

const DAY_MS = 86_400_000;

function startOfWeek(from: Date): Date {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  // Monday, because a Lebanese school week does not begin on Sunday and a
  // planner that disagrees with the week the student is living is friction.
  const shift = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - shift);
  return d;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

export function WeekGrid({
  sessions,
  exams,
  onSetStatus,
}: {
  sessions: PlannerSession[];
  exams: PlannerExam[];
  onSetStatus: (id: string, status: PlannerSession['status']) => void;
}) {
  const { t, formatDate } = useI18n();
  /** Weeks away from the current one. Zero is this week. */
  const [offset, setOffset] = useState(0);

  const today = iso(new Date());

  const days = useMemo(() => {
    const first = startOfWeek(new Date());
    first.setUTCDate(first.getUTCDate() + offset * 7);
    return Array.from({ length: 7 }, (_, i) => iso(new Date(first.getTime() + i * DAY_MS)));
  }, [offset]);

  const byDate = useMemo(() => {
    const map = new Map<string, PlannerSession[]>();
    for (const session of sessions) {
      map.set(session.scheduledDate, [...(map.get(session.scheduledDate) ?? []), session]);
    }
    return map;
  }, [sessions]);

  const examsByDate = useMemo(() => {
    const map = new Map<string, PlannerExam[]>();
    for (const exam of exams) {
      map.set(exam.examDate, [...(map.get(exam.examDate) ?? []), exam]);
    }
    return map;
  }, [exams]);

  /*
   * What the week actually came to. Shown because "3 of 5 done" is the sentence
   * that makes a plan feel like a plan rather than a list of intentions — and
   * because a student who has done everything should be told so.
   */
  const inWeek = days.flatMap((day) => byDate.get(day) ?? []);
  const done = inWeek.filter((s) => s.status === 'done').length;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 px-1">
        <div className="flex items-center gap-1">
          <NavButton onClick={() => setOffset((o) => o - 1)} label="‹" title={t.common.previous} />
          <button
            type="button"
            onClick={() => setOffset(0)}
            className={cn(
              'rounded px-2.5 py-1 text-caption font-semibold transition-colors',
              offset === 0 ? 'text-ink-faint' : 'text-primary hover:bg-primary-soft',
            )}
            disabled={offset === 0}
          >
            {t.common.today}
          </button>
          <NavButton onClick={() => setOffset((o) => o + 1)} label="›" title={t.common.next} />
        </div>

        <p className="text-caption text-ink-muted">
          {formatDate(days[0]!, { day: 'numeric', month: 'short' })} —{' '}
          {formatDate(days[6]!, { day: 'numeric', month: 'short' })}
          {inWeek.length > 0 && (
            <span className="ms-2 font-semibold text-ink">
              {done}/{inWeek.length}
            </span>
          )}
        </p>
      </div>

      <div className="scroll-x">
        <div className="grid min-w-[44rem] grid-cols-7 gap-2">
          {days.map((day) => {
            const daySessions = byDate.get(day) ?? [];
            const dayExams = examsByDate.get(day) ?? [];
            const isToday = day === today;
            const isPast = day < today;

            return (
              <div key={day} className="min-w-0">
                <div
                  className={cn(
                    'mb-1.5 px-1 text-center',
                    isToday ? 'text-primary' : isPast ? 'text-ink-faint' : 'text-ink-muted',
                  )}
                >
                  <p className="text-micro font-semibold uppercase tracking-wide">
                    {formatDate(day, { weekday: 'short' })}
                  </p>
                  <p
                    className={cn(
                      'numeric text-body font-extrabold',
                      isToday && 'text-primary',
                    )}
                  >
                    {formatDate(day, { day: 'numeric' })}
                  </p>
                </div>

                <div
                  className={cn(
                    'min-h-[7rem] space-y-1.5 rounded-lg border p-1.5',
                    isToday
                      ? 'border-primary/40 bg-primary-soft/40'
                      : daySessions.length === 0
                        ? 'border-dashed border-rule'
                        : 'border-rule bg-paper-raised',
                  )}
                >
                  {dayExams.map((exam) => (
                    <div key={exam.id} className="rounded bg-mark-soft px-2 py-1">
                      <p className="truncate text-micro font-bold text-mark">{exam.label}</p>
                    </div>
                  ))}

                  {daySessions.map((session) => (
                    <button
                      key={session.id}
                      type="button"
                      onClick={() =>
                        onSetStatus(session.id, session.status === 'done' ? 'planned' : 'done')
                      }
                      title={session.chapterName ?? session.title}
                      className={cn(
                        'block w-full rounded px-2 py-1.5 text-start transition-colors duration-150',
                        session.status === 'done'
                          ? 'bg-correct-soft text-correct'
                          : session.status === 'skipped'
                            ? 'bg-paper-sunken text-ink-faint line-through'
                            : 'bg-paper-sunken text-ink hover:bg-primary-soft',
                      )}
                    >
                      <span className="block truncate text-micro font-semibold leading-tight">
                        {session.status === 'done' ? '✓ ' : ''}
                        {session.title}
                      </span>
                      {session.durationMinutes ? (
                        <span className="numeric block text-micro text-ink-faint">
                          {session.durationMinutes}′
                        </span>
                      ) : null}
                    </button>
                  ))}

                  {/* Quiet. An empty day is a gap to plan into, not a message. */}
                  {daySessions.length === 0 && dayExams.length === 0 && (
                    <p className="pt-4 text-center text-micro text-ink-faint/60" aria-hidden="true">
                      +
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {inWeek.length > 0 && done === inWeek.length && (
        <p className="mt-3 px-1">
          <Badge tone="correct">{t.schedule.weekAllDone}</Badge>
        </p>
      )}
    </div>
  );
}

function NavButton({ onClick, label, title }: { onClick: () => void; label: string; title: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={title}
      className="rounded px-2 py-1 text-body text-ink-muted transition-colors hover:bg-paper-sunken hover:text-ink"
    >
      {label}
    </button>
  );
}
