'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { WorkingArea } from '@/components/ui/field';
import { Alert, Badge } from '@/components/ui/feedback';
import { QuestionBody } from '@/components/ui/math';
import { Sheet, SheetBody, SheetFooter, SheetHeader } from '@/components/ui/sheet';
import { cn } from '@/lib/cn';
import { sendForm, sendJson } from '@/lib/client/request';
import { useI18n } from '@/lib/i18n/client';
// Duration is locale-independent (mm:ss / h:mm:ss), so it comes straight from
// the formatter rather than through the i18n context.
import { formatDuration } from '@/lib/i18n/format';

/**
 * The sitting.
 *
 * Design decisions that come from this being an exam and not a quiz:
 *
 *   * The countdown is display only. It is seeded from the server's remaining
 *     seconds and, when it reaches zero, it *asks the server* to submit rather
 *     than deciding anything itself. A student with a slow clock is not given
 *     extra time and one with a fast clock does not lose any.
 *   * Answers autosave on a debounce and on question change. A paper lost to a
 *     dropped connection is not an acceptable outcome for two hours of work.
 *   * Submit takes a confirmation step that names how many questions are still
 *     unanswered. This is irreversible and should feel like it.
 *   * No solutions, no marks, no feedback until the paper is submitted.
 */

export type ExamSlot = {
  id: string;
  orderIndex: number;
  contentText: string;
  contentLatex: string | null;
  contentImages: string[];
  chapterName: string | null;
  maxScore: number | null;
  savedAnswer: string | null;
  savedPhotoKey: string | null;
  photoRejected: boolean;
};

const AUTOSAVE_DELAY_MS = 1500;

/** Widening backoff. A fixed interval from every client keeps a sick server sick. */
const RETRY_DELAYS_MS = [2_000, 5_000, 15_000];

