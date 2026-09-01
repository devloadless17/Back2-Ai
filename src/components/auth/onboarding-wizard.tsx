'use client';

import { useId, useMemo, useState, type ReactNode } from 'react';

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
 * and both make them tick a box acknowledging it before Continue will move.
 *
 * The box is the part worth defending. A warning banner is read by nobody: it
 * sits above the control, in the same position as every other piece of helper
 * text in the product, and the student's eye has already learned to skip that
 * position. A checkbox that stops the button from working is the only version
 * of this warning that a student in a hurry actually meets. It costs one tap on
 * the two screens in the whole product that are genuinely one-way.
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
  /** Permanent answers get a warning before, not after — and a box to tick. */
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
      /*
       * Cards rather than the select this used to be.
       *
       * There are four sections, the choice decides the entire programme, and
       * the code alone ("SE") means nothing to a student who has not yet been
       * told what it stands for. Cards show the code and the name together and
       * put all four on screen at once, which a menu cannot. Below five options
       * that is simply the better control; the country list, at two hundred,
       * stays a select for the same reason.
       */
      <ChoiceCards
        legend={t.auth.track}
        name="track"
        columns={tracks.length > 2 ? 2 : 1}
        value={details.trackId}
        onChange={(id) => set({ trackId: id })}
        options={tracks.map((track) => ({
          value: track.id,
          label: track.code,
          note: track.name,
        }))}
      />
    ),
  },
  {
    key: 'preferredLanguage',
    title: t.auth.wizardLanguageTitle,
    encouragement: t.auth.wizardLanguageEncouragement,
    locked: true,
    validate: () => null,
    render: ({ details, set }) => (
      <ChoiceCards
        legend={t.auth.language}
        name="preferredLanguage"
        columns={LOCALES.length > 2 ? 2 : 1}
        value={details.preferredLanguage}
        onChange={(code) => set({ preferredLanguage: code })}
        options={LOCALES.map((code) => ({ value: code, label: LOCALE_LABELS[code] }))}
      />
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
  /*
   * Which permanent choices the student has acknowledged, by screen.
   *
   * Kept across a change of answer on the same screen: what was acknowledged is
   * that the choice cannot be undone, which does not stop being true when they
   * switch from GS to LS. Going back and forth should not make them tick the
   * same box again.
   */
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});

  const screens = useMemo(() => buildScreens(t, format, locale), [t, format, locale]);
  const screen = screens[index] as Screen;
  const isLast = index === screens.length - 1;
  const progress = useMemo(() => ((index + 1) / screens.length) * 100, [index, screens.length]);

  const needsConfirmation = Boolean(screen.locked);
  const acknowledged = confirmed[screen.key] === true;

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
    if (needsConfirmation && !acknowledged) {
      setError(t.auth.wizardLockRequired);
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
        <div className="mb-2 flex items-center justify-between text-caption text-ink-muted">
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
        <h2 className="text-lead font-semibold leading-snug">{screen.title}</h2>
        <p className="text-meta text-ink-muted">{screen.encouragement}</p>
      </div>

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

        {needsConfirmation ? (
          <LockConfirmation
            checked={acknowledged}
            onChange={(value) => {
              setConfirmed((current) => ({ ...current, [screen.key]: value }));
              setError(null);
            }}
            disabled={submitting}
          />
        ) : null}

        <div className="flex items-center gap-2">
          <Button
            type="submit"
            variant="primary"
            /*
             * Disabled rather than merely rejected on submit.
             *
             * A student who has not ticked the box should see that the way
             * forward is closed, not press Continue and be told off. The
             * `next()` guard stays as well — a disabled button is a hint, and
             * the rule has to hold whatever the DOM is doing.
             */
            disabled={submitting || (needsConfirmation && !acknowledged)}
          >
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

/**
 * The permanence warning, with the box that gates the way forward.
 *
 * The warning keeps the amber it has everywhere else in the product, and the
 * checkbox lives inside it rather than beneath it — a tick-box floating under a
 * banner reads as an unrelated preference, and this one is the banner's whole
 * point.
 */
function LockConfirmation({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const id = useId();

  return (
    <Alert tone="warning" title={t.auth.wizardPermanentTitle}>
      <p>{t.auth.wizardPermanentBody}</p>

      <label htmlFor={id} className="mt-3 flex cursor-pointer items-start gap-2.5 font-semibold">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-[hsl(var(--primary))]"
        />
        <span>{t.auth.wizardLockConfirm}</span>
      </label>
    </Alert>
  );
}

/**
 * A small set of mutually exclusive answers, as cards.
 *
 * Radio inputs underneath, so the keyboard behaviour, the grouping and the
 * announced role are the browser's rather than something reimplemented with
 * divs. Selection is carried by the border and the tinted ground *and* by the
 * radio itself being checked — never by the tint alone.
 */
function ChoiceCards({
  legend,
  name,
  options,
  value,
  onChange,
  columns = 2,
}: {
  legend: string;
  name: string;
  options: { value: string; label: string; note?: string }[];
  value: string;
  onChange: (value: string) => void;
  columns?: 1 | 2;
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-meta font-medium text-ink">{legend}</legend>

      <div className={cn('grid gap-2.5', columns === 2 ? 'grid-cols-2' : 'grid-cols-1')}>
        {options.map((option) => {
          const selected = value === option.value;
          return (
            <label
              key={option.value}
              className={cn(
                'flex cursor-pointer items-start gap-2.5 rounded-lg border-2 px-3.5 py-3',
                'transition-colors duration-150',
                selected
                  ? 'border-primary bg-primary-soft'
                  : 'border-rule-strong hover:bg-paper-sunken',
              )}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={selected}
                onChange={() => onChange(option.value)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-[hsl(var(--primary))]"
              />
              <span className="min-w-0">
                <span className="block text-sm font-bold text-ink">{option.label}</span>
                {option.note ? (
                  <span className="mt-0.5 block text-caption leading-snug text-ink-muted">
                    {option.note}
                  </span>
                ) : null}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
