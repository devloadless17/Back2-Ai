'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { Alert, Badge, EmptyState } from '@/components/ui/feedback';
import { Sheet, SheetBody, SheetFooter, SheetHeader } from '@/components/ui/sheet';
import { cn } from '@/lib/cn';
import { sendJson } from '@/lib/client/request';
import { useI18n } from '@/lib/i18n/client';

/**
 * Manual planner plus the suggestion flow.
 *
 * A suggested plan lands in a staging area — visible, editable, discardable —
 * and only becomes real sessions when the student presses accept. That is the
 * whole reason the suggest endpoint writes nothing: the difference between a
 * tool that proposes and a tool that helps itself to your calendar is one the
 * student notices immediately and does not forgive.
 */

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
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<SuggestResponse | null>(null);
  const [suggestingFor, setSuggestingFor] = useState(exams[0]?.id ?? '');

  // --- Manual add ---------------------------------------------------------
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
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
            <p className="px-5 py-3 text-[13px] text-ink-muted">{t.schedule.suggestedBody}</p>
            <ul className="ruled max-h-96 overflow-y-auto">
              {proposal.sessions.map((session, index) => (
                <li key={`${session.scheduledDate}-${index}`} className="flex items-baseline gap-3 px-5 py-2.5">
                  <span className="w-24 shrink-0 text-[12px] tabular-nums text-ink-faint">
                    {session.scheduledDate}
                  </span>
                  <span className="min-w-0 flex-1 text-[13.5px] text-ink">{session.title}</span>
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
                    className="shrink-0 text-[12px] text-ink-faint hover:text-mark"
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
          <SheetHeader title={t.schedule.title} />
          <SheetBody className="p-0">
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
                        'mb-2 text-[12px] font-semibold uppercase tracking-wide',
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
                                'truncate text-[13.5px] text-ink',
                                session.status === 'done' && 'line-through decoration-correct/40',
                              )}
                            >
                              {session.title}
                            </p>
                            {session.chapterName && (
                              <p className="truncate text-[11.5px] text-ink-faint">{session.chapterName}</p>
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
                                className="rounded px-2 py-1 text-[12px] font-medium text-correct hover:bg-correct-soft"
                              >
                                {t.schedule.markDone}
                              </button>
                              <button
                                type="button"
                                onClick={() => setStatus(session.id, 'skipped')}
                                className="rounded px-2 py-1 text-[12px] text-ink-faint hover:bg-paper-sunken"
                              >
                                {t.schedule.markSkipped}
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => remove(session.id)}
                              className="shrink-0 rounded px-2 py-1 text-[12px] text-ink-faint hover:text-mark"
                            >
                              {t.common.delete}
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </SheetBody>
        </Sheet>

        <div className="space-y-5">
          {/* --- Add a session --- */}
          <Sheet>
            <SheetHeader title={t.schedule.addSession} />
            <SheetBody className="space-y-3">
              <Field label={t.schedule.sessionTitle}>
                {({ id }) => (
                  <Input id={id} value={title} onChange={(event) => setTitle(event.target.value)} />
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
                  <li key={exam.id} className="flex items-baseline justify-between gap-2 text-[13px]">
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
