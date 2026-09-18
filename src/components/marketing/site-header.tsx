'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/cn';

/**
 * The public header.
 *
 * Deliberately not the application's navigation. A visitor who has not signed
 * up has no dashboard, no subjects and no plan, and showing them the shell of
 * an app they cannot enter is how a marketing page starts feeling like a
 * locked door. Four anchors, a sign-in link and one filled button.
 *
 * Sticky, but only as a hairline over the paper — no blur, no shadow, no
 * shrinking animation. It should be available rather than present.
 */

type NavItem = { href: string; label: string };

export function SiteHeader({
  brand,
  nav,
  signIn,
  start,
  menuLabel,
}: {
  brand: string;
  nav: NavItem[];
  signIn: string;
  start: string;
  menuLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  /*
   * Escape closes and focus returns to the control that opened it. A menu that
   * traps a keyboard user is worse than no menu.
   */
  useEffect(() => {
    if (!open) return undefined;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
        toggleRef.current?.focus();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <header className="sticky top-0 z-40 border-b border-rule bg-paper/95 backdrop-blur-[2px]">
      <div className="mx-auto flex w-full max-w-[1180px] items-center justify-between gap-4 px-4 py-3.5 sm:px-6 lg:px-8">
        {/*
          The wordmark is typography, not a logo. BAC2 has no mark yet, and
          inventing one on a landing page is how a product ends up with two.
          The superscript two is the one liberty taken: it reads as the second
          Baccalaureate year, which is exactly who this is for.
        */}
        <Link
          href="/"
          className="shrink-0 rounded-sm text-lead font-semibold tracking-tight text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus"
        >
          BAC<span className="text-primary">²</span>
        </Link>

        <nav aria-label={brand} className="hidden items-center gap-7 md:flex">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-sm text-meta text-ink-muted transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <Link
            href="/login"
            className="hidden rounded-sm px-1 text-meta font-medium text-ink transition-colors hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus sm:inline-flex"
          >
            {signIn}
          </Link>
          <Link
            href="/signup"
            className="inline-flex min-h-11 items-center rounded-sm bg-primary px-4 text-meta font-semibold text-on-primary transition-colors hover:bg-primary-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            {start}
          </Link>

          <button
            ref={toggleRef}
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="site-menu"
            aria-label={menuLabel}
            className="inline-flex size-11 items-center justify-center rounded-sm text-ink transition-colors hover:bg-paper-sunken focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus md:hidden"
          >
            <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              {open ? <path d="M5 5l10 10M15 5L5 15" /> : <path d="M3 6h14M3 10h14M3 14h14" />}
            </svg>
          </button>
        </div>
      </div>

      {/* One column, full-width targets, nothing clever. */}
      <div
        id="site-menu"
        ref={panelRef}
        hidden={!open}
        className={cn('border-t border-rule bg-paper-raised md:hidden')}
      >
        <nav aria-label={brand} className="mx-auto flex w-full max-w-[1180px] flex-col px-4 py-2 sm:px-6">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className="min-h-11 rounded-sm px-1 py-3 text-body text-ink transition-colors hover:bg-paper-sunken focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              {item.label}
            </Link>
          ))}
          <Link
            href="/login"
            onClick={() => setOpen(false)}
            className="min-h-11 rounded-sm border-t border-rule px-1 py-3 text-body font-medium text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            {signIn}
          </Link>
        </nav>
      </div>
    </header>
  );
}
