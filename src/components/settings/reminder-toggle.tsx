'use client';

import { useState } from 'react';

import { Alert } from '@/components/ui/feedback';
import { useI18n } from '@/lib/i18n/client';

/**
 * The switch that stops the nightly email.
 *
 * Saved on change, without a Save button. This is one boolean about the
 * student's own inbox — asking them to confirm it is asking twice for a thing
 * they already said, and a preference page with an unsaved state is how people
 * end up believing they turned something off when they did not.
 *
 * The switch moves first and reverts if the request fails. A toggle that waits
 * for a round trip feels broken on a phone, and the failure is both rare and
 * harmless: the worst case is one more email while they try again.
 */
export function ReminderToggle({ initial }: { initial: boolean }) {
  const { t } = useI18n();
  const [on, setOn] = useState(initial);
  const [failed, setFailed] = useState(false);

  async function change(next: boolean) {
    const previous = on;
    setOn(next);
    setFailed(false);

    try {
      const response = await fetch('/api/settings/reminders', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ emailReminders: next }),
      });
      if (!response.ok) throw new Error('save failed');
    } catch {
      // Put it back. Showing it off while it is still on would be a lie about
      // what the product is going to do tonight.
      setOn(previous);
      setFailed(true);
    }
  }

  return (
    <div className="space-y-2">
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={on}
          onChange={(event) => void change(event.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-rule-strong text-primary"
        />
        <span className="min-w-0">
          <span className="block text-sm font-medium text-ink">{t.settings.emailReminders}</span>
          <span className="block text-caption text-ink-muted">
            {t.settings.emailRemindersHint}
          </span>
        </span>
      </label>

      {failed && <Alert tone="error">{t.common.unknownError}</Alert>}
    </div>
  );
}
