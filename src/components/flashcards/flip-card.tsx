'use client';

import type { CSSProperties, ReactNode } from 'react';

import { cn } from '@/lib/cn';

/**
 * The card that turns.
 *
 * Lifted out of `review-session.tsx` unchanged so it can be shown on the
 * marketing page as the real thing. The alternative — a second, simpler flip
 * card written for the landing page — is a promise the product then has to keep
 * by hand: the day the review card gains a header, loses its shadow or changes
 * how it announces itself, the marketing copy quietly starts advertising a card
 * that no longer exists.
 *
 * Everything the turn depends on lives in `globals.css` (`.flip-stage`,
 * `.flip-card`, `.flip-face`) and is untouched here, including the reduced-
 * motion path where the rotation is dropped and the back simply appears, and
 * the RTL path where the card turns the other way so the gesture matches the
 * reading direction.
 *
 * The faces are `.card-bubble` rather than `.sheet`: rounder, lifted further,
 * lit from the top. A flashcard is held rather than read, and it was wearing
 * the same surface as an admin table.
 *
 * Both faces are always mounted. `backface-visibility` hides the one turned
 * away, so a screen reader can read the answer before the flip rather than
 * meeting a card whose back does not exist until it is clicked.
 */
export function FlipCard({
  flipped,
  onFlip,
  label,
  minHeight = '17rem',
  className,
  front,
  back,
}: {
  flipped: boolean;
  onFlip: () => void;
  /** What the control does, or what is showing once it has been used. */
  label: string;
  /** Reserved height for the stage — the back face is absolute and cannot set it. */
  minHeight?: string;
  className?: string;
  front: ReactNode;
  back: ReactNode;
}) {
  return (
    <div className={cn('flip-stage', className)}>
      <button
        type="button"
        onClick={() => !flipped && onFlip()}
        aria-expanded={flipped}
        aria-label={label}
        className={cn(
          'flip-card block w-full min-h-[var(--flip-min-h)] text-start',
          flipped && 'is-flipped',
        )}
        style={{ '--flip-min-h': minHeight } as CSSProperties}
      >
        <div className="card-bubble flip-face flip-face-front flex h-full min-h-[var(--flip-min-h)] flex-col">
          {front}
        </div>
        <div className="card-bubble flip-face flip-face-back flex h-full min-h-[var(--flip-min-h)] flex-col">
          {back}
        </div>
      </button>
    </div>
  );
}
