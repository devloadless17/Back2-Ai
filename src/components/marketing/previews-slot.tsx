'use client';

import dynamic from 'next/dynamic';

import { Skeleton } from '@/components/ui/feedback';

/**
 * The previews, loaded after the page.
 *
 * The three demonstrations are the product's real components, and the real
 * components carry the real dependencies: `ChoiceList` renders option text
 * through `MathText`, which is react-markdown and KaTeX. Bundled with the page
 * that pulled the landing route's first load to 235 kB — the same weight as the
 * exam runner, on the one screen in the product that is opened by someone who
 * has not yet decided to use it, frequently on a phone on a Lebanese mobile
 * connection.
 *
 * So the previews arrive in a second chunk. The headline, the claim and the
 * sign-up button paint immediately; the demonstrations fill in a moment later
 * under a placeholder of the right height, so nothing below them jumps.
 *
 * `ssr: false` is the deliberate half. These are interactive toys with no
 * content worth having in the HTML — the page is `noindex` in any case — and
 * rendering them server-side would only pay for markup that is replaced the
 * instant the chunk lands.
 */
const LivePreviews = dynamic(
  () => import('@/components/marketing/live-previews').then((m) => m.LivePreviews),
  {
    ssr: false,
    loading: () => (
      <div className="grid gap-4 md:grid-cols-3">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    ),
  },
);

export function PreviewsSlot() {
  return <LivePreviews />;
}
