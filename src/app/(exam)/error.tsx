'use client';

import { useEffect } from 'react';

import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { Sheet, SheetBody } from '@/components/ui/sheet';
import { useI18n } from '@/lib/i18n/client';

/**
 * Error boundary for a paper in progress.
 *
 * Separate from the app-wide one for a reason: the generic boundary offers
 * "back to dashboard", and a student whose clock is running must not be nudged
 * to navigate away. The clock is server-side and keeps running regardless, so
 * the only useful action here is to get back into the paper.
 *
 * It also says so explicitly. A student who hits an error mid-exam needs to be
 * told their answers were saved and their time is still going, not left to
 * guess.
 */
export default function ExamError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useI18n();

  useEffect(() => {
    console.error('[exam-boundary] error during a sitting', error);
  }, [error]);

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4">
      <Sheet className="w-full max-w-lg">
        <SheetBody className="space-y-4 p-6">
          <div className="space-y-1 text-center">
            <h1 className="text-xl">{t.errors.serverError}</h1>
            <p className="text-sm leading-relaxed text-ink-muted">{t.errors.serverErrorBody}</p>
          </div>

          {/* The two facts that actually matter to someone mid-paper. */}
          <Alert tone="warning">{t.examSim.beginWarning}</Alert>

          <div className="flex justify-center">
            <Button variant="primary" size="lg" onClick={reset}>
              {t.examSim.resume}
            </Button>
          </div>

          {error.digest && (
            <p className="text-center font-mono text-[11px] text-ink-faint">{error.digest}</p>
          )}
        </SheetBody>
      </Sheet>
    </div>
  );
}
