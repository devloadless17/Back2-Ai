'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Field, Select } from '@/components/ui/field';
import { Alert, Badge, EmptyState } from '@/components/ui/feedback';
import { Sheet, SheetBody, SheetHeader } from '@/components/ui/sheet';
import { cn } from '@/lib/cn';
import { sendJson } from '@/lib/client/request';
import { useI18n } from '@/lib/i18n/client';

/**
 * Build-a-plan, with the proposal shown before anything is written.
 *
 * The endpoint previews by default; accepting is a second, explicit action.
 * That ordering is the whole point — a plan that appeared in someone's calendar
 * on its own is not a suggestion, and it is the kind of thing a student notices
 * once and does not forgive.
 *
 * Every session carries the reason it was scheduled. A plan a student cannot
 * interrogate is one they follow for three days and then ignore.
 */

export type TaskType = 'quiz' | 'flashcards' | 'exam_drill' | 'review';

export type ProposedSession = {
  chapterId: string;
  title: string;
  scheduledDate: string;
  durationMinutes: number;
  taskType: TaskType;
  rationale: string;
};

type PlanResponse = {
  applied: boolean;
  examDate: string | null;
  horizonDays: number;
  totalMinutes: number;
  reason: 'NO_PROGRESS_YET' | 'NOTHING_WEAK' | null;
  sessions?: ProposedSession[];
  created?: number;
  replaced?: number;
};

/**
 * Task colour is a *hint*, never the carrier of meaning — the label is always
 * printed beside it, so nothing here is lost to a colour-vision difference.
 */
const TASK_TONE: Record<TaskType, string> = {
  quiz: 'bg-viz-3',
  flashcards: 'bg-viz-2',
  exam_drill: 'bg-viz-4',
  review: 'bg-viz-1',
};

function startOfMonth(key: string): Date {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y as number, (m as number) - 1, 1));
}

function toKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function PlanBuilder({ hasExam }: { hasExam: boolean }) {
  const { t, format } = useI18n();
  const router = useRouter();

  const taskLabel: Record<TaskType, string> = {
    quiz: t.schedule.taskQuiz,
    flashcards: t.schedule.taskFlashcards,
    exam_drill: t.schedule.taskExamDrill,
    review: t.schedule.taskReview,
  };

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const [maxDailyMinutes, setMaxDailyMinutes] = useState('120');
  const [restWeekday, setRestWeekday] = useState('0');

  const byDay = useMemo(() => {
    const map = new Map<string, ProposedSession[]>();
    for (const session of plan?.sessions ?? []) {
      const list = map.get(session.scheduledDate) ?? [];
      list.push(session);
      map.set(session.scheduledDate, list);
    }
    return map;
  }, [plan]);

  const peakMinutes = useMemo(() => {
    let peak = 0;
    for (const list of byDay.values()) {
      peak = Math.max(peak, list.reduce((sum, s) => sum + s.durationMinutes, 0));
    }
    return peak || 1;
  }, [byDay]);

  async function run(apply: boolean) {
    setBusy(true);
    setError(null);
    try {
      const result = await sendJson<PlanResponse>('/api/schedule/generate', 'POST', {
        maxDailyMinutes: Number(maxDailyMinutes),
        restWeekday: restWeekday === 'none' ? null : Number(restWeekday),
        apply,
      });
      if (apply) {
        setPlan(null);
        setSelectedDay(null);
        router.refresh();
      } else {
        setPlan(result);
        setSelectedDay(result.sessions?.[0]?.scheduledDate ?? null);
      }
    } catch {
      setError(t.schedule.planError);
    } finally {
      setBusy(false);
    }
  }

  // The calendar spans whatever the plan covers, laid out as real weeks so a
  // student reads it the way they read a calendar rather than as a list.
  const grid = useMemo(() => {
    const days = [...byDay.keys()].sort();
    if (days.length === 0) return [];
    const first = startOfMonth(days[0] as string);
    const last = new Date(`${days[days.length - 1]}T00:00:00.000Z`);

    const cells: (string | null)[] = [];
    const lead = (first.getUTCDay() + 6) % 7; // weeks start Monday
    for (let i = 0; i < lead; i += 1) cells.push(null);

    const cursor = new Date(first);
    while (cursor <= last) {
      cells.push(toKey(cursor));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    while (cells.length % 7 !== 0) cells.push(null);

    const weeks: (string | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
    return weeks;
  }, [byDay]);

  const selected = selectedDay ? (byDay.get(selectedDay) ?? []) : [];

  return (
    <Sheet>
      <SheetHeader
        title={t.schedule.buildPlan}
        description={
          hasExam
            ? t.schedule.planWithExam
            : t.schedule.planWithoutExam
        }
      />
      <SheetBody className="space-y-5">
        {error ? <Alert tone="error" title={t.schedule.planErrorTitle}>{error}</Alert> : null}

        <div className="flex flex-wrap items-end gap-3">
          <Field label={t.schedule.minutesPerDay}>
            {(field) => (
              <Select
                {...field}
                value={maxDailyMinutes}
                onChange={(e) => setMaxDailyMinutes(e.target.value)}
              >
                {['45', '60', '90', '120', '150', '180'].map((value) => (
                  <option key={value} value={value}>
                    {value} min
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t.schedule.dayOff}>
            {(field) => (
              <Select {...field} value={restWeekday} onChange={(e) => setRestWeekday(e.target.value)}>
                <option value="0">Sunday</option>
                <option value="6">Saturday</option>
                <option value="5">Friday</option>
                <option value="none">{t.schedule.noDayOff}</option>
              </Select>
            )}
          </Field>
          <Button onClick={() => void run(false)} disabled={busy}>
            {plan ? t.schedule.rebuild : t.schedule.buildPlan}
          </Button>
          {plan && (plan.sessions?.length ?? 0) > 0 ? (
            <>
              <Button variant="primary" onClick={() => void run(true)} disabled={busy}>
                {format(t.schedule.addToCalendar, { count: plan.sessions?.length ?? 0 })}
              </Button>
              <Button variant="quiet" onClick={() => setPlan(null)} disabled={busy}>
                {t.schedule.discard}
              </Button>
            </>
          ) : null}
        </div>

        {plan && plan.reason === 'NOTHING_WEAK' ? (
          <EmptyState
            tone="positive"
            title={t.schedule.nothingWeakTitle}
            body={t.schedule.nothingWeakBody}
          />
        ) : null}

        {plan && plan.reason === 'NO_PROGRESS_YET' ? (
          <EmptyState
            title={t.schedule.noProgressTitle}
            body={t.schedule.noProgressBody}
          />
        ) : null}

        {plan && (plan.sessions?.length ?? 0) > 0 ? (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink-muted">
              <span className="text-ink">
                {format(t.schedule.planSessionsCount, { count: plan.sessions?.length ?? 0 })}
              </span>
              <span className="text-ink">
                {format(t.schedule.planHoursCount, {
                  hours: Math.round((plan.totalMinutes / 60) * 10) / 10,
                })}
              </span>
              <span>{format(t.schedule.planOverDays, { days: plan.horizonDays })}</span>
              {plan.examDate ? (
                <span>{format(t.schedule.planUpToExam, { date: plan.examDate })}</span>
              ) : null}
              <span className="text-xs">{t.schedule.planNothingSaved}</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[34rem] table-fixed border-separate border-spacing-1">
                <thead>
                  <tr>
                    {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((label) => (
                      <th key={label} className="pb-1 text-xs font-medium text-ink-muted">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {grid.map((week, index) => (
                    <tr key={index}>
                      {week.map((day, dayIndex) => {
                        if (!day) return <td key={dayIndex} />;
                        const sessions = byDay.get(day) ?? [];
                        const minutes = sessions.reduce((sum, s) => sum + s.durationMinutes, 0);
                        const load = minutes / peakMinutes;
                        const isSelected = day === selectedDay;
                        return (
                          <td key={dayIndex}>
                            <button
                              type="button"
                              onClick={() => setSelectedDay(day)}
                              disabled={sessions.length === 0}
                              aria-label={format(t.schedule.planDayLabel, {
                                date: day,
                                count: sessions.length,
                                minutes,
                              })}
                              className={cn(
                                'flex h-16 w-full flex-col items-center justify-center gap-1 rounded-xl border text-xs transition',
                                sessions.length === 0
                                  ? 'border-transparent text-ink-faint'
                                  : 'border-rule hover:border-primary',
                                isSelected && 'border-primary ring-2 ring-primary/30',
                              )}
                              style={
                                sessions.length > 0
                                  ? { background: `hsl(var(--viz-2) / ${0.12 + load * 0.35})` }
                                  : undefined
                              }
                            >
                              <span className="font-medium">{Number(day.slice(8))}</span>
                              {sessions.length > 0 ? (
                                <>
                                  <span className="flex gap-0.5">
                                    {sessions.slice(0, 4).map((s, i) => (
                                      <span
                                        key={i}
                                        className={cn('h-1.5 w-1.5 rounded-full', TASK_TONE[s.taskType])}
                                      />
                                    ))}
                                  </span>
                                  <span className="tabular-nums text-[0.65rem] text-ink-muted">{minutes}m</span>
                                </>
                              ) : null}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap gap-3 text-xs text-ink-muted">
              {(Object.keys(taskLabel) as TaskType[]).map((type) => (
                <span key={type} className="flex items-center gap-1.5">
                  <span className={cn('h-2 w-2 rounded-full', TASK_TONE[type])} />
                  {taskLabel[type]}
                </span>
              ))}
            </div>

            {selectedDay ? (
              <div className="rounded-xl border border-rule p-4">
                <h3 className="mb-3 text-sm font-semibold">{selectedDay}</h3>
                <ul className="space-y-3">
                  {selected.map((session, index) => (
                    <li key={index} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <Badge tone="neutral">{taskLabel[session.taskType]}</Badge>
                      <span className="tabular-nums text-sm text-ink-muted">{session.durationMinutes} min</span>
                      <span className="text-sm font-medium">{session.title}</span>
                      {/* Why this is here. A plan that cannot justify a session
                          is one the student quietly stops trusting. */}
                      <span className="w-full text-xs text-ink-muted">{session.rationale}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </SheetBody>
    </Sheet>
  );
}
