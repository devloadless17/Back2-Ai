'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { Alert } from '@/components/ui/feedback';
import { useI18n } from '@/lib/i18n/client';

/**
 * Sign-in form.
 *
 * The server returns a stable error code rather than a sentence, and the code
 * is translated here — so the message a student reads is always in their
 * language, and the API never leaks which of email or password was wrong.
 */
export function LoginForm() {
  const { t } = useI18n();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: String(form.get('email') ?? ''),
          password: String(form.get('password') ?? ''),
        }),
      });

      if (response.ok) {
        // Full navigation rather than a client push: the session cookie was
        // just set, and every server component needs to re-run with it.
        router.replace('/dashboard');
        router.refresh();
        return;
      }

      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      setError(messageFor(payload.error, response.status, t));
    } catch {
      setError(t.common.unknownError);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {error && <Alert tone="error">{error}</Alert>}

      <Field label={t.auth.email} required>
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            name="email"
            type="email"
            autoComplete="email"
            required
            aria-invalid={invalid}
            aria-describedby={describedBy}
          />
        )}
      </Field>

      <Field label={t.auth.password} required>
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            name="password"
            type="password"
            autoComplete="current-password"
            required
            aria-invalid={invalid}
            aria-describedby={describedBy}
          />
        )}
      </Field>

      <Button type="submit" variant="primary" size="lg" fullWidth loading={submitting}>
        {t.auth.signIn}
      </Button>
    </form>
  );
}

type Dictionary = ReturnType<typeof useI18n>['t'];

function messageFor(code: string | undefined, status: number, t: Dictionary): string {
  switch (code) {
    case 'INVALID_CREDENTIALS':
      return t.auth.invalidCredentials;
    case 'ACCOUNT_DISABLED':
      return t.auth.accountDisabled;
    default:
      return status === 429 ? t.auth.tooManyAttempts : t.common.unknownError;
  }
}
