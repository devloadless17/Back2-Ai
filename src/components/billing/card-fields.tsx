'use client';

import { Field, Input, Select } from '@/components/ui/field';
import {
  cardSummary,
  detectCardBrand,
  digitsOnly,
  expiryValid,
  formatCardNumber,
  luhnValid,
  securityCodeValid,
  type CardSummary,
} from '@/lib/billing';
import { useI18n } from '@/lib/i18n/client';

/**
 * Card entry.
 *
 * The number and the security code live in this component's props and are never
 * put in a payload: `validateCard` returns a `CardSummary`, which is brand, last
 * four and expiry. That is the whole reason the validation helper returns a
 * summary rather than the state it was given — it makes sending the full number
 * something you would have to go out of your way to do.
 */

export type CardFormState = {
  number: string;
  name: string;
  expMonth: string;
  expYear: string;
  securityCode: string;
};

export const EMPTY_CARD: CardFormState = {
  number: '',
  name: '',
  expMonth: '',
  expYear: '',
  securityCode: '',
};

export function isCardStarted(state: CardFormState): boolean {
  return Boolean(state.number || state.name || state.expMonth || state.expYear || state.securityCode);
}

export type CardErrors = Partial<Record<'number' | 'name' | 'expiry' | 'securityCode', string>>;

export type CardValidation = { errors: CardErrors; summary: CardSummary | null };

/**
 * Checks the card and reduces it to what may be stored.
 *
 * Messages are passed in rather than imported so this stays usable from a test
 * and from any of the three locales.
 */
export function validateCard(
  state: CardFormState,
  messages: {
    cardInvalid: string;
    cardholderRequired: string;
    expiryInvalid: string;
    securityCodeInvalid: string;
  },
): CardValidation {
  const errors: CardErrors = {};
  const brand = detectCardBrand(state.number);
  const month = Number.parseInt(state.expMonth, 10);
  const year = Number.parseInt(state.expYear, 10);

  if (!luhnValid(state.number)) errors.number = messages.cardInvalid;
  if (!state.name.trim()) errors.name = messages.cardholderRequired;
  if (!expiryValid(month, year)) errors.expiry = messages.expiryInvalid;
  if (!securityCodeValid(state.securityCode, brand)) errors.securityCode = messages.securityCodeInvalid;

  if (Object.keys(errors).length > 0) return { errors, summary: null };

  return {
    errors,
    summary: cardSummary({
      cardNumber: state.number,
      expMonth: month,
      expYear: year,
      cardholderName: state.name,
    }),
  };
}

export function CardFields({
  value,
  onChange,
  errors,
  disabled,
}: {
  value: CardFormState;
  onChange: (next: CardFormState) => void;
  errors: CardErrors;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const brand = detectCardBrand(value.number);
  const securityCodeLength = brand === 'amex' ? 4 : 3;

  // A card entered today expires this year at the earliest and, in practice,
  // within a decade. Ten entries is a menu you can read; a free-text year is a
  // typo waiting to happen.
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 11 }, (_, i) => currentYear + i);

  function set(patch: Partial<CardFormState>) {
    onChange({ ...value, ...patch });
  }

  return (
    <div className="space-y-4">
      <Field label={t.billing.cardNumber} required error={errors.number ?? null}>
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            name="cardNumber"
            inputMode="numeric"
            autoComplete="cc-number"
            placeholder="4242 4242 4242 4242"
            value={formatCardNumber(value.number)}
            onChange={(event) => set({ number: digitsOnly(event.target.value).slice(0, 19) })}
            disabled={disabled}
            aria-invalid={invalid}
            aria-describedby={describedBy}
            className="font-mono tracking-wide"
          />
        )}
      </Field>

      <Field label={t.billing.cardholderName} required error={errors.name ?? null}>
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            name="cardholderName"
            autoComplete="cc-name"
            maxLength={120}
            value={value.name}
            onChange={(event) => set({ name: event.target.value })}
            disabled={disabled}
            aria-invalid={invalid}
            aria-describedby={describedBy}
          />
        )}
      </Field>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t.billing.expiryMonth} required error={errors.expiry ?? null}>
          {({ id, describedBy, invalid }) => (
            <Select
              id={id}
              name="expMonth"
              autoComplete="cc-exp-month"
              value={value.expMonth}
              onChange={(event) => set({ expMonth: event.target.value })}
              disabled={disabled}
              aria-invalid={invalid}
              aria-describedby={describedBy}
            >
              <option value="" disabled>
                {t.billing.expiryMonth}
              </option>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => (
                <option key={month} value={String(month)}>
                  {String(month).padStart(2, '0')}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label={t.billing.expiryYear} required>
          {({ id, describedBy }) => (
            <Select
              id={id}
              name="expYear"
              autoComplete="cc-exp-year"
              value={value.expYear}
              onChange={(event) => set({ expYear: event.target.value })}
              disabled={disabled}
              aria-invalid={Boolean(errors.expiry)}
              aria-describedby={describedBy}
            >
              <option value="" disabled>
                {t.billing.expiryYear}
              </option>
              {years.map((year) => (
                <option key={year} value={String(year)}>
                  {year}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label={t.billing.securityCode} required error={errors.securityCode ?? null}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              name="securityCode"
              inputMode="numeric"
              autoComplete="cc-csc"
              maxLength={securityCodeLength}
              value={value.securityCode}
              onChange={(event) =>
                set({ securityCode: digitsOnly(event.target.value).slice(0, securityCodeLength) })
              }
              disabled={disabled}
              aria-invalid={invalid}
              aria-describedby={describedBy}
              className="font-mono"
            />
          )}
        </Field>
      </div>
    </div>
  );
}
