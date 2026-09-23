'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { useTutorSession } from '@/components/chat/use-tutor-session';
import { TutorAvatar } from '@/components/chat/tutor-avatar';
import { useTutorContext } from '@/components/chat/tutor-context';
import { IconClose } from '@/components/shell/icons';
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
 * It is mounted once in the `(app)` layout. The paper under a running clock is
 * excluded structurally rather than by a rule someone has to remember: the exam
 * runner lives in the `(exam)` group with its own layout and never renders this
 * one, so no future addition here can hand a student an assistant mid-exam.
 *
 * The chips are entries, not a second navigation. Each one is a thing the
 * student was already going to do next, one tap closer.
 *
 * The tutor has a face and a name the student chooses. Both are the same idea:
 * a bubble labelled "Chat" is a feature you are offered, and somebody called
 * Nour who greets you by name is a person you have. The name is stored on the
 * account, not in the browser, because one that vanished on the school computer
 * would undercut the only thing naming it was for.
 */

export type TutorDockContext = {
  /** What the tutor is looking at, in the student's words. */
  label: string;
  questionId?: string;
  attemptId?: string;
  /** See `TutorPageContext` in `tutor-context.tsx` — same field, same reason. */
  subjectId?: string;
};

export function TutorDock({
  context: override,
  tutorName,
  firstName,
}: {
  /** Overrides the page's published anchor. Rarely needed; the dock subscribes. */
  context?: TutorDockContext;
  /** What this student calls their tutor. Null until they have named it. */
  tutorName?: string | null;
  /** Used to greet them. Absent is fine — the greeting drops the name. */
  firstName?: string | null;
}) {
  const { t, format } = useI18n();
  /*
   * NOT ON THE CHAT PAGE. That page IS the tutor.
   *
   * The dock renders from the app layout, so it was appearing on top of the
   * conversation it is a shortcut to — a floating button labelled "Tutor" over
   * the tutor, offering "Explain this" on a screen with nothing on it to
   * explain. It is `fixed bottom-24 end-4`, so on a page whose content fills
   * the viewport the open panel sat squarely over the subject picker and hid
   * three of the subjects a student was being asked to choose between.
   *
   * Checked here rather than in the layout because the layout is a server
   * component and this already runs on the client.
   */
  const pathname = usePathname();
  const { open: openSession, opening, failed } = useTutorSession();

  /*
   * The page says what it is showing; this reads it. Mounted in the layout, the
   * dock cannot see the route below it, so without this it could only ever
   * offer a fresh conversation — a tutor beside you that cannot tell what you
   * are looking at is a chat button in a different corner.
   */
  const published = useTutorContext();
  const context = override ?? published ?? undefined;

  const [open, setOpen] = useState(false);

  /*
   * The name is held here as well as on the account so a rename lands the
   * instant it is typed. Waiting for a round trip to redraw the header would
   * make the one personal thing in the product feel like the slowest.
   */
  const [name, setName] = useState(tutorName ?? '');
  const [renaming, setRenaming] = useState(false);

  // If the account's name changes elsewhere — another tab, another device —
  // the server value wins over whatever this dock last showed.
  useEffect(() => setName(tutorName ?? ''), [tutorName]);

  const shown = name.trim() || t.chat.tutorDefaultName;

  async function saveName(next: string) {
    const cleaned = next.replace(/\s+/g, ' ').trim().slice(0, 24);
    setName(cleaned);
    setRenaming(false);
    try {
      await fetch('/api/settings/tutor', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: cleaned }),
      });
    } catch {
      // The name still stands for this visit. A failed rename is not worth an
      // error banner over the one thing here that is purely the student's.
    }
  }

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

  // After every hook, never before one — an early return above them changes the
  // hook order between renders and React throws.
  if (pathname?.startsWith('/chat')) return null;

  const anchor =
    context?.questionId || context?.attemptId || context?.subjectId ? context : undefined;

  /*
   * Three states, each of them a fact rather than a flourish: a request is in
   * flight, or the page has handed the tutor something to look at, or neither.
   * Nothing here animates on a timer — see `tutor-avatar.tsx`.
   */
  const mood = opening ? 'thinking' : anchor ? 'attentive' : 'idle';

  return (
    <>
      {open && (
        <div
          ref={panelRef}
          id="tutor-dock-panel"
          role="dialog"
          aria-label={t.chat.dockTitle}
          className="sheet fixed bottom-[9.5rem] end-4 z-40 flex w-[min(20rem,calc(100vw-2rem))] flex-col overflow-hidden shadow-pop-lg animate-fade-up sm:end-6 lg:bottom-24"
        >
          <header className="flex items-center gap-3 border-b border-rule px-4 py-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-soft text-primary">
              <TutorAvatar mood={mood} ink="paper" size={26} />
            </span>

            <div className="min-w-0 flex-1">
              {renaming ? (
                <NameField
                  initial={name}
                  label={t.chat.dockRenameLabel}
                  hint={t.chat.dockRenameHint}
                  save={t.common.save}
                  cancel={t.common.cancel}
                  onSave={(value) => void saveName(value)}
                  onCancel={() => setRenaming(false)}
                />
              ) : (
                <>
                  {/* The name is the button. A pencil beside a heading is a
                      control you have to notice; a name you can press is one
                      you find by trying to press it. */}
                  <button
                    type="button"
                    onClick={() => setRenaming(true)}
                    title={t.chat.dockRenameLabel}
                    className="-mx-1 block max-w-full truncate rounded px-1 text-start text-meta font-semibold text-ink transition-colors hover:bg-paper-sunken"
                  >
                    {shown}
                  </button>
                  <p className="truncate text-caption text-ink-muted">
                    {firstName
                      ? format(t.chat.dockGreeting, { name: firstName })
                      : t.chat.dockGreetingAnon}
                  </p>
                </>
              )}
            </div>
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

      {/*
        WHAT IT IS LOOKING AT, ON THE CLOSED BUTTON.
        The dock has always known — `TutorAnchor` publishes it and the panel
        prints "Looking at: …" — but only once opened, which is the one moment
        the student no longer needs telling. Closed, it was an anonymous circle
        on every screen, so nothing ever suggested it had anything to say about
        THIS chapter.

        Shown only when there is an anchor and the dock is shut, and only on a
        screen wide enough that a chapter title is not competing with the page
        for room. It is presentational: the button beside it is the control, and
        a second clickable thing saying the same would be one more tab stop for
        no gain.
      */}
      {!open && context && (
        <span
          aria-hidden
          className={cn(
            'fixed bottom-20 end-20 z-40 hidden max-w-[14rem] items-center rounded-full sm:end-24 lg:bottom-5',
            'border border-rule bg-paper-raised px-3 py-1.5 shadow-pop',
            'text-caption text-ink-muted animate-fade-up md:flex',
          )}
        >
          <span className="truncate">{format(t.chat.dockContext, { label: context.label })}</span>
        </span>
      )}

      <button
        ref={toggleRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-controls="tutor-dock-panel"
        /*
         * The anchor goes in the ACCESSIBLE NAME, not only in the chip beside
         * it. The chip is hidden from assistive technology and from narrow
         * screens, so without this a screen-reader user gets "Ask the tutor"
         * with none of the context a sighted user can see.
         */
        aria-label={
          open
            ? t.chat.dockClose
            : context
              ? format(t.chat.dockContext, { label: context.label })
              : t.chat.dockOpen
        }
        className={cn(
          // Cleared above the phone's bottom navigation, and back down on lg where
          // that bar is hidden. `bottom-5` alone put the button on top of the
          // Progress tab.
          'fixed bottom-20 end-4 z-40 flex h-14 w-14 items-center justify-center rounded-full lg:bottom-5',
          'bg-primary text-on-primary shadow-pop-lg',
          'transition-transform duration-150 active:scale-[0.94] active:duration-[120ms]',
          'motion-reduce:active:scale-100 sm:end-6',
        )}
      >
        {open ? <IconClose width={22} height={22} /> : <TutorAvatar mood={mood} size={30} />}
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

/**
 * Renaming, in place.
 *
 * Its own component so the draft lives and dies with the field. Held in the
 * dock, a half-typed name would survive closing the panel and reappear later as
 * a change the student thought they had abandoned.
 *
 * Enter saves and Escape cancels, because this is a one-line field inside a
 * panel that already closes on Escape — the field takes the key first, so the
 * first press abandons the rename and only the second closes the tutor.
 */
function NameField({
  initial,
  label,
  hint,
  save,
  cancel,
  onSave,
  onCancel,
}: {
  initial: string;
  label: string;
  hint: string;
  save: string;
  cancel: string;
  onSave: (value: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);

  return (
    <div>
      <label className="sr-only" htmlFor="tutor-name-field">
        {label}
      </label>
      <div className="flex items-center gap-1.5">
        <input
          id="tutor-name-field"
          autoFocus
          value={draft}
          maxLength={24}
          placeholder={label}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              onSave(draft);
            }
            if (event.key === 'Escape') {
              // Stops the panel's own Escape handler closing the whole dock.
              event.stopPropagation();
              onCancel();
            }
          }}
          className="min-w-0 flex-1 rounded border border-rule-strong bg-paper px-2 py-1 text-meta font-semibold text-ink outline-none focus:border-primary"
        />
        <button
          type="button"
          onClick={() => onSave(draft)}
          className="rounded px-1.5 py-1 text-caption font-semibold text-primary hover:bg-primary-soft"
        >
          {save}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded px-1.5 py-1 text-caption text-ink-muted hover:bg-paper-sunken"
        >
          {cancel}
        </button>
      </div>
      <p className="mt-1 text-caption text-ink-faint">{hint}</p>
    </div>
  );
}

function ChipLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className={CHIP}>
      {label}
    </Link>
  );
}
