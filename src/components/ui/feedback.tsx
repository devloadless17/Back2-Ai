import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

/**
 * Empty, zero, and done states.
 *
 * `tone` matters more than it looks. "Nothing due today — you're caught up" is
 * an achievement and should read as one; "no questions in this chapter yet" is
 * a gap in the content, not the student's fault. Rendering both as the same
 * grey placeholder throws away the only moment the app gets to say something.
 */
export type EmptyStateProps = {
  tone?: 'positive' | 'neutral' | 'pending';
  title: string;
  body?: string;
  action?: ReactNode;
  className?: string;
};

const TONE = {
  positive: {
    wrap: 'border-correct/25 bg-correct-soft',
    title: 'text-correct',
    body: 'text-ink-muted',
    glyph: '✓',
    glyphWrap: 'bg-correct/12 text-correct',
  },
  neutral: {
    wrap: 'border-rule bg-paper-sunken',
    title: 'text-ink',
    body: 'text-ink-muted',
    glyph: '✦',
    glyphWrap: 'bg-primary/12 text-primary',
  },
  pending: {
    wrap: 'border-partial/30 bg-partial-soft',
    title: 'text-partial',
    body: 'text-ink-muted',
    glyph: '⋯',
    glyphWrap: 'bg-partial/15 text-partial',
  },
} as const;

/**
 * The glyph is the illustration budget.
 *
 * A drawn illustration per empty state would be six images to keep in step with
 * three locales and two text directions; a single large character in a tinted
 * disc reads as deliberate, costs nothing, and cannot go stale. It floats gently
 * so an empty screen still has a pulse.
 */
export function EmptyState({ tone = 'neutral', title, body, action, className }: EmptyStateProps) {
  const styles = TONE[tone];

  return (
    <div
      className={cn(
        'flex animate-pop-in flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-12 text-center',
        styles.wrap,
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'mb-1 flex h-14 w-14 animate-float items-center justify-center rounded-full text-2xl font-bold',
          styles.glyphWrap,
        )}
      >
        {styles.glyph}
      </span>
      <p className={cn('text-[17px] font-extrabold tracking-tight', styles.title)}>{title}</p>
      {body && <p className={cn('max-w-sm text-sm leading-relaxed', styles.body)}>{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export type AlertProps = {
  tone?: 'info' | 'warning' | 'error' | 'success';
  title?: string;
  children: ReactNode;
  className?: string;
};

const ALERT_TONE = {
  info: 'border-primary/25 bg-primary-soft text-ink',
  warning: 'border-partial/30 bg-partial-soft text-ink',
  error: 'border-mark/30 bg-mark-soft text-ink',
  success: 'border-correct/25 bg-correct-soft text-ink',
} as const;

export function Alert({ tone = 'info', title, children, className }: AlertProps) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn('rounded border px-4 py-3 text-sm leading-relaxed', ALERT_TONE[tone], className)}
    >
      {title && <p className="mb-0.5 font-semibold">{title}</p>}
      {children}
    </div>
  );
}

export type BadgeProps = {
  tone?: 'neutral' | 'primary' | 'accent' | 'mark' | 'correct' | 'partial';
  children: ReactNode;
  className?: string;
};

const BADGE_TONE = {
  neutral: 'border-rule-strong bg-paper-sunken text-ink-muted',
  primary: 'border-primary/25 bg-primary-soft text-primary',
  accent: 'border-accent/25 bg-accent-soft text-accent-hover',
  mark: 'border-mark/25 bg-mark-soft text-mark',
  correct: 'border-correct/25 bg-correct-soft text-correct',
  partial: 'border-partial/30 bg-partial-soft text-partial',
} as const;

export function Badge({ tone = 'neutral', children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11.5px] font-bold leading-tight',
        BADGE_TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * Skeleton block for content that is genuinely loading, not permanently absent.
 *
 * Shimmers in brand colour rather than pulsing grey, so a loading screen still
 * looks like this product.
 */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('shimmer rounded-lg', className)} aria-hidden="true" />;
}
