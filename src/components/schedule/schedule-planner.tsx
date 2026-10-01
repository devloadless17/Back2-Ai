'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { Alert, Badge, EmptyState } from '@/components/ui/feedback';
import { Sheet, SheetBody, SheetFooter, SheetHeader } from '@/components/ui/sheet';
import { cn } from '@/lib/cn';
import { sendJson } from '@/lib/client/request';
import { useI18n } from '@/lib/i18n/client';
import { WeekGrid } from '@/components/schedule/week-grid';

/**
 * Manual planner plus the suggestion flow.
 *
 * A suggested plan lands in a staging area — visible, editable, discardable —
 * and only becomes real sessions when the student presses accept. That is the
 * whole reason the suggest endpoint writes nothing: the difference between a
 * tool that proposes and a tool that helps itself to your calendar is one the
 * student notices immediately and does not forgive.
 */

/** Where the chosen view is remembered. Per device, like a zoom level. */
const VIEW_KEY = 'bac2_schedule_view';

export type PlannerSession = {
  id: string;
  title: string;
  scheduledDate: string;
  durationMinutes: number | null;
  source: 'manual' | 'ai_suggested';
  status: 'planned' | 'done' | 'skipped';
  chapterName: string | null;
  /** Subject first in the card hierarchy, so it needs its own field. */
  subjectName: string | null;
  /** What the session asks the student to DO. A plan of chapter names is a list. */
  taskType: 'quiz' | 'flashcards' | 'exam_drill' | 'review' | null;
};

export type PlannerExam = {
  id: string;
  examDate: string;
  label: string;
  isBacExam: boolean;
};

