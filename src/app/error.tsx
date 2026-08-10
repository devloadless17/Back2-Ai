'use client';

import { useEffect } from 'react';

import { Button, LinkButton } from '@/components/ui/button';
import { Sheet, SheetBody } from '@/components/ui/sheet';
import { useI18n } from '@/lib/i18n/client';

/**
 * Route-level error boundary.
 *
 * Without this, an unhandled render error in any server component shows the
 * Next.js default page — which in production is a bare "Application error"
 * with no way back, and in development is a stack trace. Neither is acceptable
 * for a student mid-revision.
 *
 * `digest` is the only thing surfaced: it is the server-side correlation id for
 * the logged stack, so a support request can be tied to an actual log line
 * without exposing internals to the browser.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useI18n();

  useEffect(() => {
    console.error('[boundary] unhandled error', error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <Sheet className="w-full max-w-md">
        <SheetBody className="space-y-4 p-6 text-center">
          <div className="space-y-1">
            <h1 className="text-xl">{t.errors.serverError}</h1>
            <p className="text-sm leading-relaxed text-ink-muted">{t.errors.serverErrorBody}</p>
          </div>

          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="primary" onClick={reset}>
              {t.common.retry}
            </Button>
            <LinkButton href="/dashboard">{t.errors.goHome}</LinkButton>
          </div>

          {error.digest && (
            <p className="font-mono text-[11px] text-ink-faint">{error.digest}</p>
          )}
        </SheetBody>
      </Sheet>
    </div>
  );
}
