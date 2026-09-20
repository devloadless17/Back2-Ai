import { cn } from '@/lib/cn';

/**
 * The BAC² identity, drawn from the exam paper rather than from Lebanon.
 *
 * The temptation with a Lebanese product is the flag and the cedar. Both are
 * cliché and neither says anything about what this does. The specificity that
 * actually belongs to BAC2 is the paper itself: a Baccalaureate script has a
 * ruled margin, a question number in that margin, and the marks each question
 * is worth printed beside it. That is the visual language a candidate has been
 * staring at since first secondary, and nothing else looks like it.
 *
 * So three motifs, used sparingly and always meaning something:
 *
 *   `Seal`        a stamped monogram, for the few places that need a signature
 *   `MarginRule`  the ruled margin, with the mark allocation in it
 *   `SectionMark` the editorial notation that numbers the story
 *
 * If a section of this page were screenshotted without the navbar, these are
 * what should still identify it.
 */

/* -------------------------------------------------------------------------
 * The seal.
 * ---------------------------------------------------------------------- */

/**
 * A stamp, not a logo.
 *
 * Squared rather than circular, because an official Lebanese paper is stamped
 * with a rectangular mark rather than a rosette, and because a square sits
 * quietly beside type where a circle draws the eye. The clipped top-inline
 * corner is the only ornament — it reads as a stamped or embossed edge without
 * being a shape anyone has to decode.
 *
 * Deliberately small everywhere it appears. A seal that has to be large is not
 * a seal, it is a logo, and BAC2 does not have one of those yet.
 */
export function Seal({
  className,
  tone = 'ink',
}: {
  className?: string;
  tone?: 'ink' | 'primary' | 'paper';
}) {
  const colour =
    tone === 'primary'
      ? 'border-primary text-primary'
      : tone === 'paper'
        ? 'border-paper/40 text-paper'
        : 'border-ink/25 text-ink';

  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex size-9 shrink-0 select-none items-center justify-center border',
        // The notch. `polygon` rather than a border-radius so the cut reads as
        // an edge that was struck, not a corner that was softened.
        '[clip-path:polygon(0_0,calc(100%-7px)_0,100%_7px,100%_100%,0_100%)]',
        colour,
        className,
      )}
    >
      <span className="font-display text-[0.9rem] font-semibold leading-none tracking-tight">
        B<sup className="text-[0.55em] font-normal">2</sup>
      </span>
    </span>
  );
}

/* -------------------------------------------------------------------------
 * Nour.
 * ---------------------------------------------------------------------- */

/**
 * The mortarboard, small.
 *
 * Nour has a face in the product and it stays this size everywhere. A tutor
 * who sits beside the student does not need to be the largest thing on the
 * screen, and scaling this up is precisely how an identity becomes a mascot.
 * It lives here rather than with the product fragments because it is part of
 * the brand, not part of any one surface.
 */
export function NourMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-on-primary',
        className,
      )}
    >
      <svg viewBox="0 0 24 24" className="size-[55%]" fill="currentColor">
        <path d="M12 3 1.5 8.25 12 13.5l8.25-4.125V15h1.5V8.25L12 3Z" />
        <path d="M5.25 11.1v3.9c0 1.7 3.02 3.15 6.75 3.15s6.75-1.45 6.75-3.15v-3.9L12 14.85 5.25 11.1Z" />
      </svg>
    </span>
  );
}

/* -------------------------------------------------------------------------
 * The margin.
 * ---------------------------------------------------------------------- */

/**
 * The ruled margin of a script, with what the question is worth in it.
 *
 * On a real paper the margin carries the question number at the top and the
 * mark allocation beside each part. Both are set small, in the same hand as
 * the rest of the paper, and neither is decorated. That restraint is the whole
 * effect — the moment this becomes a coloured sidebar it stops being a margin
 * and becomes a callout.
 *
 * `start`/`end` rather than left/right throughout, so the margin sits on the
 * correct side of an Arabic paper.
 */
export function MarginRule({
  number,
  marks,
  children,
  className,
  tone = 'light',
}: {
  /** The question number, as the paper prints it. */
  number?: string;
  /** What it is worth. */
  marks?: string;
  children: React.ReactNode;
  className?: string;
  tone?: 'light' | 'dark';
}) {
  const rule = tone === 'dark' ? 'border-paper/20' : 'border-rule-strong';
  const ink = tone === 'dark' ? 'text-paper/55' : 'text-ink-faint';

  return (
    <div className={cn('flex gap-4 sm:gap-6', className)}>
      <div className={cn('flex w-10 shrink-0 flex-col items-end border-e pe-3 text-end sm:w-14', rule)}>
        {number && (
          <span className={cn('figure text-meta leading-none', tone === 'dark' ? 'text-paper' : 'text-ink')}>
            {number}
          </span>
        )}
        {marks && (
          <span className={cn('mt-1.5 text-micro leading-none', ink)}>{marks}</span>
        )}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Section notation.
 * ---------------------------------------------------------------------- */

/**
 * `01 / PRACTICE`.
 *
 * Structured academic material numbers its parts, and so does this page. The
 * numeral is the only thing carrying the brand colour; the name is set in the
 * same small caps the product uses for every field label, so it reads as
 * notation rather than as an agency's chapter card.
 */
export function SectionMark({
  index,
  label,
  tone = 'light',
  className,
}: {
  index: string;
  label: string;
  tone?: 'light' | 'dark';
  className?: string;
}) {
  return (
    <p
      className={cn(
        'flex items-center gap-2.5 text-micro font-semibold uppercase tracking-[0.16em]',
        className,
      )}
    >
      <span className={cn('figure', tone === 'dark' ? 'text-correct-bright' : 'text-primary')}>
        {index}
      </span>
      <span aria-hidden className={cn('h-px w-6', tone === 'dark' ? 'bg-paper/30' : 'bg-rule-strong')} />
      <span className={tone === 'dark' ? 'text-paper/60' : 'text-ink-faint'}>{label}</span>
    </p>
  );
}

/* -------------------------------------------------------------------------
 * Paper ruling, as a background.
 * ---------------------------------------------------------------------- */

/**
 * The faint horizontal ruling of a script, behind a section.
 *
 * Kept at a real writing rhythm — 2.25rem, about the line spacing of an exam
 * booklet — so it reads as paper rather than as a grid. Always decorative,
 * always `aria-hidden`, never animated.
 */
export function PaperRuling({
  className,
  tone = 'light',
}: {
  className?: string;
  tone?: 'light' | 'dark';
}) {
  return (
    <div
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-0',
        tone === 'dark'
          ? 'opacity-[0.07] [background-image:linear-gradient(hsl(var(--paper))_1px,transparent_1px)]'
          : 'opacity-[0.4] [background-image:linear-gradient(hsl(var(--rule))_1px,transparent_1px)]',
        '[background-size:100%_2.25rem]',
        className,
      )}
    />
  );
}

/**
 * An oversized numeral behind a section.
 *
 * Density without another card. It sits under the content at very low
 * contrast, the way a figure number sits on a plate in a textbook — present
 * when you look for it, invisible when you are reading.
 */
export function GhostNumeral({ children, className }: { children: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'figure pointer-events-none absolute select-none leading-none',
        'text-[7rem] text-ink/[0.035] sm:text-[11rem]',
        className,
      )}
    >
      {children}
    </span>
  );
}
