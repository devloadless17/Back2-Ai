import Link from 'next/link';

import { cn } from '@/lib/cn';

/**
 * The way out of a page that is inside another one.
 *
 * Every nested route in the app — a subject, a chapter, a quiz, one old cycle,
 * one chat — had no way back to its parent. The only exit was the browser's own
 * button, and that does not land where a student expects: `/chat` redirects to
 * `/chat/<newest session>` on the server, so going back to it forwards straight
 * on again and the page appears to be skipped. `/exam-sim/new` and `/upload` do
 * the same.
 *
 * A LINK TO THE PARENT, NOT `router.back()`. Deliberately. `router.back()`
 * replays whatever is in history — including those redirects, and including a
 * different subject the student browsed before this one — and it has nowhere to
 * go at all when the page was opened from a notification, a shared link or a
 * fresh tab. The parent of a chapter is its subject whatever route the student
 * took to reach it, so the destination is stated rather than remembered.
 *
 * The arrow is drawn pointing left and flipped under `rtl:`, because "back" is
 * to the right in Arabic. `dir` is set on <html> by the root layout, so the
 * variant resolves per locale without this component knowing which one it is.
 */
export function BackLink({
  href,
  label,
  className,
}: {
  href: string;
  /** Where it goes, named — "Practice", not "Back". See below. */
  label: string;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'group -mx-1 mb-3 inline-flex items-center gap-1.5 rounded-md px-1 py-1',
        'text-caption text-ink-faint transition-colors',
        'hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
        className,
      )}
    >
      <svg
        aria-hidden
        viewBox="0 0 16 16"
        className="size-3.5 shrink-0 transition-transform group-hover:-translate-x-0.5 rtl:rotate-180 rtl:group-hover:translate-x-0.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M10 3.5 5.5 8l4.5 4.5" />
      </svg>
      {/*
        Named, not "Back". A student who lands on a chapter from a notification
        cannot tell where "Back" would take them, and the label is the only
        thing that says. It also stops the control reading as a browser button
        that it is not.
      */}
      <span>{label}</span>
    </Link>
  );
}
