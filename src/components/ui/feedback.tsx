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
  },
  neutral: {
    wrap: 'border-rule bg-paper-sunken',
    title: 'text-ink',
    body: 'text-ink-muted',
  },
  pending: {
    wrap: 'border-partial/30 bg-partial-soft',
    title: 'text-partial',
    body: 'text-ink-muted',
  },
} as const;

export function EmptyState({ tone = 'neutral', title, body, action, className }: EmptyStateProps) {
  const styles = TONE[tone];

  return (
    <div
      className={cn(
        'flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-10 text-center',
        styles.wrap,
        className,
      )}
    >
      <p className={cn('font-serif text-[17px] font-semibold', styles.title)}>{title}</p>
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
  tone?: 'neutral' | 'primary' | 'mark' | 'correct' | 'partial';
  children: ReactNode;
  className?: string;
};

const BADGE_TONE = {
  neutral: 'border-rule-strong bg-paper-sunken text-ink-muted',
  primary: 'border-primary/25 bg-primary-soft text-primary',
  mark: 'border-mark/25 bg-mark-soft text-mark',
  correct: 'border-correct/25 bg-correct-soft text-correct',
  partial: 'border-partial/30 bg-partial-soft text-partial',
} as const;

export function Badge({ tone = 'neutral', children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[11.5px] font-medium leading-tight',
        BADGE_TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Skeleton block for content that is genuinely loading, not permanently absent. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse-slow rounded bg-paper-sunken', className)} aria-hidden="true" />;
}
