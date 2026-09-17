import { permanentRedirect } from 'next/navigation';

import { performanceRedirectTarget } from '@/lib/performance-redirect';

/**
 * `/performance` is gone. Progress is canonical.
 *
 * The two pages were never duplicates — they were two halves of one story,
 * split at the subject/chapter boundary. Progress stopped exactly where
 * Performance started, so a student who read "Mathematics 14.8" had to find a
 * second page to learn which chapter was dragging it.
 *
 * This stays for bookmarks and anything already linked from outside. Every
 * link inside the application points at `/progress` directly: routing users
 * through a redirect forever costs a round trip on a phone connection to
 * arrive somewhere we already knew.
 *
 * `permanentRedirect` is a 308, which keeps any method and tells crawlers the
 * move is settled — it is.
 */
export default async function PerformancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  permanentRedirect(performanceRedirectTarget(await searchParams));
}
