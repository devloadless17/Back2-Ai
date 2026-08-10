'use client';

import { useCallback, useRef } from 'react';

import { useProgressToasts } from '@/components/ui/toast';
import { progressEvents, type ProgressSummary } from '@/lib/gamification';

/**
 * Turns "the server says my progress is now X" into toasts.
 *
 * The page is server-rendered with the summary as it stood on load; every study
 * API returns the summary as it stands after the write. This hook holds the
 * last one it saw and diffs, which is why the server only has to compute the
 * snapshot once per action rather than before and after.
 *
 * If the initial summary is missing — an older page, a component mounted
 * outside a study flow — nothing is announced until the second response. That
 * is the right failure: a missing baseline would otherwise diff against zero
 * and congratulate a student on every badge they have ever earned.
 */
export function useProgressFeedback(initial: ProgressSummary | null | undefined) {
  const announce = useProgressToasts();
  const previous = useRef<ProgressSummary | null>(initial ?? null);

  return useCallback(
    (next: ProgressSummary | undefined | null) => {
      if (!next) return;

      const before = previous.current;
      previous.current = next;

      if (!before) return;

      announce(progressEvents(before, next));
    },
    [announce],
  );
}
