'use client';

import { useMemo, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { Alert } from '@/components/ui/feedback';
import { cn } from '@/lib/cn';
import { countryOptions } from '@/lib/countries';
import { useI18n } from '@/lib/i18n/client';
import { LOCALE_LABELS, LOCALES } from '@/lib/i18n/config';

/**
 * Onboarding, one question per screen.
 *
 * A single long form asks a student to make six decisions before they see
 * anything; one question at a time asks for one. The cost is more clicks, which
 * is the right trade at signup — the failure mode of a wall of fields is
 * abandonment, and the failure mode of six screens is mild impatience.
 *
 * The encouragement is written, not generated. Three locales of pre-written
 * copy is cheaper, more consistent, and never produces the slightly-wrong
 * cheerfulness that makes a product feel automated. It is also the only thing
 * on this screen that would otherwise need a model call.
 *
 * Two answers here are permanent. Section and language are locked once the
 * account exists, because changing either invalidates every mastery number
 * computed against them — so both screens say so before the student commits,
 * rather than after.
 */

export type WizardTrack = { id: string; code: string; name: string };

export type WizardDetails = {
  displayName: string;
  email: string;
  password: string;
  confirmPassword: string;
  country: string;
  trackId: string;
  preferredLanguage: string;
};

type Screen = {
  key: keyof WizardDetails | 'password';
  title: string;
  encouragement: string;
  /** Permanent answers get a warning before, not after. */
  locked?: boolean;
  render: (ctx: {
    details: WizardDetails;
    set: (patch: Partial<WizardDetails>) => void;
    tracks: WizardTrack[];
  }) => ReactNode;
  validate: (details: WizardDetails) => string | null;
};

const MIN_PASSWORD_LENGTH = 10;

type Dict = ReturnType<typeof useI18n>['t'];
type Fmt = ReturnType<typeof useI18n>['format'];

function buildScreens(t: Dict, format: Fmt, locale: string): Screen[] {
  return [
  {
    key: 'displayName',
    title: t.auth.wizardNameTitle,
    encouragement: t.auth.wizardNameEncouragement,
    validate: (d) => (d.displayName.trim().length > 0 ? null : t.auth.wizardNameRequired),
    render: ({ details, set }) => (
      <Field label={t.auth.displayName} required>
        {({ id, describedBy }) => (
          <Input
            id={id}
            autoFocus
            autoComplete="name"
            maxLength={120}
            value={details.displayName}
            onChange={(e) => set({ displayName: e.target.value })}
            aria-describedby={describedBy}
          />
        )}
      </Field>
    ),
  },
  {
    key: 'email',
    title: t.auth.wizardEmailTitle,
    encouragement: t.auth.wizardEmailEncouragement,
    validate: (d) =>
      /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email) ? null : t.auth.wizardEmailInvalid,
    render: ({ details, set }) => (
      <Field label={t.auth.email} required>
        {({ id, describedBy }) => (
          <Input
            id={id}
            autoFocus
            type="email"
            autoComplete="email"
            value={details.email}
            onChange={(e) => set({ email: e.target.value })}
            aria-describedby={describedBy}
          />
        )}
      </Field>
    ),
  },
  {
    key: 'password',
    title: t.auth.wizardPasswordTitle,
    encouragement: format(t.auth.wizardPasswordEncouragement, { min: MIN_PASSWORD_LENGTH }),
    validate: (d) => {
      if (d.password.length < MIN_PASSWORD_LENGTH) return t.auth.passwordTooShort;
      if (d.password !== d.confirmPassword) return t.auth.passwordMismatch;
      return null;
    },
    render: ({ details, set }) => (
      <div className="space-y-4">
        <Field label={t.auth.password} required>
          {({ id, describedBy }) => (
            <Input
              id={id}
              autoFocus
              type="password"
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              value={details.password}
              onChange={(e) => set({ password: e.target.value })}
              aria-describedby={describedBy}
            />
          )}
        </Field>
        <Field label={t.auth.confirmPassword} required>
          {({ id, describedBy }) => (
            <Input
              id={id}
              type="password"
              autoComplete="new-password"
              value={details.confirmPassword}
              onChange={(e) => set({ confirmPassword: e.target.value })}
              aria-describedby={describedBy}
            />
          )}
        </Field>
      </div>
    ),
  },
  {
    key: 'trackId',
    title: t.auth.wizardTrackTitle,
    encouragement: t.auth.wizardTrackEncouragement,
    locked: true,
    validate: (d) => (d.trackId ? null : t.auth.wizardTrackRequired),
    render: ({ details, set, tracks }) => (
      <Field label={t.auth.track} required>
        {({ id, describedBy }) => (
          <Select
            id={id}
            autoFocus
            value={details.trackId}
            onChange={(e) => set({ trackId: e.target.value })}
            aria-describedby={describedBy}
          >
            <option value="">{t.auth.selectTrack}</option>
            {tracks.map((track) => (
              <option key={track.id} value={track.id}>
                {track.name} ({track.code})
              </option>
            ))}
          </Select>
        )}
      </Field>
    ),
  },
  {
    key: 'preferredLanguage',
    title: t.auth.wizardLanguageTitle,
    encouragement: t.auth.wizardLanguageEncouragement,
    locked: true,
    validate: () => null,
    render: ({ details, set }) => (
      <Field label={t.auth.language} required>
        {({ id, describedBy }) => (
          <Select
            id={id}
            autoFocus
            value={details.preferredLanguage}
            onChange={(e) => set({ preferredLanguage: e.target.value })}
            aria-describedby={describedBy}
          >
            {LOCALES.map((code) => (
              <option key={code} value={code}>
                {LOCALE_LABELS[code]}
              </option>
            ))}
          </Select>
        )}
      </Field>
    ),
  },
  {
    key: 'country',
    title: t.auth.wizardCountryTitle,
    encouragement: t.auth.wizardCountryEncouragement,
    validate: (d) => (d.country ? null : t.auth.wizardCountryRequired),
    render: ({ details, set }) => (
      <Field label={t.auth.country} hint={t.auth.countryHint} required>
        {({ id, describedBy }) => (
          <Select
            id={id}
            autoFocus
            value={details.country}
            onChange={(e) => set({ country: e.target.value })}
            aria-describedby={describedBy}
          >
            {countryOptions(locale).map((country) => (
              <option key={country.code} value={country.code} disabled={!country.available}>
                {country.name}
                {country.available ? '' : ` — ${t.auth.countryComingSoon}`}
              </option>
            ))}
          </Select>
        )}
      </Field>
    ),
  },
  ];
}

