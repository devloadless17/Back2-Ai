'use client';

import { useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n/client';

/**
 * Mastery bars.
 *
 * The one piece of motion this design keeps: a bar fills to its value rather
 * than appearing at it, so a student watches the number they just moved. A bar
 * that silently renders at a new value on the next page load teaches them that
 * nothing they did registered.
 *
 * Reduced-motion users get the final value immediately; the global
 * prefers-reduced-motion rule in globals.css collapses the transition.
 */

export type MeterProps = {
  /** 0..1 */
  value: number;
  label?: string;
  /** Shown at the end of the row — usually a percentage or "n attempts". */
  caption?: string;
  size?: 'sm' | 'md';
  tone?: 'auto' | 'primary';
  className?: string;
};

/** Below 0.4 needs work, below 0.7 is developing, above is solid. */
function toneFor(value: number): string {
  if (value < 0.4) return 'bg-mark';
  if (value < 0.7) return 'bg-partial';
  return 'bg-correct';
}

export function Meter({ value, label, caption, size = 'md', tone = 'auto', className }: MeterProps) {
  const target = clamp01(value);
  const [rendered, setRendered] = useState(0);
  const hasAnimated = useRef(false);

  useEffect(() => {
    // First paint starts from zero so the bar fills in; later changes animate
    // from wherever the bar currently is.
    if (!hasAnimated.current) {
      hasAnimated.current = true;
      const frame = requestAnimationFrame(() => setRendered(target));
      return () => cancelAnimationFrame(frame);
    }
    setRendered(target);
    return undefined;
  }, [target]);

  const { formatPercent } = useI18n();

  return (
    <div className={cn('space-y-1', className)}>
      {(label || caption) && (
        <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
          {label && <span className="min-w-0 truncate font-medium text-ink">{label}</span>}
          {caption && <span className="shrink-0 tabular-nums text-ink-muted">{caption}</span>}
        </div>
      )}

      <div
        role="meter"
        aria-valuenow={Math.round(target * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
        aria-valuetext={formatPercent(target)}
        className={cn(
          'w-full overflow-hidden rounded-sm bg-paper-sunken',
          size === 'sm' ? 'h-1.5' : 'h-2',
        )}
      >
        <div
          className={cn(
            'h-full transition-[width] duration-500 ease-soft',
            tone === 'primary' ? 'bg-primary' : toneFor(target),
          )}
          style={{ width: `${rendered * 100}%` }}
        />
      </div>
    </div>
  );
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
