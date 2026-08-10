'use client';

import { useState } from 'react';

import { MathText } from '@/components/ui/math';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n/client';

/**
 * Hover-to-reveal solution, for past-paper mode.
 *
 * Hover alone is not enough — it does not exist on a phone, and it is not
 * reachable from a keyboard — so the blur lifts on hover, on focus, and on
 * click, and the click state latches so the solution stays open while it is
 * being read. The blurred state is still real text underneath, which is why the
 * container is marked `aria-hidden` until revealed: a screen reader announcing
 * the answer to a "hidden" solution would defeat the whole interaction.
 */
export function RevealableSolution({ solution }: { solution: string | null }) {
  const { t } = useI18n();
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);

  if (!solution) return null;

  const revealed = pinned || hovered;

  return (
    <div className="border-t border-rule">
      <div className="flex items-center justify-between gap-3 px-5 py-2.5">
        <p className="text-[12.5px] font-medium uppercase tracking-wide text-ink-faint">
          {t.practice.solution}
        </p>
        <button
          type="button"
          onClick={() => setPinned((current) => !current)}
          aria-expanded={revealed}
          className="text-[12.5px] font-medium text-primary underline-offset-2 hover:underline"
        >
          {pinned ? t.oldCycles.hideSolution : t.oldCycles.revealSolution}
        </button>
      </div>

      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        className="relative px-5 pb-5"
      >
        <div
          className={cn(
            'transition-[filter,opacity] duration-300 ease-sheet',
            revealed ? 'blur-0 opacity-100' : 'select-none blur-[6px] opacity-60',
          )}
          aria-hidden={!revealed}
        >
          <MathText>{solution}</MathText>
        </div>

        {!revealed && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="rounded-sm border border-rule-strong bg-paper-raised px-2.5 py-1 text-[12px] font-medium text-ink-muted shadow-sheet">
              {t.oldCycles.hoverToReveal}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
