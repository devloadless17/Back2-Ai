'use client';

import { Button } from '@/components/ui/button';

/**
 * Prints the page.
 *
 * A client component for one reason: `window.print()`. Everything else on the
 * report is server-rendered, and it stays that way — a printed document should
 * not depend on JavaScript having run.
 *
 * `print:hidden` so the button is not in the document it produces. It is easy
 * to forget and obvious once it happens.
 */
export function PrintButton({ label }: { label: string }) {
  return (
    <Button variant="secondary" size="sm" className="print:hidden" onClick={() => window.print()}>
      {label}
    </Button>
  );
}
