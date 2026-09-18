'use client';

import { useEffect, useRef } from 'react';

import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n/client';

/**
 * A modal built on the native `<dialog>`.
 *
 * `showModal()` is used rather than a div with a high z-index because the
 * browser then supplies the three things a hand-rolled modal almost always
 * gets wrong: the focus trap, Escape to dismiss, and inertness of everything
 * behind it. Reimplementing those is how a dialog ends up unusable with a
 * keyboard.
 *
 * The element is always mounted and opened imperatively, because `showModal()`
 * has to run on a node that is already in the document. `open` is therefore
 * driven through an effect rather than by conditionally rendering the dialog.
 *
 * Direction is inherited, not set. The dialog is interface chrome, so it
 * follows the interface language — content inside it that has its own script
 * carries its own `dir`, exactly as it does everywhere else.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      // Fires for Escape as well as `close()`, so the parent's state cannot
      // drift out of step with what the browser has actually done.
      onClose={onClose}
      // Clicking the backdrop dismisses. The backdrop is the dialog element
      // itself — the panel inside it is a separate box — so comparing the
      // target against the dialog distinguishes the two without a ref dance.
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      className={cn(
        'w-[min(30rem,calc(100vw-2rem))] rounded-sm border border-rule bg-paper p-0 text-ink shadow-[0_24px_50px_-18px_rgb(0_0_0_/_0.45)]',
        'backdrop:bg-ink/40',
      )}
    >
      <div className="flex items-start justify-between gap-4 border-b border-rule px-5 py-3.5">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t.common.close}
          className="-me-1 rounded px-1.5 text-lead leading-none text-ink-faint hover:text-ink"
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>

      <div className="px-5 py-4">{children}</div>

      {footer && (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-rule px-5 py-3">
          {footer}
        </div>
      )}
    </dialog>
  );
}
