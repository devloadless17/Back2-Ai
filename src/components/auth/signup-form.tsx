'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { OnboardingWizard, type WizardDetails } from '@/components/auth/onboarding-wizard';
import { CardFields, EMPTY_CARD, isCardStarted, validateCard, type CardErrors, type CardFormState } from '@/components/billing/card-fields';
import { PlanPicker } from '@/components/billing/plan-picker';
import { Button } from '@/components/ui/button';

import { Alert } from '@/components/ui/feedback';
import { PAYMENTS_ENABLED, PLANS, type PlanId } from '@/lib/billing';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n/client';


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
  // Preselected rather than blank, because it is a real default rather than a
  // question we have no answer to — a student in a French-section school
  // changes it in one click.
  preferredLanguage: 'en',
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
  const { t, format } = useI18n();
  const router = useRouter();

  const [step, setStep] = useState<1 | 2>(1);
  const [details, setDetails] = useState<Details>(EMPTY_DETAILS);
  const [plan, setPlan] = useState<PlanId>('free');
  const [card, setCard] = useState<CardFormState>(EMPTY_CARD);
  const [cardErrors, setCardErrors] = useState<CardErrors>({});
  const [error, setError] = useState<string | null>(null);
  /*
   * A problem the server found with a step-one answer.
   *
   * Held here rather than inside the wizard because it is only learned at the
   * very end, on the submit that happens two screens later. It names the field
   * so the wizard can reopen on it.
   */
  const [fieldError, setFieldError] = useState<{
    field: keyof Details;
    message: string;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  /*
   * Whether this step can take money at all.
   *
   * Read once here rather than in three places below, because every branch on
   * this screen — which plans are selectable, whether a card is asked for,
   * whether "skip" is even a thing to skip — is the same question.
   */
  const paidPlansLocked = !PAYMENTS_ENABLED;

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
        setFieldError({ field: 'email', message: t.auth.emailTaken });
        setStep(1);
      } else if (payload.error === 'COUNTRY_UNAVAILABLE') {
        setFieldError({ field: 'country', message: t.auth.countryHint });
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
        <OnboardingWizard
          tracks={tracks}
          initial={details}
          submitting={submitting}
          serverError={fieldError}
          onComplete={(collected: WizardDetails) => {
            setDetails(collected);
            setFieldError(null);
            setError(null);
            setStep(2);
          }}
        />
      ) : (
        <div className="space-y-5">
          <PlanPicker
            value={plan}
            onChange={setPlan}
            disabled={submitting}
            lockPaidPlans={paidPlansLocked}
          />

          {/*
            While nothing can be charged this step is a placeholder and says so.
            No card is asked for, because asking for one at the end of signup is
            the single most expensive question a product can pose, and this one
            would be asked for a plan that does not exist yet and a charge that
            cannot be made. The billing screen still takes a card afterwards for
            anyone who wants to leave one; the front door does not.
          */}
          {paidPlansLocked ? (
            <Alert tone="info">{t.billing.planLaunchNote}</Alert>
          ) : (
            <>
              {PLANS[plan].requiresCard && (
                <>
                  <div className="space-y-1 border-t border-rule pt-5">
                    <h2 className="text-body font-medium text-ink">{t.billing.paymentMethod}</h2>
                  </div>
                  <CardFields
                    value={card}
                    onChange={setCard}
                    errors={cardErrors}
                    disabled={submitting}
                  />
                </>
              )}
            </>
          )}

          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <Button
              variant="primary"
              size="lg"
              fullWidth
              loading={submitting}
              onClick={() => createAccount(!paidPlansLocked)}
            >
              {t.billing.finishSignup}
            </Button>
            {paidPlansLocked ? null : (
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
            )}
          </div>

          <button
            type="button"
            onClick={() => setStep(1)}
            disabled={submitting}
            className="text-meta font-medium text-ink-muted underline-offset-2 hover:text-ink hover:underline disabled:opacity-50"
          >
            ← {t.auth.backToDetails}
          </button>
        </div>
      )}

      <p className="text-center text-caption text-ink-faint">
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
                'border-t-2 pt-2 text-meta font-medium transition-colors duration-150',
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
