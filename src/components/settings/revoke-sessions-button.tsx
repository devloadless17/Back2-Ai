'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { sendJson } from '@/lib/client/request';
import { useI18n } from '@/lib/i18n/client';

/**
 * Two-step, because it signs out every other device with no undo. The second
 * press is the confirmation — a modal for this would be heavier than the action
 * deserves, but a single click would not be.
 */
export function RevokeSessionsButton({ otherSessions }: { otherSessions: number }) {
  const { t, format } = useI18n();
  const router = useRouter();

  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<number | null>(null);

  if (done !== null) {
    return <Alert tone="success">{format(t.settings.sessionsRevoked, { count: done })}</Alert>;
  }

  if (otherSessions === 0) {
    return <p className="text-[12.5px] text-ink-muted">{t.settings.noOtherSessions}</p>;
  }

  async function revoke() {
    setBusy(true);
    try {
      const result = await sendJson<{ revoked: number }>('/api/settings/sessions', 'POST', {});
      setDone(result.revoked);
      router.refresh();
    } catch {
      setArmed(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant={armed ? 'mark' : 'secondary'}
        onClick={() => (armed ? void revoke() : setArmed(true))}
        loading={busy}
      >
        {armed ? t.common.confirm : t.settings.signOutOthers}
      </Button>
      {armed && (
        <button
          type="button"
          onClick={() => setArmed(false)}
          className="text-[12.5px] text-ink-muted underline-offset-2 hover:underline"
        >
          {t.common.cancel}
        </button>
      )}
    </div>
  );
}
