'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { CardFields, EMPTY_CARD, isCardStarted, validateCard, type CardErrors, type CardFormState } from '@/components/billing/card-fields';
import { PlanPicker } from '@/components/billing/plan-picker';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { Alert } from '@/components/ui/feedback';
import { PAYMENTS_ENABLED, PLANS, type PlanId } from '@/lib/billing';
import { countryOptions } from '@/lib/countries';
import { cn } from '@/lib/cn';
import { LOCALE_LABELS, LOCALES } from '@/lib/i18n/config';
import { useI18n } from '@/lib/i18n/client';

const MIN_PASSWORD_LENGTH = 10;

export type SignupTrack = { id: string; code: string; name: string };

type Details = {
  displayName: string;
  email: string;
  password: string;
  confirmPassword: string;
  country: string;
  trackId: string;
  preferredLanguage: string;
};

const EMPTY_DETAILS: Details = {
  displayName: '',
  email: '',
  password: '',
  confirmPassword: '',
  country: 'LB',
  trackId: '',
  preferredLanguage: '',
};

/**
 * Account creation, in two steps: who you are, then how you would pay.
 *
 * Two steps rather than one long form because they fail differently. The first
 * step is required and is checked as you go; the second can be skipped entirely
 * and, while no processor is connected, changes nothing about what the student
 * can use. Mixing them would make an optional card look like a wall in front of
 * the product.
 *
 * The account is created once, on the final submit, so an abandoned payment step
 * leaves nothing behind.
 */
