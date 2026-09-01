'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/field';
import { useI18n } from '@/lib/i18n/client';
import { sendJson } from '@/lib/client/request';

/**
 * "Report a problem".
 *
 * Present on every question and every AI explanation, and deliberately quiet —
 * it is not an action we want students taking by accident, but it must be
 * within reach the moment something looks wrong. Reporting writes to the review
 * queue and changes nothing the student sees, which is what the confirmation
 * says, so nobody uses it hoping to make a hard question disappear.
 */
export function FlagButton({
  itemType,
  itemId,
}: {
  itemType: 'generated_problem' | 'tagged_question' | 'flagged_content';
  itemId: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  if (state === 'sent') {
    return <p className="text-meta text-ink-muted">{t.chat.flagged}</p>;
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-meta text-ink-faint underline-offset-2 transition-colors hover:text-mark hover:underline"
      >
        {t.chat.flag}
      </button>
    );
  }

  async function submit() {
    if (reason.trim().length < 3) return;
    setState('sending');
    try {
      await sendJson('/api/flag', 'POST', { itemType, itemId, reason: reason.trim() });
      setState('sent');
    } catch {
      setState('error');
    }
  }

  return (
    <div className="w-full space-y-2">
      <Textarea
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder={t.admin.reviewNotes}
        rows={2}
        className="min-h-[4.5rem]"
      />
      <div className="flex items-center gap-2">
        <Button size="sm" variant="mark" onClick={submit} loading={state === 'sending'}>
          {t.common.submit}
        </Button>
        <Button size="sm" variant="quiet" onClick={() => setOpen(false)}>
          {t.common.cancel}
        </Button>
        {state === 'error' && <span className="text-meta text-mark">{t.common.unknownError}</span>}
      </div>
    </div>
  );
}
