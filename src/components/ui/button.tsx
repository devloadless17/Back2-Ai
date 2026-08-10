import { forwardRef, type ButtonHTMLAttributes } from 'react';
import Link from 'next/link';

import { cn } from '@/lib/cn';

/**
 * Variants map to intent, not to colour:
 *   primary   — the one action that moves the student forward on this screen
 *   secondary — an alternative that is equally safe
 *   quiet     — navigation and toggles that should not compete
 *   mark      — consequential and hard to undo (submit a paper, reject content)
 *
 * Exactly one `primary` per screen. If a screen needs two, the screen is
 * doing two jobs.
 */
const VARIANTS = {
  primary: 'bg-primary text-on-primary hover:bg-primary-hover border-transparent',
  secondary: 'bg-paper-raised text-ink border-rule-strong hover:bg-paper-sunken',
  quiet: 'bg-transparent text-ink-muted border-transparent hover:bg-paper-sunken hover:text-ink',
  mark: 'bg-mark text-on-primary border-transparent hover:brightness-95',
} as const;

const SIZES = {
  sm: 'h-8 px-3 text-[13px] gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-12 px-6 text-base gap-2',
} as const;

const BASE =
  'inline-flex items-center justify-center rounded border font-medium ' +
  'transition-[background-color,color,box-shadow,transform] duration-150 ease-sheet ' +
  'active:translate-y-px ' +
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
