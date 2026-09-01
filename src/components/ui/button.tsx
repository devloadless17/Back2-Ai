import { forwardRef, type ButtonHTMLAttributes } from 'react';
import Link from 'next/link';

import { cn } from '@/lib/cn';

/**
 * Variants map to intent, not to colour:
 *   primary   — the one action that moves the student forward on this screen
 *   accent    — a reward-flavoured action (start a streak, celebrate, upgrade)
 *   secondary — an alternative that is equally safe
 *   quiet     — navigation and toggles that should not compete
 *   mark      — consequential and hard to undo (submit a paper, reject content)
 *
 * Exactly one `primary` per screen. If a screen needs two, the screen is
 * doing two jobs.
 *
 * Every variant lifts on hover and presses in on click. The press is the part
 * that matters: a button that visibly gives under the finger is the cheapest
 * possible confirmation that the tap registered, which on a patchy connection
 * is the difference between waiting and tapping again.
 */
const VARIANTS = {
  primary: 'bg-primary text-on-primary border-primary hover:bg-primary-hover',
  /*
   * Violet, and tinted rather than filled.
   *
   * This was byte-identical to `primary` — same background, same border, same
   * hover — so the variant this file describes as "a reward-flavoured action"
   * rendered as a second primary button, and the rule above ("exactly one
   * primary per screen") was broken by the escape hatch offered for the case
   * that needs two. Nothing used it yet, which is the moment to make it true.
   *
   * Tinted because a solid violet cannot carry a label: white on --accent
   * measures 2.83 in light mode. The tint also does the job better — a filled
   * violet beside a filled indigo reads as two primaries competing, where a
   * tinted one reads as the lighter-weight offer it is. 4.66 light, 7.96 dark.
   */
  accent: 'bg-accent-soft text-accent-hover border-accent/30 hover:bg-accent/20',
  secondary: 'bg-paper-raised text-ink border-rule-strong hover:bg-paper-sunken',
  quiet: 'bg-transparent text-ink-muted border-transparent hover:bg-paper-sunken hover:text-ink',
  /*
   * `hover:brightness-95` was the odd one out: a filter rather than a colour,
   * so it darkened on white and did nothing useful on a dark ground. The rose
   * has a hover cut like every other colour here — use it.
   */
  mark: 'bg-mark text-on-primary border-mark hover:bg-mark/90',
} as const;

const SIZES = {
  sm: 'h-8 px-3 text-caption gap-1.5',
  md: 'h-10 px-4 text-meta gap-2',
  lg: 'h-11 px-5 text-body gap-2',
} as const;

/*
 * The press.
 *
 * This file has described a press since it was written and never had one — only
 * `transition-colors` and a hover. On a phone, where most of these students are,
 * `hover:` does not exist at all, so a tap produced no feedback until the
 * navigation completed. On a slow connection that gap is long enough for someone
 * to tap a second time believing they missed.
 *
 * 120ms and a 3% scale: under the ~200ms floor where motion starts to feel like
 * latency, and small enough that it cannot shift anything around it. Reduced
 * motion drops the transform and keeps the colour change, so the feedback
 * survives without the movement.
 */
const BASE =
  'inline-flex items-center justify-center rounded border font-medium ' +
  'transition-[background-color,border-color,color,transform] duration-150 ' +
  'active:scale-[0.97] active:duration-[120ms] ' +
  'motion-reduce:active:scale-100 motion-reduce:transition-colors ' +
  'disabled:pointer-events-none disabled:opacity-50 ' +
  'aria-busy:pointer-events-none aria-busy:opacity-70';

export type ButtonVariant = keyof typeof VARIANTS;
export type ButtonSize = keyof typeof SIZES;

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Renders a spinner and blocks interaction without changing the layout width. */
  loading?: boolean;
  fullWidth?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading = false, fullWidth, className, children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={props.type ?? 'button'}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(BASE, VARIANTS[variant], SIZES[size], fullWidth && 'w-full', className)}
      {...props}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
});

export type LinkButtonProps = {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
  children: React.ReactNode;
};

/** Same appearance as Button, but renders an anchor — for navigation, not actions. */
export function LinkButton({
  href,
  variant = 'secondary',
  size = 'md',
  fullWidth,
  className,
  children,
}: LinkButtonProps) {
  return (
    <Link
      href={href}
      className={cn(BASE, VARIANTS[variant], SIZES[size], fullWidth && 'w-full', className)}
    >
      {children}
    </Link>
  );
}

function Spinner() {
  return (
    <svg
      className="h-3.5 w-3.5 animate-spin"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
      <path
        d="M14.5 8a6.5 6.5 0 0 0-6.5-6.5"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
