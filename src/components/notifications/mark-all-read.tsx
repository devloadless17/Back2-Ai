'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { sendJson } from '@/lib/client/request';
import { useI18n } from '@/lib/i18n/client';

export function MarkAllReadButton() {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function markAll() {
    setBusy(true);
    try {
      await sendJson('/api/notifications', 'POST', {});
      // The sidebar badge is rendered by the layout, so the whole tree refreshes.
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button size="sm" onClick={markAll} loading={busy}>
      {t.notifications.markAllRead}
    </Button>
  );
}
