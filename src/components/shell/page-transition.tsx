'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

/**
 * Entrance animation on every navigation.
 *
 * Keyed on the pathname, so React remounts the subtree and the CSS entrance
 * replays. That is the whole mechanism — no transition library, no exit
 * animation, and therefore no window in which the outgoing page is still on
 * screen while the incoming one is being fetched.
 *
 * Exits are deliberately absent. An exit animation delays every navigation by
 * its own duration, and on a product where a student moves between chapter,
 * practice and flashcards dozens of times an evening, that tax is paid over and
 * over for a flourish nobody asked for.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div key={pathname} className="animate-fade-up motion-reduce:animate-none">
      {children}
    </div>
  );
}
