import { cn } from '@/lib/cn';

/**
 * The tutor, with a face.
 *
 * It replaces a speech-bubble glyph, and the difference is not decoration. A
 * bubble is a label for a feature — it says "messaging lives here". A face is
 * somebody already in the room, which is the thing a student is supposed to feel
 * about a tutor they have named. The mortarboard is what makes it read as *this*
 * product's tutor inside a page full of line icons, rather than a generic
 * assistant blob.
 *
 * The expression is driven by state that is actually true, never by an idle
 * loop. `tailwind.config.ts` resolves `float`, `wiggle` and `pulse-slow` to
 * `none` on purpose — ambient motion was taken out of this codebase, and a
 * mascot that blinks at a student reading a mark scheme would be putting it back
 * one component at a time. So:
 *
 *   idle      — open eyes. Nothing is happening and it does not pretend.
 *   thinking  — eyes narrow to rests while a session is opening. That is a real
 *               pending request, so it is a progress indicator, not a mood.
 *   attentive — a raised brow when the page has anchored something. It means "I
 *               can see what you are looking at", which is exactly the claim the
 *               dock then makes in words.
 *
 * Two-tone. The face takes `currentColor`, so it inherits from whatever it sits
 * in; the eyes and mouth are knocked out in the colour *behind* it rather than
 * being a third colour with its own contrast to keep. Both tones are named as
 * whole class strings because Tailwind reads them out of the source — a
 * template built from a prop would compile to a class that was never generated.
 */

export type TutorMood = 'idle' | 'thinking' | 'attentive';

/** The surface the face is drawn on. Eyes and mouth are cut out of it. */
const INK = {
  /** On the primary-filled dock button. */
  primary: { fill: 'fill-primary', stroke: 'stroke-primary' },
  /** On a raised paper surface, where the face itself is primary. */
  paper: { fill: 'fill-paper-raised', stroke: 'stroke-paper-raised' },
} as const;

export function TutorAvatar({
  mood = 'idle',
  ink = 'primary',
  className,
  size = 30,
}: {
  mood?: TutorMood;
  ink?: keyof typeof INK;
  className?: string;
  size?: number;
}) {
  const tone = INK[ink];

  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      className={cn('shrink-0', className)}
      aria-hidden="true"
      focusable="false"
    >
      {/*
        Head first, so the cap overlaps it rather than floating above a gap.
        Rounder than it was — 8.9 by 8.3 against 8.4 by 7.6. The old ellipse was
        wide and flat, which at 22px in the dock read as a generic academic icon
        rather than as somebody. A near-circle reads as a face at any size, and
        size is the constraint: this is drawn at 22px far more often than at 30.
      */}
      <ellipse cx="16" cy="20.2" rx="8.9" ry="8.3" fill="currentColor" />

      {/* Mortarboard: a diamond and a short tassel. At 22px the tassel is two
          pixels of nothing, but it is what stops the cap reading as a hat. */}
      <path d="M16 5.6 27 10.2 16 14.8 5 10.2Z" fill="currentColor" />
      <path
        d="M24.8 11.4v3.1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="24.8" cy="15.4" r="1.15" fill="currentColor" />

      {mood === 'thinking' ? (
        /* Eyes down and narrowed — the shape of someone reading, not asleep. */
        <>
          <path
            d="M10.4 20.4h2.9M18.7 20.4h2.9"
            fill="none"
            strokeWidth="1.7"
            strokeLinecap="round"
            className={tone.stroke}
          />
          {/* A small straight mouth. Not a frown — it is concentrating, not
              disappointed, and a downward curve here would read as bad news
              arriving before the answer does. */}
          <path
            d="M13.9 24.2h4.2"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="round"
            className={tone.stroke}
          />
        </>
      ) : (
        <>
          {/*
            Bigger eyes — 1.85 against 1.55 — and set slightly wider and lower.
            Eye size is most of what separates a character from a pictogram, and
            it survives being drawn at 22px where a brow or a cheek does not.
          */}
          <circle cx="12.5" cy="19.9" r="1.85" className={tone.fill} />
          <circle cx="19.5" cy="19.9" r="1.85" className={tone.fill} />

          {/*
            A highlight in each eye, one pixel across at the smallest size it is
            drawn. It is the difference between an eye and a dot, and it costs
            two elements — the reason it is drawn in `currentColor` rather than
            white is that the face IS currentColor, so the highlight is a hole
            in the pupil and works on either ink.
          */}
          <circle cx="13.1" cy="19.3" r="0.6" fill="currentColor" />
          <circle cx="20.1" cy="19.3" r="0.6" fill="currentColor" />

          {mood === 'attentive' && (
            /* One raised brow. Enough to change the expression, little enough
               that it never reads as a second face. */
            <path
              d="M17.9 16.6q1.5-1 3 0"
              fill="none"
              strokeWidth="1.3"
              strokeLinecap="round"
              className={tone.stroke}
            />
          )}
          {/*
            Cheeks. Two soft ovals at a third opacity, outside the eyes and
            below them.

            This is the one element here that is pure warmth — it says nothing
            true about the system's state, which every other feature of this
            face does. It earns its place because a face with eyes and a mouth
            and nothing else reads as neutral, and neutral is what the whole
            palette change is trying to move away from. At 22px they are a
            suggestion rather than a shape, which is the intent.
          */}
          <ellipse cx="9.6" cy="22.3" rx="1.5" ry="1.05" className={tone.fill} opacity="0.32" />
          <ellipse cx="22.4" cy="22.3" rx="1.5" ry="1.05" className={tone.fill} opacity="0.32" />

          {/* A wider, shallower smile than before: it sits under bigger eyes. */}
          <path
            d="M12.8 23.4q3.2 2.4 6.4 0"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="round"
            className={tone.stroke}
          />
        </>
      )}
    </svg>
  );
}
