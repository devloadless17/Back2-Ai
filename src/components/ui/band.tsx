import type { SVGProps } from 'react';

import { cn } from '@/lib/cn';

/**
 * The status band system.
 *
 * One rule holds this together: a band is never carried by colour alone. Every
 * band is a triple — colour, icon, label — and the icon and label must still
 * say everything if the colour is stripped. Print a page in greyscale, or hand
 * it to the eight percent of boys who will not distinguish the amber from the
 * green, and the meaning has to survive intact.
 *
 * That is why the icons are shape-distinct rather than the same glyph tinted
 * four ways: a triangle, a half circle, a shield, a question mark, a dashed
 * ring. You can tell them apart at 12px with no colour at all.
 *
 * `not_started` is a band in its own right and is deliberately not folded into
 * `weak`. "We have no evidence yet" and "the evidence says you are struggling"
 * are different claims, and telling a student they are weak at something they
 * have never attempted is the fastest way to lose their trust in every other
 * number on the page.
 *
 * `needs_review` is not a mastery band at all — it belongs to marking, and
 * means a human has to look. It lives here so it shares the same never-colour-
 * alone treatment, not because it sits on the same scale.
 */

export type Band = 'weak' | 'developing' | 'mastered' | 'not_started' | 'needs_review';

/**
 * The cut points are the product's own, not new numbers invented for the UI.
 * `mastered` starts at 0.7 because that is `WEAKNESS_MASTERY_CEILING` — the
 * threshold the planner and the flashcard weak-scope already use to decide a
 * chapter no longer needs drilling. A visual band that disagreed with the
 * scheduler would be the UI quietly telling a different story from the engine.
 */
export function bandForMastery(masteryScore: number, attemptsCount: number): Band {
  if (attemptsCount === 0) return 'not_started';
  if (masteryScore < 0.4) return 'weak';
  if (masteryScore < 0.7) return 'developing';
  return 'mastered';
}

type BandStyle = {
  /** Solid fill, for tiles and dots. */
  fill: string;
  /** Text and icon colour on a light ground — every one clears 4.5:1 on white. */
  ink: string;
  /** Tinted ground for chips. */
  soft: string;
};

const STYLES: Record<Band, BandStyle> = {
  weak: { fill: 'bg-mark-bright', ink: 'text-mark', soft: 'bg-mark-soft' },
  developing: { fill: 'bg-partial-bright', ink: 'text-partial', soft: 'bg-partial-soft' },
  mastered: { fill: 'bg-correct-bright', ink: 'text-correct', soft: 'bg-correct-soft' },
  not_started: { fill: 'bg-paper-sunken', ink: 'text-ink-muted', soft: 'bg-paper-sunken' },
  needs_review: { fill: 'bg-viz-2', ink: 'text-primary', soft: 'bg-primary-soft' },
};

export function bandStyle(band: Band): BandStyle {
  return STYLES[band];
}

type IconProps = SVGProps<SVGSVGElement> & { band: Band };

/**
 * Shape carries the meaning; colour only reinforces it.
 *
 * Decorative by default — every place this renders puts the label beside it, so
 * a screen reader that announced the icon too would just say everything twice.
 */
export function BandIcon({ band, className, ...props }: IconProps) {
  const shared = {
    width: 14,
    height: 14,
    viewBox: '0 0 16 16',
    'aria-hidden': true as const,
    focusable: 'false' as const,
    className: cn('shrink-0', className),
    ...props,
  };

  switch (band) {
    // Triangle with a single bar — the shape of a warning, read before it is
    // read as a colour.
    case 'weak':
      return (
        <svg {...shared} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
          <path d="M8 2.2 14.4 13.2H1.6z" />
          <path d="M8 6.4v3.1" strokeLinecap="round" />
        </svg>
      );

    // Half-filled circle — literally half way.
    case 'developing':
      return (
        <svg {...shared} fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="8" cy="8" r="6.1" />
          <path d="M8 1.9a6.1 6.1 0 0 1 0 12.2z" fill="currentColor" stroke="none" />
        </svg>
      );

    // Filled shield with a check — the only solid, closed shape in the set.
    case 'mastered':
      return (
        <svg {...shared} fill="none">
          <path d="M8 1.4 13.6 3.5v4.2c0 3.2-2.3 5.8-5.6 6.9-3.3-1.1-5.6-3.7-5.6-6.9V3.5z" fill="currentColor" />
          <path
            d="m5.5 7.9 1.9 1.9 3.3-3.5"
            stroke="hsl(var(--paper-raised))"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );

    // A question in a badge — marking could not decide, a human must.
    case 'needs_review':
      return (
        <svg {...shared} fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="8" cy="8" r="6.1" />
          <path d="M6.3 6.1a1.75 1.75 0 1 1 2.3 1.7c-.4.2-.6.5-.6.9v.4" strokeLinecap="round" />
          <circle cx="8" cy="11.5" r="0.85" fill="currentColor" stroke="none" />
        </svg>
      );

    // An open dashed ring: nothing recorded, nothing implied.
    case 'not_started':
    default:
      return (
        <svg {...shared} fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="8" cy="8" r="6.1" strokeDasharray="2.6 2.4" />
        </svg>
      );
  }
}

/**
 * The band as a labelled chip. This is the default way to show status anywhere
 * there is room for words — lists, tables, result rows.
 */
export function BandChip({
  band,
  label,
  className,
}: {
  band: Band;
  label: string;
  className?: string;
}) {
  const style = bandStyle(band);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-caption font-semibold',
        style.soft,
        style.ink,
        className,
      )}
    >
      <BandIcon band={band} />
      {label}
    </span>
  );
}
