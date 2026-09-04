'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';

import { Button, LinkButton } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { Alert } from '@/components/ui/feedback';
import { useI18n } from '@/lib/i18n/client';

/**
 * Confirming an address, and asking for another link when the first one failed.
 *
 * Arriving with a token confirms immediately — the student clicked a link in
 * their mail and there is nothing further to ask them. Arriving without one, or
 * with a spent one, offers the resend form, because the two ways of getting here
 * are "my link expired" and "I never got a link" and both want the same thing.
 *
 * The confirming request fires once. React runs effects twice in development,
 * and the token is single use, so the second call would spend nothing and report
 * failure — turning a successful confirmation into an error message on the
 * screen of a student whose account is now perfectly fine.
 */
type State = 'working' | 'done' | 'invalid' | 'ask';

export function VerifyEmailForm() {
  const { t } = useI18n();
  const params = useSearchParams();
  const token = params.get('token') ?? '';

  const [state, setState] = useState<State>(token ? 'working' : 'ask');
  const [resent, setResent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) return undefined;

    // Guards the double invocation of effects in development. Without it the
    // second call spends nothing and reports an expired link.
    let spent = false;

    void (async () => {
      if (spent) return;
      spent = true;
      try {
        const response = await fetch('/api/auth/verify-email', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        setState(response.ok ? 'done' : 'invalid');
      } catch {
        setState('invalid');
      }
    })();

    return () => {
      spent = true;
    };
  }, [token]);

  async function resend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    const form = new FormData(event.currentTarget);
    try {
      await fetch('/api/auth/verify-email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: String(form.get('email') ?? '') }),
      });
    } catch {
      // Same outcome either way: the message below promises nothing about
      // whether an address exists, so a failed request must not say more.
    } finally {
      setResent(true);
      setSubmitting(false);
    }
  }

  if (state === 'working') return <Alert tone="info">{t.auth.verifyWorking}</Alert>;

  if (state === 'done') {
    return (
      <div className="space-y-4">
        <Alert tone="success">{t.auth.verifyDone}</Alert>
        <LinkButton href="/login" variant="primary" size="lg" fullWidth>
          {t.auth.signIn}
        </LinkButton>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {state === 'invalid' && <Alert tone="error">{t.auth.verifyBadToken}</Alert>}

      {resent ? (
        <Alert tone="success">{t.auth.verifyResendSent}</Alert>
      ) : (
        <form onSubmit={resend} className="space-y-4" noValidate>
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
            {t.auth.verifyResend}
          </Button>
        </form>
      )}

      <p className="text-center text-meta text-ink-muted">
        <Link href="/login" className="font-medium text-primary underline-offset-2 hover:underline">
          {t.auth.signIn}
        </Link>
      </p>
    </div>
  );
}
