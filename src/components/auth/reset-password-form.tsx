'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { Alert } from '@/components/ui/feedback';
import { useI18n } from '@/lib/i18n/client';

const MIN_PASSWORD_LENGTH = 10;

/**
 * Setting a new password from an emailed link.
 *
 * The token is read from the query string and never shown. Putting it in a
 * field invites someone to select and paste it somewhere, and it is a working
 * credential for the account until it is spent.
 *
 * A missing token is treated as an expired one. The two are the same thing to
 * the person holding the link — arriving here without one means the link was
 * truncated by a mail client, which they cannot do anything about except ask
 * for another.
 *
 * The server signs the caller in as part of the reset, so this navigates
 * straight to the dashboard rather than to a login form they would have to fill
 * in with the password they set ten seconds ago.
 */
export function ResetPasswordForm() {
  const { t } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token') ?? '';

  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const form = new FormData(event.currentTarget);
    const password = String(form.get('password') ?? '');
    const confirm = String(form.get('confirm') ?? '');

    // Checked here as well as on the server, so the student is told before a
    // round trip rather than after one.
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(t.auth.passwordTooShort);
      return;
    }
    if (password !== confirm) {
      setError(t.auth.passwordMismatch);
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });

      if (response.ok) {
        setDone(true);
        // Full navigation: a session cookie was just set and every server
        // component has to re-run with it.
        router.replace('/dashboard');
        router.refresh();
        return;
      }

      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      setError(
        payload.error === 'INVALID_TOKEN'
          ? t.auth.resetBadToken
          : payload.error === 'ACCOUNT_DISABLED'
            ? t.auth.accountDisabled
            : response.status === 429
              ? t.auth.tooManyAttempts
              : t.common.unknownError,
      );
    } catch {
      setError(t.common.unknownError);
    } finally {
      setSubmitting(false);
    }
  }

  if (!token) return <Alert tone="error">{t.auth.resetBadToken}</Alert>;
  if (done) return <Alert tone="success">{t.auth.resetDone}</Alert>;

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {error && <Alert tone="error">{error}</Alert>}

      <Field label={t.auth.password} required>
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            name="password"
            type="password"
            autoComplete="new-password"
            required
            aria-invalid={invalid}
            aria-describedby={describedBy}
          />
        )}
      </Field>

      <Field label={t.auth.confirmPassword} required>
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            name="confirm"
            type="password"
            autoComplete="new-password"
            required
            aria-invalid={invalid}
            aria-describedby={describedBy}
          />
        )}
      </Field>

      <Button type="submit" variant="primary" size="lg" fullWidth loading={submitting}>
        {t.auth.resetSubmit}
      </Button>
    </form>
  );
}