export function SignupForm({ tracks }: { tracks: SignupTrack[] }) {
  const { t, locale, format } = useI18n();
  const router = useRouter();

  const [step, setStep] = useState<1 | 2>(1);
  const [details, setDetails] = useState<Details>(EMPTY_DETAILS);
  const [plan, setPlan] = useState<PlanId>('free');
  const [card, setCard] = useState<CardFormState>(EMPTY_CARD);
  const [cardErrors, setCardErrors] = useState<CardErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const countries = countryOptions(locale);

  function setDetail(patch: Partial<Details>) {
    setDetails((current) => ({ ...current, ...patch }));
  }

  /**
   * Step one's checks are for speed of feedback only; `/api/auth/signup`
   * validates all of it again and is the decision that counts.
   */
  function detailsAreValid(): boolean {
    const errors: Record<string, string> = {};

    if (details.password.length < MIN_PASSWORD_LENGTH) errors.password = t.auth.passwordTooShort;
    if (details.password !== details.confirmPassword) errors.confirmPassword = t.auth.passwordMismatch;

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  function onDetailsSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!detailsAreValid()) return;
    setStep(2);
  }

  /**
   * Creates the account.
   *
   * `withCard` is false for "skip for now", which posts the same body minus the
   * card and drops the plan back to free — being asked for money and declining
   * should not leave a paid plan sitting on the account.
   */
  async function createAccount(withCard: boolean) {
    setError(null);
    setCardErrors({});

    let cardPayload: ReturnType<typeof validateCard>['summary'] = null;

    if (withCard && PLANS[plan].requiresCard) {
      const validation = validateCard(card, {
        cardInvalid: t.billing.cardInvalid,
        cardholderRequired: t.billing.cardholderRequired,
        expiryInvalid: t.billing.expiryInvalid,
        securityCodeInvalid: t.billing.securityCodeInvalid,
      });

      if (!validation.summary) {
        setCardErrors(validation.errors);
        return;
      }
      cardPayload = validation.summary;
    }

    setSubmitting(true);

    try {
      const response = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: details.email,
          password: details.password,
          displayName: details.displayName,
          trackId: details.trackId,
          preferredLanguage: details.preferredLanguage,
          country: details.country,
          plan: cardPayload ? plan : 'free',
          ...(cardPayload ? { card: cardPayload } : {}),
        }),
      });

      if (response.ok) {
        router.replace('/dashboard');
        router.refresh();
        return;
      }

      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (payload.error === 'EMAIL_TAKEN') {
        // The offending field is back on step one, so go back to it rather than
        // showing an error next to a control the student cannot correct here.
        setFieldErrors({ email: t.auth.emailTaken });
        setStep(1);
      } else if (payload.error === 'COUNTRY_UNAVAILABLE') {
        setFieldErrors({ country: t.auth.countryHint });
        setStep(1);
      } else if (response.status === 429) {
        setError(t.auth.tooManyAttempts);
      } else {
        setError(t.common.unknownError);
      }
    } catch {
      setError(t.common.unknownError);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-5">
      <StepIndicator step={step} />

      {error && <Alert tone="error">{error}</Alert>}

      {step === 1 ? (
        <form onSubmit={onDetailsSubmit} className="space-y-4" noValidate>
          <Field label={t.auth.displayName} required>
            {({ id, describedBy }) => (
              <Input
                id={id}
                name="displayName"
                autoComplete="name"
                required
                maxLength={120}
                value={details.displayName}
                onChange={(event) => setDetail({ displayName: event.target.value })}
                aria-describedby={describedBy}
              />
            )}
          </Field>

          <Field label={t.auth.email} required error={fieldErrors.email ?? null}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                name="email"
                type="email"
                autoComplete="email"
                required
                value={details.email}
                onChange={(event) => setDetail({ email: event.target.value })}
                aria-invalid={invalid}
                aria-describedby={describedBy}
              />
            )}
          </Field>

          <Field
            label={t.auth.password}
            hint={t.auth.passwordTooShort}
            required
            error={fieldErrors.password ?? null}
          >
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                name="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={MIN_PASSWORD_LENGTH}
                value={details.password}
                onChange={(event) => setDetail({ password: event.target.value })}
                aria-invalid={invalid}
                aria-describedby={describedBy}
              />
            )}
          </Field>

          <Field label={t.auth.confirmPassword} required error={fieldErrors.confirmPassword ?? null}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                required
                value={details.confirmPassword}
                onChange={(event) => setDetail({ confirmPassword: event.target.value })}
                aria-invalid={invalid}
                aria-describedby={describedBy}
              />
            )}
          </Field>

          <Field
            label={t.auth.country}
            hint={t.auth.countryHint}
            required
            error={fieldErrors.country ?? null}
          >
            {({ id, describedBy, invalid }) => (
              <Select
                id={id}
                name="country"
                required
                value={details.country}
                onChange={(event) => setDetail({ country: event.target.value })}
                aria-invalid={invalid}
                aria-describedby={describedBy}
              >
                {countries.map((country) => (
                  <option key={country.code} value={country.code} disabled={!country.available}>
                    {country.available
                      ? country.name
                      : `${country.name} — ${t.auth.countryComingSoon}`}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t.auth.track} hint={t.auth.trackHint} required>
              {({ id, describedBy }) => (
                <Select
                  id={id}
                  name="trackId"
                  required
                  value={details.trackId}
                  onChange={(event) => setDetail({ trackId: event.target.value })}
                  aria-describedby={describedBy}
                >
                  <option value="" disabled>
                    {t.auth.selectTrack}
                  </option>
                  {tracks.map((track) => (
                    <option key={track.id} value={track.id}>
                      {track.code} — {track.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field label={t.auth.language} hint={t.auth.languageHint} required>
              {({ id, describedBy }) => (
                <Select
                  id={id}
                  name="preferredLanguage"
                  required
                  value={details.preferredLanguage}
                  onChange={(event) => setDetail({ preferredLanguage: event.target.value })}
                  aria-describedby={describedBy}
                >
                  <option value="" disabled>
                    {t.auth.selectLanguage}
                  </option>
                  {LOCALES.map((item) => (
                    <option key={item} value={item}>
                      {LOCALE_LABELS[item]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>

          <Alert tone="warning">{t.auth.lockNotice}</Alert>

          <Button type="submit" variant="primary" size="lg" fullWidth>
            {t.auth.continueToPayment}
          </Button>
        </form>
      ) : (
        <div className="space-y-5">
          <PlanPicker value={plan} onChange={setPlan} disabled={submitting} />

          {PLANS[plan].requiresCard && (
            <>
              <div className="space-y-1 border-t border-rule pt-5">
                <h2 className="text-[15px] font-medium text-ink">{t.billing.paymentMethod}</h2>
              </div>
              <CardFields value={card} onChange={setCard} errors={cardErrors} disabled={submitting} />
            </>
          )}

          {!PAYMENTS_ENABLED && (
            <Alert tone="info" title={t.billing.notConnected}>
              {t.billing.notConnectedBody}
            </Alert>
          )}

          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <Button
              variant="primary"
              size="lg"
              fullWidth
              loading={submitting}
              onClick={() => createAccount(true)}
            >
              {t.billing.finishSignup}
            </Button>
            <Button
              size="lg"
              fullWidth
              disabled={submitting}
              onClick={() => createAccount(false)}
              // Skipping is a real choice here, so it stays a visible button
              // rather than a link buried under the primary action.
              className={cn(isCardStarted(card) && 'sm:flex-1')}
            >
              {t.billing.skipForNow}
            </Button>
          </div>

          <button
            type="button"
            onClick={() => setStep(1)}
            disabled={submitting}
            className="text-[13px] font-medium text-ink-muted underline-offset-2 hover:text-ink hover:underline disabled:opacity-50"
          >
            ← {t.auth.backToDetails}
          </button>
        </div>
      )}

      <p className="text-center text-[12px] text-ink-faint">
        {format(t.auth.stepOf, { current: step, total: 2 })}
      </p>
    </div>
  );
}

function StepIndicator({ step }: { step: 1 | 2 }) {
  const { t } = useI18n();
  const labels = [t.auth.stepAccount, t.auth.stepPayment];

  return (
    <ol className="flex gap-2" aria-label={t.auth.signupTitle}>
      {labels.map((label, index) => {
        const position = index + 1;
        const state = position === step ? 'current' : position < step ? 'done' : 'upcoming';
        return (
          <li key={label} className="flex-1">
            <div
              aria-current={state === 'current' ? 'step' : undefined}
              className={cn(
                'border-t-2 pt-2 text-[12.5px] font-medium transition-colors duration-150',
                state === 'upcoming' ? 'border-rule text-ink-faint' : 'border-primary text-primary',
              )}
            >
              {label}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
