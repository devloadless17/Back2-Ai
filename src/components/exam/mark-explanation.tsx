'use client';

import { useState } from 'react';

import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n/client';

/**
 * One criterion of a barème, with the examiner's reason for the mark.
 *
 * The reason opens on hover, on focus, and on tap. Hover alone would have been
 * simpler and would have been wrong: a Lebanese student is as likely to open
 * this on a phone as on a laptop, and hover does not exist there. Keyboard
 * users would lose it too.
 *
 * What is never hidden: the criterion and the marks. Those are the result, and
 * a result you have to hover to read is a result you cannot scan down a page.
 * Only the *reason* is progressive.
 *
 * The marks themselves are colour-coded, but the fraction is always printed
 * beside them — colour is never the only signal that a mark was lost.
 */
export function MarkExplanation({
  criterion,
  awarded,
  possible,
  justification,
  formatScore,
}: {
  criterion: string;
  awarded: number;
  possible: number;
  justification: string;
  /** Locale-aware number formatting, passed in because this may render inside a server tree. */
  formatScore?: (value: number) => string;
}) {
  const { t, formatScore: fallbackFormat } = useI18n();
  const [open, setOpen] = useState(false);

  const show = formatScore ?? fallbackFormat;
  const full = awarded >= possible;
  const none = awarded <= 0;

  return (
    <div
      className="group px-5 py-3"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onFocus={() => setOpen(true)}
        aria-expanded={open}
        className="flex w-full items-baseline justify-between gap-3 text-start"
      >
        <span className="min-w-0 text-[13.5px] text-ink">{criterion}</span>

        <span
          className={cn(
            'figure shrink-0 text-[13px]',
            full ? 'text-correct' : none ? 'text-mark' : 'text-partial',
          )}
        >
          {show(awarded)} / {show(possible)}
        </span>
      </button>

      {/* The reason. Rendered always for screen readers and collapsed visually,
          so the explanation is in the document rather than conjured on hover. */}
      <p
        className={cn(
          'overflow-hidden text-[12.5px] leading-snug text-ink-muted transition-all duration-150',
          open ? 'mt-1.5 max-h-40 opacity-100' : 'max-h-0 opacity-0',
        )}
      >
        <span className="label me-1.5">{t.examSim.justification}</span>
        {justification}
      </p>

      {!open && (
        <p className="mt-0.5 text-[11.5px] text-ink-faint group-hover:hidden">
          {t.examSim.whyThisMark}
        </p>
      )}
    </div>
  );
}
