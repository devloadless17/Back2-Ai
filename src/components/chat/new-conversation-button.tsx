'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { sendJson } from '@/lib/client/request';
import { useI18n } from '@/lib/i18n/client';

export function NewConversationButton({
  variant = 'primary',
  fullWidth,
}: {
  variant?: 'primary' | 'secondary';
  fullWidth?: boolean;
} = {}) {
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
    <Button variant={variant} fullWidth={fullWidth} onClick={create} loading={creating}>
      <span aria-hidden className="me-1.5 text-lg leading-none">+</span>
      {t.chat.newSession}
    </Button>
  );
}
