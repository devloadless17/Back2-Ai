'use client';

import { useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { Alert } from '@/components/ui/feedback';
import { useI18n } from '@/lib/i18n/client';

/**
 * Asking for a reset link.
 *
 * The confirmation is shown for every address, known or not, because the server
 * answers identically for both — anything else here would leak through the
 * interface what the API is careful not to say, and the people with accounts
 * here are school students with their exam results attached.
 *
 * The form is replaced by the confirmation rather than left below it. Leaving
 * it invites a second submit, which the rate limit will refuse, and being told
 * off for following the form is a poor way to learn the mail is already sent.
 */
export function ForgotPasswordForm() {
  const { t } = useI18n();
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: String(form.get('email') ?? '') }),
      });

      if (response.ok) {
        setSent(true);
        return;
      }
      setError(response.status === 429 ? t.auth.tooManyAttempts : t.common.unknownError);
    } catch {
      setError(t.common.unknownError);
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) return <Alert tone="success">{t.auth.forgotSent}</Alert>;

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

      <Button type="submit" variant="primary" size="lg" fullWidth loading={submitting}>
        {t.auth.forgotSubmit}
      </Button>
    </form>
  );
}
