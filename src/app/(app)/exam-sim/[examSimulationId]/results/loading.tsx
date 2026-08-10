import { PageSkeleton } from '@/components/ui/page-skeleton';

/**
 * Results are reached straight after submitting, which is the one moment in the
 * product where a blank pause is genuinely alarming — the student has just
 * handed in a paper and is waiting to find out how it went.
 */
export default function ExamResultsLoading() {
  return <PageSkeleton rows={4} />;
}
