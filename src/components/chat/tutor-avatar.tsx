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
      {/* Head first, so the cap overlaps it rather than floating above a gap. */}
      <ellipse cx="16" cy="20" rx="8.4" ry="7.6" fill="currentColor" />

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
            d="M10.6 20.2h2.6M18.8 20.2h2.6"
            fill="none"
            strokeWidth="1.6"
            strokeLinecap="round"
            className={tone.stroke}
          />
          <path
            d="M13.8 24h4.4"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="round"
            className={tone.stroke}
          />
        </>
      ) : (
        <>
          <circle cx="12.6" cy="19.6" r="1.55" className={tone.fill} />
          <circle cx="19.4" cy="19.6" r="1.55" className={tone.fill} />
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
          <path
            d="M13.1 23.1q2.9 2.1 5.8 0"
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
