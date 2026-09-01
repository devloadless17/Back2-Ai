import { PageSkeleton } from '@/components/ui/page-skeleton';

/**
 * Flat list — 3 blocks while the server query runs.
 *
 * The shape matters: a skeleton that resembles the page it precedes reads as the
 * content arriving, where a spinner reads as waiting. That is the whole of the
 * ~30% perceived-speed difference between them, and it costs one file.
 */
export default function Loading() {
  return <PageSkeleton rows={3} />;
}
