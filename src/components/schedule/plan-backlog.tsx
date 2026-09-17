'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Sheet, SheetBody, SheetHeader } from '@/components/ui/sheet';
import { useI18n } from '@/lib/i18n/client';
import { sendJson } from '@/lib/client/request';
import type { PlanTodo } from '@/lib/queries/plan';

/**
 * Things noted but not committed to.
 *
 * A todo has no date field — that is the whole difference between it and a
 * session, and it is why both still exist. This is the backlog: captured
 * intentions sitting beside the week they might eventually join.
 *
 * Giving one a date turns it into a session, through a single endpoint that
 * does both halves in a transaction. The todo is removed rather than marked
 * done: `isDone` means the student finished the work, and this work has not
 * been finished, it has been scheduled. Ticking it would put a mark against
 * something nobody did.
 *
 * The launch action is only rendered where the todo actually has one. A todo
 * is free text and most carry nothing to open.
 */
export function PlanBacklog({ items, todayKey }: { items: PlanTodo[]; todayKey: string }) {
  const { t } = useI18n();
  const router = useRouter();

  const [openFor, setOpenFor] = useState<string | null>(null);
  const [date, setDate] = useState(todayKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (items.length === 0) return null;

  const schedule = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      await sendJson(`/api/todos/${id}/schedule`, 'POST', { scheduledDate: date });
      setOpenFor(null);
      router.refresh();
    } catch {
      setError(t.schedule.planError);
    } finally {
      setBusy(false);
    }
  };

  const actionHref = (item: PlanTodo): string | null => {
    if (item.linkedAction === 'flashcards') return '/flashcards/review';
    if (item.linkedAction === 'exam_sim') return '/exam-sim';
    if (item.subjectId && item.chapterId) return `/practice/${item.subjectId}/${item.chapterId}`;
    return null;
  };

  return (
    <Sheet>
      <SheetHeader title={t.schedule.backlog} description={t.schedule.backlogNote} />
      <SheetBody className="p-0">
        <ul className="ruled">
          {items.map((item) => {
            const href = actionHref(item);
            return (
              <li key={item.id} className="px-5 py-3.5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-medium text-ink">{item.content}</p>
                    {item.chapterName && (
                      <p className="text-caption text-ink-faint">{item.chapterName}</p>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-3">
                    {href && (
                      <a
                        href={href}
                        className="text-meta font-medium text-primary underline-offset-2 hover:underline"
                      >
                        {t.schedule.start}
                      </a>
                    )}
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setOpenFor(openFor === item.id ? null : item.id);
                        setError(null);
                      }}
                      aria-expanded={openFor === item.id}
                    >
                      {t.schedule.giveDate}
                    </Button>
                  </div>
                </div>

                {openFor === item.id && (
                  <div className="mt-3 flex flex-wrap items-end gap-3">
                    <label className="text-meta text-ink-muted">
                      <span className="mb-1 block">{t.schedule.date}</span>
                      <input
                        type="date"
                        value={date}
                        min={todayKey}
                        onChange={(e) => setDate(e.target.value)}
                        className="rounded-sm border border-rule bg-paper px-2 py-1.5 text-sm text-ink"
                      />
                    </label>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => schedule(item.id)}
                      disabled={busy}
                    >
                      {busy ? t.common.saving : t.schedule.addToPlan}
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {error && (
          <p role="alert" className="border-t border-rule px-5 py-3 text-meta text-mark">
            {error}
          </p>
        )}
      </SheetBody>
    </Sheet>
  );
}