export function OnboardingWizard({
  tracks,
  initial,
  onComplete,
  submitting,
}: {
  tracks: WizardTrack[];
  initial: WizardDetails;
  onComplete: (details: WizardDetails) => void;
  submitting?: boolean;
}) {
  const { t, format, locale } = useI18n();

  const [details, setDetails] = useState<WizardDetails>(initial);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const screens = useMemo(() => buildScreens(t, format, locale), [t, format, locale]);
  const screen = screens[index] as Screen;
  const isLast = index === screens.length - 1;
  const progress = useMemo(() => ((index + 1) / screens.length) * 100, [index, screens.length]);

  function set(patch: Partial<WizardDetails>) {
    setDetails((current) => ({ ...current, ...patch }));
    setError(null);
  }

  function next() {
    const problem = screen.validate(details);
    if (problem) {
      setError(problem);
      return;
    }
    if (isLast) {
      onComplete(details);
      return;
    }
    setIndex((i) => i + 1);
    setError(null);
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="mb-2 flex items-center justify-between text-[12px] text-ink-muted">
          <span>{format(t.auth.stepOf, { current: index + 1, total: screens.length })}</span>
          {/* Progress is stated in words as well as drawn, so the bar is never
              the only thing carrying it. */}
          <span>{format(t.auth.wizardPercentDone, { percent: Math.round(progress) })}</span>
        </div>
        <div className="h-1 w-full overflow-hidden rounded-full bg-paper-sunken">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-300"
            style={{ width: `${progress}%` }}
            role="progressbar"
            aria-valuenow={index + 1}
            aria-valuemin={1}
            aria-valuemax={screens.length}
            aria-label={t.auth.wizardProgressLabel}
          />
        </div>
      </div>

      <div className="space-y-1">
        <h2 className="text-[17px] font-semibold leading-snug">{screen.title}</h2>
        <p className="text-[13px] text-ink-muted">{screen.encouragement}</p>
      </div>

      {screen.locked ? (
        <Alert tone="warning" title={t.auth.wizardPermanentTitle}>
          {t.auth.wizardPermanentBody}
        </Alert>
      ) : null}

      {error ? <Alert tone="error">{error}</Alert> : null}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          next();
        }}
        className="space-y-5"
        noValidate
      >
        {screen.render({ details, set, tracks })}

        <div className="flex items-center gap-2">
          <Button type="submit" variant="primary" disabled={submitting}>
            {isLast ? t.auth.createAccount : t.auth.continueToPayment}
          </Button>
          {index > 0 ? (
            <Button
              type="button"
              variant="quiet"
              onClick={() => {
                setIndex((i) => i - 1);
                setError(null);
              }}
              disabled={submitting}
            >
              {t.auth.backToDetails}
            </Button>
          ) : null}
        </div>
      </form>

      <ol className="flex gap-1.5" aria-hidden="true">
        {screens.map((entry, i) => (
          <li
            key={entry.key}
            className={cn(
              'h-1.5 flex-1 rounded-full transition-colors',
              i <= index ? 'bg-primary' : 'bg-paper-sunken',
            )}
          />
        ))}
      </ol>
    </div>
  );
}
