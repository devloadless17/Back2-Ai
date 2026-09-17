import Link from 'next/link';

import { subjectIcon } from '@/lib/subject-icon';
import { cn } from '@/lib/cn';

/**
 * The one thing to do next, and why.
 *
 * THE DASHBOARD'S ONLY JOB IN THE FIRST THREE SECONDS. A student opening this
 * at eleven at night has already decided to work; what they have not decided is
 * what to open. Every figure on this page is a way of postponing that decision,
 * so this card is given more weight than all of them together and everything
 * else is context beneath it.
 *
 * THE REASON IS NOT DECORATION. "Practise Integrals" is a suggestion; "practise
 * Integrals, because you have lost marks on it three times" is an argument, and
 * a student who disagrees with the argument can overrule it knowing what they
 * are overruling. The product's whole claim is that it has watched them work —
 * this line is where that claim is cashed.
 *
 * EVERY REASON IS EARNED FROM STORED DATA. `reason` is passed in rather than
 * composed here, because the honest wording depends on which evidence exists,
 * and that decision belongs with the code that read the evidence. This
 * component never invents one: with no reason it shows the action alone, which
 * is still true and still useful, rather than a sentence that sounds
 * personalised and is not.
 */
export function NextMove({
  subjectName,
  title,
  reason,
  meta,
  href,
  cta,
  eyebrow,
}: {
  /** Drives the icon. Null for an action that belongs to no single subject. */
  subjectName?: string | null;
  /** What to do, in three or four words. */
  title: string;
  /** Why this and not something else. Omitted when nothing true can be said. */
  reason?: string | null;
  /** Cost and shape — "5 official questions · 20 min". */
  meta?: string | null;
  href: string;
  cta: string;
  eyebrow: string;
}) {
  return (
    <section
      className={cn(
        'relative overflow-hidden rounded-2xl border border-rule bg-paper-raised',
        'shadow-sm transition-shadow duration-150 hover:shadow-md',
      )}
    >
      {/*
        A mint edge down the leading side rather than a filled card.
        A saturated panel would shout over every other surface on the page and
        make the mint the wallpaper; a 3px rule makes this the only element with
        the brand colour on it, which is what marks it as the primary action
        without raising the volume of the whole screen. `start` rather than
        `left` so it sits on the correct edge in Arabic.
      */}
      <span aria-hidden className="absolute inset-y-0 start-0 w-[3px] bg-primary" />

      <div className="p-5 ps-6 sm:p-6 sm:ps-7">
        <p className="text-micro font-semibold uppercase tracking-[0.12em] text-primary">
          {eyebrow}
        </p>

        <div className="mt-2.5 flex items-start gap-3.5">
          {subjectName && (
            <span
              aria-hidden
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-xl"
            >
              {subjectIcon(subjectName)}
            </span>
          )}

          <div className="min-w-0 flex-1">
            {subjectName && (
              <p className="truncate text-caption text-ink-faint">{subjectName}</p>
            )}
            {/*
              The largest type on the page after the readiness figure. A next
              action set at body size is a suggestion among suggestions.
            */}
            <h2 className="mt-0.5 text-lg font-semibold leading-snug text-ink sm:text-xl">
              {title}
            </h2>
          </div>
        </div>

        {reason && (
          <p className="mt-3 max-w-prose text-sm leading-relaxed text-ink-muted">{reason}</p>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
          <Link
            href={href}
            className={cn(
              'inline-flex h-10 items-center rounded-lg bg-primary px-5 text-sm font-medium text-on-primary',
              'transition-colors duration-150 hover:bg-primary-hover',
            )}
          >
            {cta}
          </Link>
          {meta && <span className="text-caption text-ink-faint">{meta}</span>}
        </div>
      </div>
    </section>
  );
}