export function ExamRunner({
  simulationId,
  subjectName,
  paperDir,
  durationIsOfficial,
  title,
  slots,
  initialRemainingSeconds,
}: {
  simulationId: string;
  subjectName: string;
  /**
   * The direction the PAPER reads in, which is not the interface's.
   *
   * A candidate sits Arabic history through a French interface. Reading an
   * Arabic question laid out left-to-right, against a clock, is the worst
   * place in the product to make somebody work out where a line starts.
   */
  paperDir: 'ltr' | 'rtl';
  /** Whether the countdown is the paper's own limit or our fallback. */
  durationIsOfficial: boolean;
  title: string;
  slots: ExamSlot[];
  initialRemainingSeconds: number;
}) {
  const { t, format } = useI18n();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>(() =>
    Object.fromEntries(slots.map((slot) => [slot.id, slot.savedAnswer ?? ''])),
  );
  const [photoState, setPhotoState] = useState<Record<string, 'none' | 'ok' | 'rejected'>>(() =>
    Object.fromEntries(
      slots.map((slot) => [
        slot.id,
        slot.savedPhotoKey ? (slot.photoRejected ? 'rejected' : 'ok') : 'none',
      ]),
    ),
  );

  const [remaining, setRemaining] = useState(initialRemainingSeconds);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  /** Slots whose latest text the server has not confirmed. */
  const [unsaved, setUnsaved] = useState<Set<string>>(() => new Set());
  const [notice, setNotice] = useState<string | null>(null);

  const slot = slots[index];
  const submittedRef = useRef(false);

  const submit = useCallback(
    async (auto: boolean) => {
      if (submittedRef.current) return;
      submittedRef.current = true;
      setSubmitting(true);

      try {
        await sendJson(`/api/exam-sim/${simulationId}/submit`, 'POST');
      } catch {
        // Even a failed submit call must land the student somewhere real; the
        // server-side sweep will mark an expired paper regardless.
      } finally {
        router.replace(`/exam-sim/${simulationId}/results${auto ? '?expired=1' : ''}`);
      }
    },
    [router, simulationId],
  );

  // --- Countdown ----------------------------------------------------------
  useEffect(() => {
    if (remaining <= 0) {
      void submit(true);
      return undefined;
    }

    const timer = window.setInterval(() => {
      setRemaining((current) => {
        if (current <= 1) {
          window.clearInterval(timer);
          void submit(true);
          return 0;
        }
        return current - 1;
      });
    }, 1000);

    return () => window.clearInterval(timer);
    // `remaining` is intentionally not a dependency: the interval owns it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submit]);

  // --- Autosave -----------------------------------------------------------
  /*
   * Autosave, with retries.
   *
   * A failed save used to be dropped: the notice appeared and the write was
   * gone, and because the debounce only re-fires when the text changes, a
   * student who typed a paragraph, hit a failure and then stopped to think had
   * that paragraph in memory only. Under load — which is exactly when saves
   * fail — that is a lost answer in a timed paper.
   *
   * So a failure is queued and retried on a widening delay. The backoff matters
   * as much as the retry: hundreds of clients hammering a struggling server at a
   * fixed interval is the thing that keeps it struggling.
   */
  const save = useCallback(
    async (slotId: string, value: string, attempt = 0) => {
      setSaving(true);
      try {
        await sendJson(`/api/exam-sim/${simulationId}/answers`, 'POST', {
          slotId,
          answer: value,
        });
        setUnsaved((current) => {
          if (!current.has(slotId)) return current;
          const next = new Set(current);
          next.delete(slotId);
          return next;
        });
        setNotice(null);
      } catch {
        setUnsaved((current) => new Set(current).add(slotId));

        if (attempt < RETRY_DELAYS_MS.length) {
          // Tell them it is still trying. "Something went wrong" invites a
          // student to do something about it, and there is nothing to do.
          setNotice(t.examSim.saveRetrying);
          const delay = RETRY_DELAYS_MS[attempt] as number;
          window.setTimeout(() => void save(slotId, value, attempt + 1), delay);
        } else {
          // Out of retries. Say so plainly — at this point the honest advice is
          // to keep the tab open, because the flush on hide is the last chance.
          setNotice(t.examSim.saveFailed);
        }
      } finally {
        setSaving(false);
      }
    },
    [simulationId, t.examSim.saveRetrying, t.examSim.saveFailed],
  );

  useEffect(() => {
    if (!slot) return undefined;
    const value = answers[slot.id] ?? '';
    if (value === (slot.savedAnswer ?? '')) return undefined;

    const timer = window.setTimeout(() => void save(slot.id, value), AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [answers, slot, save]);

  /*
   * Flush on the way out.
   *
   * The debounce means up to AUTOSAVE_DELAY_MS of typing is only in memory. A
   * closed tab, a locked phone or a crashed browser in that window silently
   * loses the last sentence a student wrote under exam conditions — the one
   * failure mode this product cannot shrug off.
   *
   * `visibilitychange` rather than `beforeunload`: mobile browsers frequently
   * never fire the latter. `sendBeacon` because a normal fetch is cancelled
   * when the page goes away, and it is fire-and-forget by design.
   */
  useEffect(() => {
    function flush() {
      if (document.visibilityState !== 'hidden') return;

      for (const s of slots) {
        const value = answers[s.id] ?? '';
        // Anything the server has not confirmed, plus anything typed since the
        // page loaded. `unsaved` is the one that catches a retry still in
        // flight when the tab goes away.
        const dirty = unsaved.has(s.id) || value !== (s.savedAnswer ?? '');
        if (!dirty || value.trim().length === 0) continue;

        const payload = new Blob([JSON.stringify({ slotId: s.id, answer: value })], {
          type: 'application/json',
        });
        navigator.sendBeacon?.(`/api/exam-sim/${simulationId}/answers`, payload);
      }
    }

    document.addEventListener('visibilitychange', flush);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', flush);
      window.removeEventListener('pagehide', flush);
    };
  }, [answers, slots, simulationId, unsaved]);

  async function uploadPhoto(file: File) {
    if (!slot) return;
    setUploading(true);
    setNotice(null);

    const form = new FormData();
    form.append('file', file);
    form.append('slotId', slot.id);

    try {
      const response = await sendForm<{ status: string; notes: string | null }>(
        `/api/exam-sim/${simulationId}/answers`,
        form,
      );

      if (response.status === 'photo_rejected') {
        setPhotoState((current) => ({ ...current, [slot.id]: 'rejected' }));
        setNotice(response.notes ?? t.examSim.photoUnreadable);
      } else {
        setPhotoState((current) => ({ ...current, [slot.id]: 'ok' }));
        setNotice(null);
      }
    } catch {
      setNotice(t.common.unknownError);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const unanswered = slots.filter(
    (s) => (answers[s.id] ?? '').trim().length === 0 && photoState[s.id] !== 'ok',
  ).length;

  /*
   * Changing question moves focus to the new question's heading.
   *
   * It did not move at all: Next left focus on the button, so a screen-reader
   * user heard nothing change, and a student scrolled halfway down a long
   * answer stayed there while the question above them was replaced.
   *
   * The heading, deliberately, and not the textarea — focusing the answer
   * field would raise the mobile keyboard on every single transition and bury
   * the question the student is trying to read. `skipFirstFocus` keeps it from
   * stealing focus on the initial render, where nothing has changed yet.
   */
  const headingRef = useRef<HTMLDivElement | null>(null);
  const skipFirstFocus = useRef(true);

  useEffect(() => {
    if (skipFirstFocus.current) {
      skipFirstFocus.current = false;
      return;
    }
    headingRef.current?.focus();
    headingRef.current?.scrollIntoView({ block: 'start', behavior: 'auto' });
  }, [index]);

  const urgent = remaining <= 300;

  if (!slot) return null;

  return (
    <div className="space-y-4">
      {/* --- Invigilator's header --- */}
      <header className="sticky top-0 z-20 -mx-4 border-b border-rule bg-paper-raised/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-body font-semibold text-ink">{title}</p>
            <p className="text-caption text-ink-faint">
              {subjectName}
              {/* Where the clock came from. Said once, quietly, because the
                  setup screen has already said it in full — but a student
                  sitting a paper is entitled to know whether the time limit
                  is the examiner's or ours. */}
              {!durationIsOfficial && (
                <>
                  {' · '}
                  {t.examSim.durationStandardShort}
                </>
              )}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-end">
              <p className="text-micro uppercase tracking-wide text-ink-faint">
                {t.examSim.timeRemaining}
              </p>
              <p
                className={cn(
                  'font-mono text-xl font-semibold tabular-nums leading-none',
                  urgent ? 'text-mark' : 'text-ink',
                )}
                role="timer"
                aria-live={urgent ? 'polite' : 'off'}
              >
                {formatDuration(remaining)}
              </p>
            </div>

            <Button variant="mark" size="sm" onClick={() => setConfirming(true)}>
              {t.examSim.submitPaper}
            </Button>
          </div>
        </div>

        {urgent && <p className="mt-2 text-meta font-medium text-mark">{t.examSim.timeAlmostUp}</p>}
      </header>

      {/*
        Question navigator.

        Each chip carries its barème — what the question is worth is the thing a
        candidate is triaging on with twenty minutes left, and it was previously
        only visible once you opened the question.

        Deliberately no status colour. The earlier version painted answered
        chips in `correct`, which is the marking green: on the results page that
        colour means "you got the marks", and here it would mean "you typed
        something". Reusing it teaches a student that green means two different
        things on two screens, and the one that matters is the marking one. So
        answered is carried by fill and ink weight, current by a heavier border
        — no hue, nothing to unlearn.
      */}
      <nav className="scroll-x flex gap-1.5 pb-1" aria-label={t.examSim.title}>
        {slots.map((s, i) => {
          const answered = (answers[s.id] ?? '').trim().length > 0 || photoState[s.id] === 'ok';
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setIndex(i)}
              aria-current={i === index ? 'step' : undefined}
              /*
               * Answered is carried visually by fill and ink weight, which a
               * screen reader cannot see — the chip announced "3 8pt" and
               * nothing about whether it had been done. The state that matters
               * most when triaging a paper was the one state not available to
               * anyone not looking at it.
               */
              aria-label={format(
                s.maxScore !== null ? t.examSim.navChipMarks : t.examSim.navChip,
                {
                  number: i + 1,
                  marks: s.maxScore ?? 0,
                  state: answered ? t.examSim.navAnswered : t.examSim.navUnanswered,
                },
              )}
              className={cn(
                'flex h-11 w-10 shrink-0 flex-col items-center justify-center gap-0 rounded leading-none transition-colors duration-150',
                i === index
                  ? 'border-2 border-ink bg-paper-raised text-ink'
                  : answered
                    ? 'border border-rule-strong bg-paper-sunken text-ink'
                    : 'border border-rule bg-paper-raised text-ink-muted hover:bg-paper-sunken',
              )}
            >
              <span className="numeric text-meta font-semibold">{i + 1}</span>
              {s.maxScore !== null ? (
                <span className="numeric text-micro opacity-70">{s.maxScore}pt</span>
              ) : null}
            </button>
          );
        })}
      </nav>

      {/* --- The question --- */}
      <Sheet>
        <div ref={headingRef} tabIndex={-1} className="outline-none">
        <SheetHeader
          title={format(t.examSim.questionOf, { current: index + 1, total: slots.length })}
          description={slot.chapterName ?? undefined}
          actions={
            slot.maxScore !== null ? (
              <Badge tone="neutral">
                {slot.maxScore} {t.common.points}
              </Badge>
            ) : null
          }
        />

        <SheetBody>
          <QuestionBody
            contentText={slot.contentText}
            contentLatex={slot.contentLatex}
            images={slot.contentImages}
            dir={paperDir}
          />
        </SheetBody>

        <SheetBody className="space-y-3 border-t border-rule">
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="answer" className="text-meta font-medium text-ink">
              {t.examSim.answerTyped}
            </label>
            <span className="text-caption text-ink-faint">
              {saving ? t.common.saving : ''}
            </span>
          </div>

          <WorkingArea
            id="answer"
            value={answers[slot.id] ?? ''}
            onChange={(event) =>
              setAnswers((current) => ({ ...current, [slot.id]: event.target.value }))
            }
            onBlur={() => void save(slot.id, answers[slot.id] ?? '')}
            placeholder={t.practice.yourAnswerPlaceholder}
          />

          <div className="flex flex-wrap items-center gap-3 border-t border-rule pt-3">
            <div className="min-w-0 flex-1">
              <p className="text-meta font-medium text-ink">{t.examSim.answerPhoto}</p>
              <p className="text-caption text-ink-muted">{t.examSim.photoHint}</p>
            </div>

            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              capture="environment"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void uploadPhoto(file);
              }}
            />

            <Button size="sm" onClick={() => fileRef.current?.click()} loading={uploading}>
              {photoState[slot.id] === 'none' ? t.examSim.answerPhoto : t.examSim.photoRetake}
            </Button>

            {photoState[slot.id] === 'ok' && <Badge tone="correct">{t.settings.referenceReady}</Badge>}
            {photoState[slot.id] === 'rejected' && <Badge tone="mark">{t.upload.readFailed}</Badge>}
          </div>

          {notice && <Alert tone="error">{notice}</Alert>}
        </SheetBody>

        </div>

        <SheetFooter className="justify-between">
          <Button
            variant="quiet"
            onClick={() => setIndex((current) => Math.max(0, current - 1))}
            disabled={index === 0}
          >
            {t.common.previous}
          </Button>
          <Button
            onClick={() => setIndex((current) => Math.min(slots.length - 1, current + 1))}
            disabled={index === slots.length - 1}
          >
            {t.common.next}
          </Button>
        </SheetFooter>
      </Sheet>

      {/* --- Submit confirmation --- */}
      {confirming && (
        <ConfirmSubmitDialog
          unanswered={unanswered}
          submitting={submitting}
          onCancel={() => setConfirming(false)}
          onConfirm={() => void submit(false)}
        />
      )}

      {submitting && !confirming && (
        <Alert tone="info" title={t.examSim.grading}>
          {t.examSim.gradingHint}
        </Alert>
      )}
    </div>
  );
}

/**
 * Submit confirmation.
 *
 * A real modal, not a styled div: focus moves into it on open, Escape closes
 * it, and Tab cycles inside it rather than wandering into the paper underneath.
 * Without the trap, a keyboard user tabbing past "Confirm" lands silently in
 * the answer textarea behind an overlay they cannot see past — which, on the
 * one irreversible action in the product, is not a minor accessibility nit.
 *
 * Focus returns to whatever opened the dialog when it closes.
 */
function ConfirmSubmitDialog({
  unanswered,
  submitting,
  onCancel,
  onConfirm,
}: {
  unanswered: number;
  submitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t, format } = useI18n();
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    confirmRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !submitting) {
        event.preventDefault();
        onCancel();
        return;
      }

      if (event.key !== 'Tab') return;

      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) return;

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [onCancel, submitting]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="submit-title"
      aria-describedby="submit-body"
    >
      <div ref={dialogRef} className="w-full max-w-md">
        <Sheet>
          <SheetHeader title={<span id="submit-title">{t.examSim.submitConfirmTitle}</span>} />
          <SheetBody>
            <p id="submit-body" className="text-sm leading-relaxed text-ink-muted">
              {unanswered > 0
                ? format(t.examSim.submitConfirmBody, { unanswered })
                : t.examSim.submitConfirmBodyAllAnswered}
            </p>
          </SheetBody>
          <SheetFooter className="justify-end">
            <Button variant="quiet" onClick={onCancel} disabled={submitting}>
              {t.common.cancel}
            </Button>
            <Button ref={confirmRef} variant="mark" onClick={onConfirm} loading={submitting}>
              {t.examSim.submitConfirmAction}
            </Button>
          </SheetFooter>
        </Sheet>
      </div>
    </div>
  );
}
