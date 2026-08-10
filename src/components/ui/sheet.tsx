import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '@/lib/cn';

/**
 * Surfaces. A "sheet" is the base container — printed stock rather than a
 * floating card, matching the exam-paper vocabulary the rest of the design uses.
 */

export function Sheet({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cn('sheet', className)}>{children}</section>;
}

export function SheetHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        'flex flex-wrap items-start justify-between gap-3 border-b border-rule px-5 py-4',
        className,
      )}
    >
      <div className="min-w-0 space-y-0.5">
        <h2 className="text-[15px] font-semibold leading-snug">{title}</h2>
        {description && <p className="text-[13px] leading-snug text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

/**
 * Remaining div props are forwarded so callers can attach ARIA without wrapping
 * the body in a second element — a streamed chat answer needs `aria-live` on
 * the container that actually changes.
 */
export function SheetBody({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div className={cn('px-5 py-4', className)} {...props}>
      {children}
    </div>
  );
}

export function SheetFooter({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <footer className={cn('flex flex-wrap items-center gap-2 border-t border-rule px-5 py-3', className)}>
      {children}
    </footer>
  );
}

/**
 * Top-of-page heading. The page-load reveal lives here rather than on every
 * screen so the entrance is consistent and there is one place to remove it.
 */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-6 flex flex-wrap items-end justify-between gap-4 animate-fade-up', className)}>
      <div className="min-w-0 space-y-1">
        <h1 className="text-2xl leading-tight">{title}</h1>
        {description && <p className="max-w-2xl text-sm leading-relaxed text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** A row in a ruled tabulation — barème breakdowns, grade logs, session lists. */
export function RuledRow({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('flex items-baseline gap-3 px-5 py-3', className)}>{children}</div>;
}
