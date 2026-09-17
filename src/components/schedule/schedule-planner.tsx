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
};

export type PlannerExam = {
  id: string;
  examDate: string;
  label: string;
  isBacExam: boolean;
};

type ProposedSession = {
  chapterId: string | null;
  chapterName: string | null;
  title: string;
  scheduledDate: string;
  durationMinutes: number;
  rationale: 'weak' | 'uncovered' | 'consolidate' | 'flashcards';
};

type SuggestResponse = {
  examLabel: string;
  examDate: string;
  daysRemaining: number;
  sessions: ProposedSession[];
};

export function SchedulePlanner({
  sessions,
  exams,
  subjects,
  chapters,
}: {
  sessions: PlannerSession[];
  exams: PlannerExam[];
  subjects: { id: string; name: string }[];
  chapters: { id: string; name: string }[];
}) {
  const { t, formatDate } = useI18n();
  const router = useRouter();

  const [busy, setBusy] = useState(false);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<SuggestResponse | null>(null);
  const [suggestingFor, setSuggestingFor] = useState(exams[0]?.id ?? '');

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
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [chapterId, setChapterId] = useState('');
  /** Highlights the title field while a chapter is being dragged over it. */
  const [dropActive, setDropActive] = useState(false);
  const [chapterQuery, setChapterQuery] = useState('');

  /*
   * Filling the session from a chapter, however the student got here.
   *
   * One function behind three gestures — drop, click, Enter — because drag is
   * the nicest of the three and the only one that does not work on a phone or
   * from a keyboard. Building this as drag-only would have made the feature
   * unavailable to most of the people using the product.
   */
  function useChapter(chapter: { id: string; name: string }) {
    setTitle(chapter.name);
    setChapterId(chapter.id);
    setDropActive(false);
  }

  // Cheap on a few hundred chapters, and it keeps the list usable — dragging
  // from a list you have to scroll for a minute is worse than typing.
  const chapterMatches = chapterQuery.trim()
    ? chapters.filter((c) => c.name.toLowerCase().includes(chapterQuery.trim().toLowerCase())).slice(0, 8)
    : chapters.slice(0, 8);

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

  async function suggest() {
    if (!suggestingFor) return;
    setBusy(true);
    setError(null);
    try {
      const plan = await sendJson<SuggestResponse>('/api/schedule/suggest', 'POST', {
        upcomingExamId: suggestingFor,
      });
      setProposal(plan);
    } catch {
      setError(t.common.unknownError);
    } finally {
      setBusy(false);
    }
  }

  async function acceptPlan() {
    if (!proposal) return;
    setBusy(true);
    try {
      await sendJson('/api/schedule', 'POST', {
        sessions: proposal.sessions.map((session) => ({
          title: session.title,
          scheduledDate: session.scheduledDate,
          chapterId: session.chapterId,
          durationMinutes: session.durationMinutes,
          source: 'ai_suggested',
        })),
      });
      setProposal(null);
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

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-5">
      {error && <Alert tone="error">{error}</Alert>}

      {/* --- Proposed plan (staging) --- */}
      {proposal && (
        <Sheet className="animate-fade-up border-primary/30">
          <SheetHeader
            title={t.schedule.suggestedTitle}
            description={`${proposal.examLabel} · ${formatDate(proposal.examDate)} · ${proposal.daysRemaining}`}
          />
          <SheetBody className="p-0">
            <p className="px-5 py-3 text-meta text-ink-muted">{t.schedule.suggestedBody}</p>
            <ul className="ruled max-h-96 overflow-y-auto">
              {proposal.sessions.map((session, index) => (
                <li key={`${session.scheduledDate}-${index}`} className="flex items-baseline gap-3 px-5 py-2.5">
                  <span className="w-24 shrink-0 text-caption tabular-nums text-ink-faint">
                    {session.scheduledDate}
                  </span>
                  <span className="min-w-0 flex-1 text-body text-ink">{session.title}</span>
                  <Badge tone={session.rationale === 'uncovered' ? 'mark' : session.rationale === 'weak' ? 'partial' : 'neutral'}>
                    {session.chapterName ?? t.flashcards.title}
                  </Badge>
                  <button
                    type="button"
                    onClick={() =>
                      setProposal({
                        ...proposal,
                        sessions: proposal.sessions.filter((_, i) => i !== index),
                      })
                    }
                    className="shrink-0 text-caption text-ink-faint hover:text-mark"
                    aria-label={t.common.delete}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </SheetBody>
          <SheetFooter className="justify-end">
            <Button variant="quiet" onClick={() => setProposal(null)}>
              {t.schedule.discardPlan}
            </Button>
            <Button variant="primary" onClick={acceptPlan} loading={busy}>
              {t.schedule.acceptPlan}
            </Button>
          </SheetFooter>
        </Sheet>
      )}

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
              <WeekGrid sessions={sessions} exams={exams} onSetStatus={setStatus} />
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
                        'mb-2 text-caption font-semibold uppercase tracking-wide',
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
          {/* --- Add a session --- */}
          <Sheet>
            <SheetHeader title={t.schedule.addSession} />
            <SheetBody className="space-y-3">
              {/*
                The title field doubles as a drop target.

                Typing still works and is untouched — this only adds a second
                way in. `onDragOver` has to call `preventDefault` or the browser
                refuses the drop, which is the usual reason a drop target looks
                right and does nothing.
              */}
              <Field label={t.schedule.sessionTitle} hint={t.schedule.dropHint}>
                {({ id }) => (
                  <Input
                    id={id}
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    onDragOver={(event) => {
                      event.preventDefault();
                      setDropActive(true);
                    }}
                    onDragLeave={() => setDropActive(false)}
                    onDrop={(event) => {
                      event.preventDefault();
                      const id = event.dataTransfer.getData('text/chapter-id');
                      const name = event.dataTransfer.getData('text/plain');
                      if (id && name) useChapter({ id, name });
                    }}
                    className={cn(dropActive && 'border-primary bg-primary-soft')}
                  />
                )}
              </Field>

              {/*
                The chapters, draggable.

                They were already reachable through the select below, which
                answers "link this to a chapter" but not "what should I study?".
                This list answers the second question: it is the same data, put
                where the decision is actually made, and picking one fills the
                title and the link together.
              */}
              <div className="rounded-lg border border-rule bg-paper-sunken/50 p-2.5">
                <Input
                  value={chapterQuery}
                  onChange={(event) => setChapterQuery(event.target.value)}
                  placeholder={t.schedule.chapterSearch}
                  aria-label={t.schedule.chapterSearch}
                  className="mb-2 h-8 text-caption"
                />
                <ul className="max-h-44 space-y-1 overflow-y-auto">
                  {chapterMatches.map((chapter) => (
                    <li key={chapter.id}>
                      <button
                        type="button"
                        draggable
                        onDragStart={(event) => {
                          event.dataTransfer.setData('text/chapter-id', chapter.id);
                          event.dataTransfer.setData('text/plain', chapter.name);
                          event.dataTransfer.effectAllowed = 'copy';
                        }}
                        onDragEnd={() => setDropActive(false)}
                        onClick={() => useChapter(chapter)}
                        className={cn(
                          'w-full cursor-grab rounded px-2.5 py-1.5 text-start text-caption',
                          'text-ink-muted transition-colors duration-150',
                          'hover:bg-primary-soft hover:text-ink active:cursor-grabbing',
                          chapterId === chapter.id && 'bg-primary-soft font-semibold text-ink',
                        )}
                      >
                        {chapter.name}
                      </button>
                    </li>
                  ))}
                  {chapterMatches.length === 0 && (
                    <li className="px-2.5 py-1.5 text-caption text-ink-faint">
                      {t.performance.noDataHint}
                    </li>
                  )}
                </ul>
              </div>
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

          {/* --- Suggest --- */}
          <Sheet>
            <SheetHeader title={t.schedule.suggest} description={t.schedule.suggestFor} />
            <SheetBody className="space-y-3">
              {exams.length === 0 ? (
                <p className="text-sm text-ink-muted">{t.schedule.noUpcomingExams}</p>
              ) : (
                <Select
                  value={suggestingFor}
                  onChange={(event) => setSuggestingFor(event.target.value)}
                  aria-label={t.schedule.suggestFor}
                >
                  {exams.map((exam) => (
                    <option key={exam.id} value={exam.id}>
                      {exam.label} · {exam.examDate}
                    </option>
                  ))}
                </Select>
              )}
            </SheetBody>
            <SheetFooter className="justify-end">
              <Button
                variant="primary"
                size="sm"
                onClick={suggest}
                loading={busy}
                disabled={exams.length === 0}
              >
                {busy ? t.schedule.suggesting : t.schedule.suggest}
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
        'rounded px-2.5 py-1 text-caption font-semibold transition-colors duration-150',
        active ? 'bg-primary-soft text-primary' : 'text-ink-faint hover:bg-paper-sunken hover:text-ink',
      )}
    >
      {label}
    </button>
  );
}
