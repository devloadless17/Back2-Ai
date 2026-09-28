'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { sendJson } from '@/lib/client/request';
import { useI18n } from '@/lib/i18n/client';

export function AiPaperDecision({ id, complete }: { id: string; complete: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  async function decide(decision: 'approve' | 'reject') {
    setBusy(true); setError(false);
    try { await sendJson('/api/admin/ai-exams', 'POST', { id, decision }); router.refresh(); }
    catch { setError(true); }
    finally { setBusy(false); }
  }
  return <div className="space-y-3">
    {error && <Alert tone="error">{t.common.unknownError}</Alert>}
    <p className="text-meta">{t.admin.publishNotice}</p>
    <div className="flex gap-3">
      <Button onClick={() => void decide('approve')} disabled={!complete || busy}>{t.admin.approve}</Button>
      <Button variant="mark" onClick={() => void decide('reject')} disabled={busy}>{t.admin.reject}</Button>
    </div>
  </div>;
}
