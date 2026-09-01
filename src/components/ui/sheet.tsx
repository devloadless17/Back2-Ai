import type { HTMLAttributes, ReactNode } from 'react';

import Link from 'next/link';

import { cn } from '@/lib/cn';

/**
 * Surfaces.
 *
 * A "sheet" is the base container: an inflated card with a tinted header, the
 * same object language as the flashcards. It used to be flat white stock, on
 * the argument that depth is decoration and hierarchy should come from rules
 * and space. That holds for one card. It does not survive six of them stacked
 * down a dashboard, which is what this product actually renders — with nothing
 * lifting and nothing tinted, the page reads as a single sheet of paper and a
 * student cannot tell where one thing ends and the next begins.
 *
 * `interactive` lifts the card toward the pointer, which is how a student
 * learns a whole card is clickable. `hero` draws the accent rule along the top
 * edge, and there should be at most one per screen — the moment there are two,
 * neither reads as the important one.
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
        // `sheet-head` tints the band and rounds the top corners to the card's.
        'sheet-head flex flex-wrap items-start justify-between gap-3 border-b border-rule px-5 py-4',
        className,
      )}
    >
      <div className="min-w-0 space-y-0.5">
        <h2 className="text-lead font-semibold">{title}</h2>
        {description && <p className="text-meta text-ink-muted">{description}</p>}
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
        'sheet-foot flex flex-wrap items-center gap-2 border-t border-rule bg-paper-sunken/40 px-5 py-3',
        className,
      )}
    >
      {children}
    </footer>
  );
}

/**
 * Top-of-page heading, closed by a rule.
 *
 * Modest in size. On a screen that is mostly figures the heading only has to
 * say where you are; making it the loudest thing on the page steals attention
 * from the numbers the student came for.
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
        'mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-rule pb-4',
        className,
      )}
    >
      <div className="min-w-0 space-y-1">
        <h1 className="text-title font-semibold sm:text-heading">{title}</h1>
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
      className={cn('flex items-baseline gap-3 px-5 py-3', className)}
    >
      {children}
    </div>
  );
}

/**
 * A headline figure with its label.
 *
 * The label sits above in small caps and the figure below it, large and
 * tabular. No icon and no tint: on a dashboard of eight figures, eight coloured
 * discs are eight things competing with the numbers they decorate.
 */
export function StatTile({
  label,
  value,
  caption,
  tone = 'plain',
  footer,
  href,
  className,
}: {
  label: string;
  value: ReactNode;
  caption?: ReactNode;
  /** `mark` prints the figure in the accent — used for the predicted mark only. */
  tone?: 'plain' | 'mark';
  footer?: ReactNode;
  /**
   * Makes the whole tile the way to act on the figure it prints.
   *
   * A number a student cannot do anything with is a number they read once. It
   * is optional because most of these are readings — a predicted mark is not a
   * destination — and a tile that looks clickable and is not is worse than a
   * plain one.
   */
  href?: string;
  className?: string;
}) {
  /*
   * Two branches rather than one dynamic tag. `const Tile = href ? Link : 'div'`
   * reads better and does not typecheck: the union widens `href` to
   * `string | undefined`, which `Link` will not accept.
   */
  const body = (
    <>
      <p className="label">{label}</p>

      <p
        className={cn(
          'figure text-heading leading-none sm:text-display',
          tone === 'mark' ? 'text-primary' : 'text-ink',
        )}
      >
        {value}
      </p>

      {caption && <p className="text-caption text-ink-muted">{caption}</p>}
      {footer && <div className="mt-1">{footer}</div>}
    </>
  );

  const shell = cn('sheet flex flex-col gap-1.5 p-4', className);

  return href ? (
    <Link href={href} className={cn(shell, 'sheet-interactive pressable')}>
      {body}
    </Link>
  ) : (
    <div className={shell}>{body}</div>
  );
}
