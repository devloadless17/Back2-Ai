'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button, type ButtonProps } from '@/components/ui/button';
import { sendJson } from '@/lib/client/request';
import { useI18n } from '@/lib/i18n/client';

/**
 * Opens a tutoring conversation about one question.
 *
 * With an `attemptId` the conversation is anchored to the student's own marked
 * answer, so the tutor works from what they wrote and the marks it lost rather
 * than re-reading the official solution at them. Without one it falls back to
 * explaining the question itself.
 */
export function TutorButton({
  questionId,
  attemptId,
  label,
  variant = 'secondary',
  size = 'md',
}: {
  questionId?: string;
  attemptId?: string;
  label: string;
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [opening, setOpening] = useState(false);
  const [failed, setFailed] = useState(false);

  async function open() {
    setOpening(true);
    setFailed(false);
    try {
      const session = await sendJson<{ id: string }>('/api/chat/sessions', 'POST', {
        ...(attemptId ? { attemptId } : {}),
        ...(questionId ? { questionId } : {}),
      });
      router.push(`/chat/${session.id}`);
    } catch {
      setFailed(true);
      setOpening(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button variant={variant} size={size} loading={opening} onClick={open}>
        {label}
      </Button>
      {failed && <span className="text-[12px] text-mark">{t.common.unknownError}</span>}
    </span>
  );
}
