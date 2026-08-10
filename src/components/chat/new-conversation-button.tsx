'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { sendJson } from '@/lib/client/request';
import { useI18n } from '@/lib/i18n/client';

export function NewConversationButton() {
  const { t } = useI18n();
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  async function create() {
    setCreating(true);
    try {
      const session = await sendJson<{ id: string }>('/api/chat/sessions', 'POST', {});
      router.push(`/chat/${session.id}`);
    } catch {
      setCreating(false);
    }
  }

  return (
    <Button variant="primary" onClick={create} loading={creating}>
      {t.chat.newSession}
    </Button>
  );
}
