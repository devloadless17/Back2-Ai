'use client';

import { useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { Alert } from '@/components/ui/feedback';
import { ApiRequestError, sendJson } from '@/lib/client/request';
import { useI18n } from '@/lib/i18n/client';

export function PasswordForm() {
  const { t } = useI18n();
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const form = new FormData(event.currentTarget);
    const next = String(form.get('newPassword') ?? '');
    const confirm = String(form.get('confirmPassword') ?? '');

    if (next !== confirm) {
      setError(t.auth.passwordMismatch);
      return;
    }
    if (next.length < 10) {
      setError(t.auth.passwordTooShort);
      return;
    }

    setState('saving');

    try {
      await sendJson('/api/settings/password', 'POST', {
        currentPassword: String(form.get('currentPassword') ?? ''),
        newPassword: next,
      });
      setState('saved');
      event.currentTarget.reset();
    } catch (err) {
      setState('idle');
      setError(
        err instanceof ApiRequestError && err.code === 'INVALID_CREDENTIALS'
          ? t.auth.invalidCredentials
          : t.common.unknownError,
      );
    }
  }

  if (state === 'saved') {
    return <Alert tone="success">{t.settings.passwordChanged}</Alert>;
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {error && <Alert tone="error">{error}</Alert>}

      <Field label={t.settings.currentPassword} required>
        {({ id }) => (
          <Input id={id} name="currentPassword" type="password" autoComplete="current-password" required />
        )}
      </Field>

      <Field label={t.settings.newPassword} hint={t.auth.passwordTooShort} required>
        {({ id }) => (
          <Input id={id} name="newPassword" type="password" autoComplete="new-password" required />
        )}
      </Field>

      <Field label={t.auth.confirmPassword} required>
        {({ id }) => (
          <Input id={id} name="confirmPassword" type="password" autoComplete="new-password" required />
        )}
      </Field>

      <Button type="submit" variant="primary" loading={state === 'saving'}>
        {t.common.save}
      </Button>
    </form>
  );
}
