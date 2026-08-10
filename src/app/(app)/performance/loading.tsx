import { PageSkeleton } from '@/components/ui/page-skeleton';

/** Performance recomputes mastery across every chapter, so it is the slowest read in the app. */
export default function PerformanceLoading() {
  return <PageSkeleton rows={3} />;
}
