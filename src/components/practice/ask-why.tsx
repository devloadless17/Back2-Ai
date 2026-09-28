'use client';

import { useTutorSession } from '@/components/chat/use-tutor-session';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/cn';

/**
 * "Why this answer?" — the tutor, opened on one part of a past paper.
 *
 * Past-paper mode is the one place a student reads an official solution with no
 * marking of their own beside it. They see the answer, they do not see how it
 * was reached, and there is nothing on the page to ask. This is that.
 *
 * It anchors to the question, not to an attempt, because nothing here posts an
 * attempt — reading a past paper deliberately writes no mastery. So the
 * conversation opens on "explain this question and its solution" rather than on
 * "mark what I wrote", which is what the results screen does instead.
 *
 * Revealed on hover, and on keyboard focus, and always visible on a touch
 * screen: `group-hover` alone would put this behind a gesture that does not
 * exist on the phones most of these students use. The button is in the DOM and
 * reachable throughout — only its opacity moves — so nothing is hidden from a
 * screen reader or from the tab order.
 */
export function AskWhy({
  questionId,
  mode = 'why',
}: {
  questionId: string;
  /**
   * `solve` is for a part the paper has no answer for. There is nothing to
   * explain, so Zaki is asked to solve it, and the button is always shown:
   * hiding the only way forward behind a hover would leave the reader stuck.
   */
  mode?: 'why' | 'solve';
}) {
  const { t } = useI18n();
  const { open, opening, failed } = useTutorSession();
  const solve = mode === 'solve';

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={() => void open(solve ? { questionId, ask: 'solve' } : { questionId })}
        disabled={opening}
        aria-busy={opening || undefined}
        className={cn(
          'rounded-full border border-rule-strong bg-paper-raised px-3 py-1',
          'text-caption font-medium text-primary',
          'transition-opacity duration-150 hover:bg-primary-soft',
          'disabled:opacity-50',
          // Visible by default (touch), faded on pointer devices until the
          // segment is hovered or something inside it takes focus.
          !solve &&
            'opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100',
          'focus-visible:opacity-100',
        )}
      >
        {opening ? t.common.loading : solve ? t.oldCycles.solveWithZaki : t.oldCycles.askWhy}
      </button>
      {failed && <span className="text-caption text-mark">{t.common.unknownError}</span>}
    </span>
  );
}
