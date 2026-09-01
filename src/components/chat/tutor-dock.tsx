'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { useTutorSession } from '@/components/chat/use-tutor-session';
import { IconChat, IconClose } from '@/components/shell/icons';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/cn';

/**
 * The tutor, docked.
 *
 * The same conversation the `TutorButton` opens, reachable from wherever the
 * student already is instead of only from beside a marked question. It carries
 * the anchor the page can give it — a question, or the student's own attempt of
 * one — so "Explain this" on the results screen still means *this* answer of
 * *mine*, not a generic walkthrough.
 *
 * It is mounted per page rather than in the app layout, and that is the point:
 * `/exam-sim/[id]` is a paper under a running clock and must stay assistant-free.
 * A dock in the layout would have to know which route it was on and hide itself,
 * which is exactly the kind of rule that survives one refactor and not two. A
 * page that wants the tutor asks for it; the exam does not ask.
 *
 * The chips are entries, not a second navigation. Each one is a thing the
 * student was already going to do next, one tap closer.
 */

export type TutorDockContext = {
  /** What the tutor is looking at, in the student's words. */
  label: string;
  questionId?: string;
  attemptId?: string;
};

export function TutorDock({ context }: { context?: TutorDockContext }) {
  const { t, format } = useI18n();
  const { open: openSession, opening, failed } = useTutorSession();

  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  // Escape closes and returns the focus to the control that opened it. A panel
  // that traps a keyboard user in the corner of every screen in the product
  // would be worse than no panel.
  useEffect(() => {
    if (!open) return undefined;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
        toggleRef.current?.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const anchor = context?.questionId || context?.attemptId ? context : undefined;

  return (
    <>
      {open && (
        <div
          ref={panelRef}
          id="tutor-dock-panel"
          role="dialog"
          aria-label={t.chat.dockTitle}
          className="sheet fixed bottom-24 end-4 z-40 flex w-[min(20rem,calc(100vw-2rem))] flex-col overflow-hidden shadow-pop-lg animate-fade-up sm:end-6"
        >
          <header className="border-b border-rule px-4 py-3">
            <p className="text-meta font-semibold text-ink">{t.chat.dockTitle}</p>
            <p className="text-caption text-ink-muted">{t.chat.dockSubtitle}</p>
          </header>

          <div className="space-y-3 px-4 py-3">
            {context ? (
              <p className="rounded bg-primary-soft px-3 py-2 text-caption font-semibold text-ink">
                {format(t.chat.dockContext, { label: context.label })}
              </p>
            ) : (
              <p className="text-caption text-ink-faint">{t.chat.dockNoContext}</p>
            )}

            <p className="text-meta leading-snug text-ink-muted">{t.chat.dockIntro}</p>

            {failed && <p className="text-caption text-mark">{t.common.unknownError}</p>}
          </div>

          <div className="flex flex-wrap gap-1.5 border-t border-rule px-4 py-3">
            <Chip
              onClick={() => void openSession(anchor ?? {})}
              disabled={opening}
              busy={opening}
              label={t.chat.dockChipExplain}
            />
            <ChipLink href="/practice" label={t.chat.dockChipQuiz} />
            <ChipLink href="/flashcards/review" label={t.chat.dockChipFlashcards} />
            <ChipLink href="/schedule" label={t.chat.dockChipPlan} />
          </div>
        </div>
      )}

      <button
        ref={toggleRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-controls="tutor-dock-panel"
        aria-label={open ? t.chat.dockClose : t.chat.dockOpen}
        className={cn(
          'fixed bottom-5 end-4 z-40 flex h-14 w-14 items-center justify-center rounded-full',
          'bg-primary text-on-primary shadow-pop-lg',
          'transition-transform duration-150 active:scale-[0.94] active:duration-[120ms]',
          'motion-reduce:active:scale-100 sm:end-6',
        )}
      >
        {open ? <IconClose width={22} height={22} /> : <IconChat width={22} height={22} />}
      </button>
    </>
  );
}

const CHIP =
  'rounded-full border border-rule-strong bg-paper-raised px-3 py-1.5 text-caption font-semibold ' +
  'text-ink transition-colors duration-150 hover:bg-paper-sunken ' +
  'disabled:pointer-events-none disabled:opacity-50';

function Chip({
  onClick,
  label,
  disabled,
  busy,
}: {
  onClick: () => void;
  label: string;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-busy={busy || undefined}
      className={CHIP}
    >
      {label}
    </button>
  );
}

function ChipLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className={CHIP}>
      {label}
    </Link>
  );
}
