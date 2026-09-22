'use client';

import { Badge } from '@/components/ui/feedback';
import { MathText } from '@/components/ui/math';
import { cn } from '@/lib/cn';

/**
 * The multiple-choice answer list.
 *
 * Radio cards rather than a select: the options are the question, and a student
 * comparing four expressions should not have to open a menu to see the second
 * one. The whole card is the label, so the tap target is the option rather than
 * a 16px dot beside it.
 *
 * Pulled out of `quiz-runner.tsx` so the marketing page can show the real
 * control instead of a lookalike. That is the only reason `verdicts` exists:
 * the preview grades on the spot to demonstrate what the product does, where
 * the runner marks server-side after the paper is submitted. Nothing else about
 * the two renderings differs, which is the point.
 *
 * A verdict is a tint *and* a worded badge, never a tint alone — the same rule
 * every other status in this product follows, and the reason a colourblind
 * student can still read this screen.
 */

export type Choice = { id: string; text: string };

export type ChoiceVerdict = { tone: 'correct' | 'mark'; label: string };

export function ChoiceList({
  name,
  legend,
  options,
  value,
  onChange,
  verdicts,
  disabled,
  dir,
}: {
  /** Radio group name — must be unique per question on the page. */
  name: string;
  legend: string;
  options: Choice[];
  value: string | undefined;
  onChange: (optionId: string) => void;
  /** Optional per-option marking, keyed by option id. Used by the preview only. */
  verdicts?: Record<string, ChoiceVerdict | undefined>;
  disabled?: boolean;
  /** The subject's own direction, where the caller knows it. See `MathText`. */
  dir?: 'ltr' | 'rtl';
}) {
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="mb-2 text-meta font-medium text-ink">{legend}</legend>

      {options.map((option) => {
        const selected = value === option.id;
        const verdict = verdicts?.[option.id];

        return (
          <label
            key={option.id}
            className={cn(
              'flex cursor-pointer items-start gap-3 rounded border px-3 py-2.5 transition-colors duration-150',
              verdict
                ? verdict.tone === 'correct'
                  ? 'border-correct/40 bg-correct-soft'
                  : 'border-mark/40 bg-mark-soft'
                : selected
                  ? 'border-primary bg-primary-soft'
                  : 'border-rule-strong hover:bg-paper-sunken',
              disabled && 'cursor-not-allowed',
            )}
          >
            <input
              type="radio"
              name={name}
              checked={selected}
              onChange={() => onChange(option.id)}
              className="mt-1 h-4 w-4 shrink-0 accent-[hsl(var(--primary))]"
            />
            <MathText compact dir={dir} className="min-w-0 flex-1">
              {option.text}
            </MathText>
            {verdict && (
              <Badge tone={verdict.tone === 'correct' ? 'correct' : 'mark'}>{verdict.label}</Badge>
            )}
          </label>
        );
      })}
    </fieldset>
  );
}
