/**
 * Plans, and the card checks that run before anything is sent to the server.
 *
 * No payment processor is connected. `PAYMENTS_ENABLED` is the single switch
 * that says so, and every surface that mentions money reads it rather than
 * deciding for itself — so the day a processor is wired in, there is one place
 * to flip and no screen left quietly claiming a card was charged.
 *
 * What that means concretely while it is false:
 *   * A card can be entered and is validated, but nothing is authorised.
 *   * The subscription row is written with status `pending`.
 *   * Nothing in the product is gated on it. A student who skips the payment
 *     step gets the whole application. Gating study material behind a payment
 *     that cannot yet be taken would lock people out of a product that is not
 *     charging them.
 *
 * This module is shared by client and server, so it must stay free of imports
 * that only resolve on one side.
 */

export const PAYMENTS_ENABLED = false;

export const PLAN_IDS = ['free', 'monthly', 'annual'] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export type Plan = {
  id: PlanId;
  /** In USD. The Lebanese market prices tuition in dollars. */
  priceUsd: number;
  periodMonths: number;
  /** Whether choosing it asks for a card. */
  requiresCard: boolean;
};

export const PLANS: Record<PlanId, Plan> = {
  free: { id: 'free', priceUsd: 0, periodMonths: 0, requiresCard: false },
  monthly: { id: 'monthly', priceUsd: 12, periodMonths: 1, requiresCard: true },
  annual: { id: 'annual', priceUsd: 96, periodMonths: 12, requiresCard: true },
};

export function isPlanId(value: string): value is PlanId {
  return (PLAN_IDS as readonly string[]).includes(value);
}

/** What the annual plan saves against paying monthly, as a whole percentage. */
export function annualSavingPercent(): number {
  const monthlyYear = PLANS.monthly.priceUsd * 12;
  if (monthlyYear === 0) return 0;
  return Math.round(((monthlyYear - PLANS.annual.priceUsd) / monthlyYear) * 100);
}

// --- Card checks ---------------------------------------------------------
//
// These exist so the form can reject a typo immediately. They are not security
// controls and are not a substitute for a processor's own validation. The full
// card number never leaves the browser: `cardSummary` reduces it to the brand
// and last four, and that is all the API accepts.

export const CARD_BRANDS = ['visa', 'mastercard', 'amex', 'discover', 'unknown'] as const;
export type CardBrand = (typeof CARD_BRANDS)[number];

export function isCardBrand(value: string): value is CardBrand {
  return (CARD_BRANDS as readonly string[]).includes(value);
}

export function digitsOnly(value: string): string {
  return value.replace(/\D+/g, '');
}

export function detectCardBrand(cardNumber: string): CardBrand {
  const digits = digitsOnly(cardNumber);
  if (/^4/.test(digits)) return 'visa';
  if (/^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))/.test(digits)) return 'mastercard';
  if (/^3[47]/.test(digits)) return 'amex';
  if (/^6(011|5|4[4-9])/.test(digits)) return 'discover';
  return 'unknown';
}

/** Groups digits the way the brand prints them, for display only. */
export function formatCardNumber(cardNumber: string): string {
  const digits = digitsOnly(cardNumber).slice(0, 19);
  const groups = detectCardBrand(digits) === 'amex' ? [4, 6, 5] : [4, 4, 4, 4, 3];

  const parts: string[] = [];
  let cursor = 0;
  for (const size of groups) {
    if (cursor >= digits.length) break;
    parts.push(digits.slice(cursor, cursor + size));
    cursor += size;
  }
  return parts.join(' ');
}

/** The Luhn checksum every major scheme's numbers satisfy. */
export function luhnValid(cardNumber: string): boolean {
  const digits = digitsOnly(cardNumber);
  if (digits.length < 12 || digits.length > 19) return false;

  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let value = digits.charCodeAt(i) - 48;
    if (double) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    double = !double;
  }
  return sum % 10 === 0;
}

/** A card is good through the last day of its printed month. */
export function expiryValid(month: number, year: number, now: Date = new Date()): boolean {
  if (!Number.isInteger(month) || month < 1 || month > 12) return false;
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return false;

  // First instant of the month *after* the printed one.
  const expiresAfter = Date.UTC(year, month, 1);
  return expiresAfter > Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
}

export function securityCodeValid(code: string, brand: CardBrand): boolean {
  const digits = digitsOnly(code);
  return brand === 'amex' ? digits.length === 4 : digits.length === 3;
}

export type CardSummary = {
  brand: CardBrand;
  last4: string;
  expMonth: number;
  expYear: number;
  cardholderName: string;
};

/**
 * Everything about a card that may cross the network.
 *
 * Note what is absent: the number and the security code. A form that posts them
 * "just for now, we'll swap it for the processor later" puts the whole database
 * in PCI scope, and later never comes.
 */
export function cardSummary(input: {
  cardNumber: string;
  expMonth: number;
  expYear: number;
  cardholderName: string;
}): CardSummary {
  const digits = digitsOnly(input.cardNumber);
  return {
    brand: detectCardBrand(digits),
    last4: digits.slice(-4),
    expMonth: input.expMonth,
    expYear: input.expYear,
    cardholderName: input.cardholderName.trim().slice(0, 120),
  };
}
