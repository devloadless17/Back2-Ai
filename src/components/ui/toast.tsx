'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { cn } from '@/lib/cn';
import type { ProgressEvent, RankKey } from '@/lib/gamification';
import { useI18n } from '@/lib/i18n/client';

import { celebrate } from './balloons';

/**
 * Progress toasts.
 *
 * These are the product telling a student that something they just did
 * counted. They appear after a marked attempt, a reviewed card, a submitted
 * paper — never on page load, and never for anything the student did not cause.
 *
 * Constraints that make them tolerable rather than annoying:
 *
 *   * **They never block anything.** No toast covers the primary action, none
 *     of them take focus, and every one dismisses itself.
 *   * **They queue, they do not stack up forever.** Four at once is the cap;
 *     beyond that the oldest goes, because a column of toasts taller than the
 *     screen is worse than no feedback at all.
 *   * **They are announced once, politely.** `aria-live="polite"` on the region
 *     rather than `assertive`: a student mid-question should not have their
 *     screen reader interrupted to be told they earned fifteen XP.
 *   * **They are decoration over facts.** Every number a toast shows is also on
 *     a page somewhere. Miss one and nothing is lost.
 */

export type ToastTone = 'xp' | 'level' | 'badge' | 'goal' | 'streak' | 'info';

export type Toast = {
  id: number;
  tone: ToastTone;
  title: string;
  body?: string;
  glyph: string;
};

type ToastContextValue = {
  toasts: Toast[];
  push: (toast: Omit<Toast, 'id'>) => void;
  dismiss: (id: number) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

/** How long each toast lives. Long enough to read, short enough to forget. */
const TOAST_MS = 4200;
const MAX_VISIBLE = 4;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (toast: Omit<Toast, 'id'>) => {
      const id = nextId.current;
      nextId.current += 1;

      setToasts((current) => [...current, { ...toast, id }].slice(-MAX_VISIBLE));

      timers.current.set(
        id,
        setTimeout(() => dismiss(id), TOAST_MS),
      );
    },
    [dismiss],
  );

  // Timers outlive the component if a student navigates while toasts are up.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  const value = useMemo(() => ({ toasts, push, dismiss }), [toasts, push, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used inside <ToastProvider>. Check that the app layout wraps this tree.');
  }
  return ctx;
}

const TONE_STYLES: Record<ToastTone, { wrap: string; glyph: string }> = {
  xp: { wrap: 'border-primary/30 bg-paper-raised', glyph: 'bg-primary-soft text-primary' },
  level: {
    wrap: 'border-accent/40 bg-paper-raised shadow-glow-accent',
    glyph: 'bg-gradient-to-br from-primary to-accent text-on-primary',
  },
  badge: {
    wrap: 'border-partial/40 bg-paper-raised',
    glyph: 'bg-partial-soft text-partial',
  },
  goal: { wrap: 'border-correct/40 bg-paper-raised', glyph: 'bg-correct-soft text-correct' },
  streak: { wrap: 'border-accent/40 bg-paper-raised', glyph: 'bg-accent-soft text-accent' },
  info: { wrap: 'border-rule-strong bg-paper-raised', glyph: 'bg-paper-sunken text-ink-muted' },
};

function ToastViewport({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  const { t } = useI18n();

  return (
    <div
      // Bottom on mobile so it never covers a header; bottom-end on desktop so
      // it never covers the primary action, which sits bottom-start of a sheet.
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:inset-x-auto sm:end-0 sm:items-end"
      role="status"
      aria-live="polite"
      aria-atomic="false"
    >
      {toasts.map((toast) => {
        const styles = TONE_STYLES[toast.tone];
        return (
          <button
            key={toast.id}
            type="button"
            onClick={() => onDismiss(toast.id)}
            aria-label={t.common.close}
            className={cn(
              'pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-lg border-2 px-4 py-3 text-start',
              'animate-pop-in shadow-pop-lg backdrop-blur-sm',
              'transition-transform duration-200 ease-spring hover:scale-[1.02] active:scale-95',
              'motion-reduce:transform-none motion-reduce:hover:transform-none',
              styles.wrap,
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                'flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg font-extrabold',
                styles.glyph,
              )}
            >
              {toast.glyph}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-extrabold leading-tight tracking-tight text-ink">
                {toast.title}
              </span>
              {toast.body && (
                <span className="mt-0.5 block text-[12.5px] leading-snug text-ink-muted">
                  {toast.body}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Turns the domain's progress events into toasts in the student's language.
 *
 * The translation lives here rather than in `gamification.ts` so that module
 * stays pure and testable without a dictionary.
 */
export function useProgressToasts() {
  const { push } = useToast();
  const { t, format } = useI18n();

  const rankLabel = useCallback(
    (rank: RankKey): string => {
      const labels: Record<RankKey, string> = {
        beginner: t.progress.rankBeginner,
        apprentice: t.progress.rankApprentice,
        scholar: t.progress.rankScholar,
        expert: t.progress.rankExpert,
        master: t.progress.rankMaster,
      };
      return labels[rank];
    },
    [t],
  );

  const badgeLabel = useCallback(
    (key: string): string => {
      const labels = t.progress.badgeNames as Record<string, string>;
      return labels[key] ?? key;
    },
    [t],
  );

  return useCallback(
    (events: ProgressEvent[]) => {
      for (const event of events) {
        switch (event.kind) {
          case 'xp':
            push({
              tone: 'xp',
              glyph: '+',
              title: format(t.progress.xpGained, { amount: event.amount }),
            });
            break;

          case 'level':
            // The only two events loud enough to earn balloons. Everything
            // else is a toast; if every event celebrated, none would.
            celebrate('level');
            push({
              tone: 'level',
              glyph: String(event.level),
              title: format(t.progress.levelUp, { level: event.level }),
              body: format(t.progress.levelUpBody, { rank: rankLabel(event.rank) }),
            });
            break;

          case 'badge':
            celebrate('badge');
            push({
              tone: 'badge',
              glyph: event.glyph,
              title: t.progress.badgeEarned,
              body: badgeLabel(event.badge),
            });
            break;

          case 'goal':
            push({
              tone: 'goal',
              glyph: '✓',
              title: t.progress.goalMet,
              body: format(t.progress.goalMetBody, { target: event.target }),
            });
            break;

          case 'streak':
            push({
              tone: 'streak',
              glyph: '▲',
              title: format(t.progress.streakReached, { days: event.days }),
              body: t.progress.streakBody,
            });
            break;
        }
      }
    },
    [push, format, t, rankLabel, badgeLabel],
  );
}
