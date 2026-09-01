'use client';

import { Button, type ButtonProps } from '@/components/ui/button';
import { useTutorSession } from '@/components/chat/use-tutor-session';
import { useI18n } from '@/lib/i18n/client';

/**
 * Opens a tutoring conversation about one question.
 *
 * With an `attemptId` the conversation is anchored to the student's own marked
 * answer, so the tutor works from what they wrote and the marks it lost rather
 * than re-reading the official solution at them. Without one it falls back to
 * explaining the question itself.
 *
 * The session call itself lives in `useTutorSession`, shared with the dock.
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
  const { open, opening, failed } = useTutorSession();

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button
        variant={variant}
        size={size}
        loading={opening}
        onClick={() => void open({ questionId, attemptId })}
      >
        {label}
      </Button>
      {failed && <span className="text-caption text-mark">{t.common.unknownError}</span>}
    </span>
  );
}
