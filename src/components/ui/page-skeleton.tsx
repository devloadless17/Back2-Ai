import { Skeleton } from '@/components/ui/feedback';
import { Sheet, SheetBody } from '@/components/ui/sheet';

/**
 * Loading placeholder for data-heavy pages.
 *
 * Without a `loading.tsx`, navigation blocks on the server component and the
 * old page just sits there — the student taps and nothing happens, which reads
 * as a broken link rather than as work in progress. This is the shape of what
 * is coming, not a spinner: matching the eventual layout stops the page from
 * jumping when the real content lands.
 *
 * Deliberately static markup, no animation beyond the shared slow pulse. A
 * loading state that draws attention to itself is worse than the wait.
 */
export function PageSkeleton({ rows = 3, withHeader = true }: { rows?: number; withHeader?: boolean }) {
  return (
    <div aria-busy="true" aria-live="polite">
      {withHeader && (
        <div className="mb-6 space-y-2">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-80" />
        </div>
      )}

      <div className="space-y-5">
        {Array.from({ length: rows }, (_, index) => (
          <Sheet key={index}>
            <div className="border-b border-rule px-5 py-4">
              <Skeleton className="h-4 w-40" />
            </div>
            <SheetBody className="space-y-3">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-5/6" />
              <Skeleton className="h-3 w-2/3" />
            </SheetBody>
          </Sheet>
        ))}
      </div>
    </div>
  );
}
