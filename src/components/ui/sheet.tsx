import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '@/lib/cn';

/**
 * Surfaces.
 *
 * A "sheet" is the base container: a soft white card sitting on the coloured
 * canvas, with a tinted lift rather than a grey drop shadow.
 *
 * `interactive` and `hero` are the two variations worth having. Interactive
 * cards rise under the pointer, which is how a student learns a whole card is
 * clickable without a "view more" link in the corner. A hero card carries the
 * animated brand gradient on its top edge and there should be at most one per
 * screen — the moment there are two, neither reads as the important one.
 */

export function Sheet({
  className,
  interactive,
  hero,
  children,
}: {
  className?: string;
  interactive?: boolean;
  hero?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        'sheet',
        interactive && 'sheet-interactive',
        hero && 'sheet-hero',
        className,
      )}
    >
      {children}
    </section>
  );
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
        <h2 className="text-[15px] font-extrabold leading-snug tracking-tight">{title}</h2>
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
    <footer
      className={cn(
        'flex flex-wrap items-center gap-2 border-t border-rule bg-paper-sunken/40 px-5 py-3',
        className,
      )}
    >
      {children}
    </footer>
  );
}

/**
 * Top-of-page heading.
 *
 * The page-load reveal lives here rather than on every screen so the entrance is
 * consistent and there is one place to remove it. The title is the largest,
 * loudest text in the product — on a screen that is mostly data, the heading is
 * what tells you where you are at a glance.
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
    <div
      className={cn(
        'mb-6 flex animate-rise flex-wrap items-end justify-between gap-4',
        className,
      )}
    >
      <div className="min-w-0 space-y-1">
        <h1 className="text-[28px] font-extrabold leading-tight tracking-tight sm:text-[32px]">
          {title}
        </h1>
        {description && <p className="max-w-2xl text-sm leading-relaxed text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** A row in a ruled tabulation — barème breakdowns, grade logs, session lists. */
export function RuledRow({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        'flex items-baseline gap-3 px-5 py-3 transition-colors duration-150 hover:bg-primary-soft/40',
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * A headline figure with its label — the unit the dashboard is built from.
 *
 * The figure comes first and is enormous; the label sits under it in small
 * caps. A tile whose label is the same size as its number makes the reader do
 * the work of finding the value.
 */
export function StatTile({
  label,
  value,
  caption,
  tone = 'brand',
  icon,
  footer,
  className,
}: {
  label: string;
  value: ReactNode;
  caption?: ReactNode;
  tone?: 'brand' | 'accent' | 'plain';
  icon?: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'sheet sheet-interactive flex flex-col gap-1 p-5',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11.5px] font-bold uppercase tracking-wider text-ink-faint">{label}</p>
        {icon && (
          <span
            aria-hidden="true"
            className={cn(
              'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
              tone === 'accent' ? 'bg-accent-soft text-accent' : 'bg-primary-soft text-primary',
            )}
          >
            {icon}
          </span>
        )}
      </div>

      <p
        className={cn(
          'font-extrabold tabular-nums leading-none tracking-tight',
          'text-[34px] sm:text-[38px]',
          tone === 'plain' ? 'text-ink' : 'text-gradient',
        )}
      >
        {value}
      </p>

      {caption && <p className="text-[12.5px] leading-snug text-ink-muted">{caption}</p>}
      {footer && <div className="mt-2">{footer}</div>}
    </div>
  );
}
