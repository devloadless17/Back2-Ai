import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

/**
 * Form controls.
 *
 * Every control is labelled and every error is wired to its input with
 * aria-describedby. This is a public-sector product: it will be assessed for
 * accessibility, and a student using a screen reader must hear why a field was
 * rejected, not just that it was.
 */

const CONTROL =
  'w-full rounded border border-rule-strong bg-paper-raised px-3 text-sm text-ink ' +
  'placeholder:text-ink-faint transition-colors duration-150 ' +
  'hover:border-ink-faint ' +
  'disabled:cursor-not-allowed disabled:bg-paper-sunken disabled:text-ink-faint ' +
  'aria-[invalid=true]:border-mark aria-[invalid=true]:bg-mark-soft';

export type FieldProps = {
  label: string;
  /** Guidance shown before the student makes a mistake, not after. */
  hint?: string;
  error?: string | null;
  required?: boolean;
  /** Text shown in place of a control — used for locked fields like track and language. */
  locked?: string;
  children?: (props: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
  className?: string;
};

export function Field({ label, hint, error, required, locked, children, className }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={id} className="block text-[13px] font-medium text-ink">
        {label}
        {required && (
          <span className="ms-1 text-mark" aria-hidden="true">
            *
          </span>
        )}
      </label>

      {hint && (
        <p id={hintId} className="text-[12.5px] leading-snug text-ink-muted">
          {hint}
        </p>
      )}

      {locked !== undefined ? (
        <p className="flex h-10 items-center rounded border border-dashed border-rule-strong bg-paper-sunken px-3 text-sm text-ink-muted">
          {locked}
        </p>
      ) : (
        children?.({ id, describedBy, invalid: Boolean(error) })
      )}

      {error && (
        <p id={errorId} role="alert" className="text-[12.5px] font-medium text-mark">
          {error}
        </p>
      )}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn(CONTROL, 'h-10', className)} {...props} />;
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return <textarea ref={ref} className={cn(CONTROL, 'min-h-[7rem] resize-y py-2.5', className)} {...props} />;
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...props }, ref) {
    return (
      <select ref={ref} className={cn(CONTROL, 'h-10 pe-8', className)} {...props}>
        {children}
      </select>
    );
  },
);

/**
 * Answer input for practice and exam simulation.
 *
 * Monospace and line-height tuned so multi-line working lines up the way it
 * would on squared paper — students write derivations here, not prose.
 */
export const WorkingArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function WorkingArea({ className, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        spellCheck={false}
        className={cn(
          CONTROL,
          'min-h-[12rem] resize-y py-3 font-mono text-[13.5px] leading-[1.9]',
          className,
        )}
        {...props}
      />
    );
  },
);

export function Checkbox({
  label,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const id = useId();
  return (
    <div className={cn('flex items-start gap-2', className)}>
      <input
        id={id}
        type="checkbox"
        className="mt-0.5 h-4 w-4 shrink-0 rounded-sm border-rule-strong text-primary accent-[hsl(var(--primary))]"
        {...props}
      />
      <label htmlFor={id} className="text-sm text-ink">
        {label}
      </label>
    </div>
  );
}
