'use client';

import { useState } from 'react';

import { MathText } from '@/components/ui/math';
import { FigureViewer } from '@/components/ui/figure-viewer';
import { useI18n } from '@/lib/i18n/client';

/**
 * The official answer to ONE part of an exercise, behind a button.
 *
 * `RevealableSolution` is sized for a whole exercise: a header bar, a blurred
 * block, a hover hint. Under each of thirteen parts that is thirteen bars, so
 * this is the small version — a link that opens the answer in place, and stays
 * open until it is closed. Nothing is rendered until it is asked for, so the
 * answer cannot be read off the page by accident, or by a screen reader.
 */
export function PartAnswer({ answer, image, dir }: { answer?: string; image?: string; dir?: 'ltr' | 'rtl' }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="text-meta font-medium text-primary underline-offset-2 hover:underline"
      >
        {open ? t.oldCycles.hideAnswer : t.oldCycles.showAnswer}
      </button>
      {open && (
        <div className="mt-2 rounded border border-rule bg-paper-sunken px-3 py-2">
          {answer ? <MathText dir={dir}>{answer}</MathText> : null}
          {image ? (
            <div className={answer ? 'mt-3' : ''}>
              <FigureViewer src={image} wide />
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
