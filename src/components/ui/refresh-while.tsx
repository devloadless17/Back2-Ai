'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Re-reads a server-rendered page while something it shows is still happening.
 *
 * The exam results page is rendered once. Marking finishes in the background a
 * few seconds later, and the student sat on "Marking…" until they reloaded by
 * hand. This refreshes the server data every few seconds while `active`, and
 * gives up after `maxMinutes` so a paper stuck in the queue does not poll all
 * night — the cron job marks it, and the next visit shows the result.
 */
export function RefreshWhile({
  active,
  everyMs = 4000,
  maxMinutes = 10,
}: {
  active: boolean;
  everyMs?: number;
  maxMinutes?: number;
}) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return undefined;
    const stopAt = Date.now() + maxMinutes * 60_000;
    const timer = window.setInterval(() => {
      if (Date.now() > stopAt) {
        window.clearInterval(timer);
        return;
      }
      router.refresh();
    }, everyMs);
    return () => window.clearInterval(timer);
  }, [active, everyMs, maxMinutes, router]);

  return null;
}