export function SchedulePlanner({
  sessions,
  exams,
  subjects,
  chapters,
  todayKey,
}: {
  sessions: PlannerSession[];
  exams: PlannerExam[];
  subjects: { id: string; name: string }[];
  chapters: { id: string; name: string }[];
  /** Today in Beirut, decided on the server. See `src/lib/calendar.ts`. */
  todayKey: string;
}) {
  const { t, formatDate } = useI18n();
  const router = useRouter();

  const [busy, setBusy] = useState(false);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /*
   * Which way the plan is shown.
   *
   * Two views because there are two questions. The list answers "what do I do
   * next" — only days with something on them, each with its actions to hand.
   * The week answers "what does my week look like" — where the gaps are, which
   * day is already full, how long until the paper on Thursday. A student trying
   * to feel on top of their revision is asking the second, and a list of three
   * dated headings cannot answer it.
   *
   * Remembered per device, because it is a preference about how somebody reads
   * a calendar and not something to re-choose on every visit. Wrapped because
   * storage throws outright in a private window rather than returning null.
   */
  const [view, setView] = useState<'list' | 'week'>('week');

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(VIEW_KEY);
      if (saved === 'list' || saved === 'week') setView(saved);
    } catch {
      // A browser that refuses storage still gets the default.
    }
  }, []);

  function chooseView(next: 'list' | 'week') {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_KEY, next);
    } catch {
      // Nothing to do — the choice still holds for this visit.
    }
  }

  // --- Manual add ---------------------------------------------------------
  const [title, setTitle] = useState('');
  /*
   * The add-session form opens on the student's today, taken from the server.
   * `new Date()` here is the browser's clock in the browser's timezone, which
   * is a different day from the plan's for anyone up after midnight — and the
   * form would then default to a day the page is not showing.
   */
  const [date, setDate] = useState(todayKey);
  const [chapterId, setChapterId] = useState('');

  // --- Exam add -----------------------------------------------------------
  const [examDate, setExamDate] = useState('');
  const [examSubjectId, setExamSubjectId] = useState('');

  async function addSession() {
    if (!title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await sendJson('/api/schedule', 'POST', {
        title: title.trim(),
        scheduledDate: date,
        chapterId: chapterId || null,
        source: 'manual',
      });
      setTitle('');
      setChapterId('');
      router.refresh();
    } catch {
      setError(t.common.unknownError);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Move a session to another day.
   *
   * `/api/schedule/[id]` has accepted `scheduledDate` on PATCH since it was
   * written and nothing ever called it, so a student whose Tuesday did not
   * happen could mark it skipped or delete it and had no way to say "not then,
   * Thursday". Missing work that can only be erased or confessed to is how a
   * plan stops being used.
   *
   * Nothing is rescheduled automatically. A plan that quietly rearranges
   * itself behind someone is a plan they no longer recognise as theirs.
   */
  async function moveSession(id: string, scheduledDate: string) {
    setBusy(true);
    try {
      await sendJson(`/api/schedule/${id}`, 'PATCH', { scheduledDate });
      setMovingId(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(id: string, status: PlannerSession['status']) {
    try {
      await sendJson(`/api/schedule/${id}`, 'PATCH', { status });
      router.refresh();
    } catch {
      setError(t.common.unknownError);
    }
  }

  async function remove(id: string) {
    try {
      await sendJson(`/api/schedule/${id}`, 'DELETE');
      router.refresh();
    } catch {
      setError(t.common.unknownError);
    }
  }

  async function addExam() {
    if (!examDate) return;
    setBusy(true);
    try {
      await sendJson('/api/exams', 'POST', {
        examDate,
        subjectId: examSubjectId || null,
      });
      setExamDate('');
      setExamSubjectId('');
      router.refresh();
    } catch {
      setError(t.common.unknownError);
    } finally {
      setBusy(false);
    }
  }

  const byDate = new Map<string, PlannerSession[]>();
  for (const session of sessions) {
    byDate.set(session.scheduledDate, [...(byDate.get(session.scheduledDate) ?? []), session]);
  }

  const today = todayKey;

  return (
    <div className="space-y-5">
      {error && <Alert tone="error">{error}</Alert>}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* --- The calendar --- */}
        <Sheet>
          <SheetHeader
            title={t.schedule.title}
            actions={
              <div className="flex gap-1" role="group" aria-label={t.schedule.viewLabel}>
                <ViewButton
                  active={view === 'week'}
                  onClick={() => chooseView('week')}
                  label={t.schedule.viewWeek}
                />
                <ViewButton
                  active={view === 'list'}
                  onClick={() => chooseView('list')}
                  label={t.schedule.viewList}
                />
              </div>
            }
          />
          <SheetBody className={view === 'week' ? 'p-4' : 'p-0'}>
            {view === 'week' ? (
              <WeekGrid
                sessions={sessions}
                exams={exams}
                todayKey={todayKey}
                onSetStatus={setStatus}
                onMove={moveSession}
              />
            ) : (
          <>
            {sessions.length === 0 ? (
              <EmptyState
                tone="neutral"
                title={t.schedule.empty}
                body={t.schedule.emptyHint}
                className="m-4 border-0 bg-transparent"
              />
            ) : (
              <ul className="ruled">
                {[...byDate.entries()].map(([day, daySessions]) => (
                  <li key={day} className="px-5 py-3">
                    <p
                      className={cn(
                        'mb-2 text-caption font-medium uppercase tracking-wide',
                        day === today ? 'text-primary' : 'text-ink-faint',
                      )}
                    >
                      {day === today ? t.common.today : formatDate(day, { weekday: 'long', day: 'numeric', month: 'long' })}
                    </p>

                    <ul className="space-y-1.5">
                      {daySessions.map((session) => (
                        <li
                          key={session.id}
                          className={cn(
                            'flex items-center gap-3 rounded border px-3 py-2 transition-colors duration-150',
                            session.status === 'done'
                              ? 'border-correct/25 bg-correct-soft'
                              : session.status === 'skipped'
                                ? 'border-rule bg-paper-sunken opacity-60'
                                : 'border-rule-strong bg-paper-raised',
                          )}
                        >
                          <div className="min-w-0 flex-1">
                            <p
                              className={cn(
                                'truncate text-body text-ink',
                                session.status === 'done' && 'line-through decoration-correct/40',
                              )}
                            >
                              {session.title}
                            </p>
                            {session.chapterName && (
                              <p className="truncate text-caption text-ink-faint">{session.chapterName}</p>
                            )}
                          </div>

                          {session.source === 'ai_suggested' && (
                            <Badge tone="primary">{t.schedule.suggest}</Badge>
                          )}

                          {session.status === 'planned' ? (
                            <div className="flex shrink-0 gap-1">
                              <button
                                type="button"
                                onClick={() => setStatus(session.id, 'done')}
                                className="rounded px-2 py-1 text-caption font-medium text-correct hover:bg-correct-soft"
                              >
                                {t.schedule.markDone}
                              </button>
                              <button
                                type="button"
                                onClick={() => setStatus(session.id, 'skipped')}
                                className="rounded px-2 py-1 text-caption text-ink-faint hover:bg-paper-sunken"
                              >
                                {t.schedule.markSkipped}
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setMovingId(movingId === session.id ? null : session.id)
                                }
                                aria-expanded={movingId === session.id}
                                className="rounded px-2 py-1 text-caption text-ink-faint hover:bg-paper-sunken"
                              >
                                {t.schedule.move}
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => remove(session.id)}
                              className="shrink-0 rounded px-2 py-1 text-caption text-ink-faint hover:text-mark"
                            >
                              {t.common.delete}
                            </button>
                          )}

                          {movingId === session.id && (
                            <label className="flex w-full shrink-0 items-center gap-2 pt-2 text-caption text-ink-muted">
                              <span>{t.schedule.moveTo}</span>
                              <input
                                type="date"
                                defaultValue={session.scheduledDate}
                                disabled={busy}
                                onChange={(e) => {
                                  if (e.target.value) moveSession(session.id, e.target.value);
                                }}
                                className="rounded-sm border border-rule bg-paper px-2 py-1 text-sm text-ink"
                              />
                            </label>
                          )}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </>
            )}
          </SheetBody>
        </Sheet>

        <div className="space-y-5">
          {/* --- Add a session ---
              The id is the target of the empty Today state's one action. A
              link that scrolls nowhere is the dead button this phase was told
              not to ship. */}
          <Sheet id="add-session">
            <SheetHeader title={t.schedule.addSession} />
            <SheetBody className="space-y-3">
              <Field label={t.schedule.sessionTitle}>
                {({ id }) => (
                  <Input
                    id={id}
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                  />
                )}
              </Field>

              <Field label={t.schedule.date}>
                {({ id }) => (
                  <Input
                    id={id}
                    type="date"
                    value={date}
                    onChange={(event) => setDate(event.target.value)}
                  />
                )}
              </Field>
              <Field label={t.schedule.chapter} hint={t.todos.noLink}>
                {({ id }) => (
                  <Select id={id} value={chapterId} onChange={(event) => setChapterId(event.target.value)}>
                    <option value="">{t.todos.noLink}</option>
                    {chapters.map((chapter) => (
                      <option key={chapter.id} value={chapter.id}>
                        {chapter.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </SheetBody>
            <SheetFooter className="justify-end">
              <Button variant="primary" size="sm" onClick={addSession} loading={busy}>
                {t.common.save}
              </Button>
            </SheetFooter>
          </Sheet>

          {/* --- Exam dates --- */}
          <Sheet>
            <SheetHeader title={t.schedule.upcomingExams} />
            <SheetBody className="space-y-3">
              <ul className="space-y-1">
                {exams.map((exam) => (
                  <li key={exam.id} className="flex items-baseline justify-between gap-2 text-meta">
                    <span className="min-w-0 truncate text-ink">{exam.label}</span>
                    <span className="shrink-0 tabular-nums text-ink-faint">{exam.examDate}</span>
                  </li>
                ))}
              </ul>

              <div className="space-y-2 border-t border-rule pt-3">
                <Input
                  type="date"
                  value={examDate}
                  onChange={(event) => setExamDate(event.target.value)}
                  aria-label={t.schedule.addExam}
                />
                <Select
                  value={examSubjectId}
                  onChange={(event) => setExamSubjectId(event.target.value)}
                  aria-label={t.admin.targetSubject}
                >
                  <option value="">{t.admin.allSubjects}</option>
                  {subjects.map((subject) => (
                    <option key={subject.id} value={subject.id}>
                      {subject.name}
                    </option>
                  ))}
                </Select>
                <Button size="sm" fullWidth onClick={addExam} loading={busy} disabled={!examDate}>
                  {t.schedule.addExam}
                </Button>
              </div>
            </SheetBody>
          </Sheet>
        </div>
      </div>
    </div>
  );
}

/** One of the two ways to read a plan. */
function ViewButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded px-2.5 py-1 text-caption font-medium transition-colors duration-150',
        active ? 'bg-primary-soft text-primary' : 'text-ink-faint hover:bg-paper-sunken hover:text-ink',
      )}
    >
      {label}
    </button>
  );
}
