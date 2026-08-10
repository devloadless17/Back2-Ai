import { describe, expect, it } from 'vitest';

import {
  annualSavingPercent,
  cardSummary,
  detectCardBrand,
  expiryValid,
  formatCardNumber,
  luhnValid,
  securityCodeValid,
} from '@/lib/billing';
import { AVAILABLE_COUNTRIES, countryOptions, isAvailableCountry } from '@/lib/countries';

/*
 * These are typo checks on a form, not security controls — a processor will
 * validate for real. They are tested because the failure they prevent is a
 * student who cannot work out why the button will not go, and because
 * `cardSummary` is the boundary that keeps the card number off the network.
 */

describe('detectCardBrand', () => {
  it('recognises the schemes used in Lebanon', () => {
    expect(detectCardBrand('4242424242424242')).toBe('visa');
    expect(detectCardBrand('5555555555554444')).toBe('mastercard');
    expect(detectCardBrand('2223003122003222')).toBe('mastercard');
    expect(detectCardBrand('378282246310005')).toBe('amex');
    expect(detectCardBrand('6011111111111117')).toBe('discover');
  });

  it('says unknown rather than guessing', () => {
    expect(detectCardBrand('9999999999999999')).toBe('unknown');
    expect(detectCardBrand('')).toBe('unknown');
  });
});

describe('luhnValid', () => {
  it('accepts well-formed numbers', () => {
    expect(luhnValid('4242 4242 4242 4242')).toBe(true);
    expect(luhnValid('378282246310005')).toBe(true);
  });

  it('rejects a transposed digit', () => {
    expect(luhnValid('4242424242424243')).toBe(false);
  });

  it('rejects lengths no scheme issues', () => {
    expect(luhnValid('42424242')).toBe(false);
    expect(luhnValid('')).toBe(false);
  });
});

describe('expiryValid', () => {
  const now = new Date('2026-08-10T00:00:00Z');

  it('accepts a card that expires this month — it is good until the month ends', () => {
    expect(expiryValid(8, 2026, now)).toBe(true);
  });

  it('rejects last month', () => {
    expect(expiryValid(7, 2026, now)).toBe(false);
  });

  it('rejects impossible months', () => {
    expect(expiryValid(0, 2027, now)).toBe(false);
    expect(expiryValid(13, 2027, now)).toBe(false);
    expect(expiryValid(Number.NaN, 2027, now)).toBe(false);
  });
});

describe('securityCodeValid', () => {
  it('wants four digits on Amex and three elsewhere', () => {
    expect(securityCodeValid('1234', 'amex')).toBe(true);
    expect(securityCodeValid('123', 'amex')).toBe(false);
    expect(securityCodeValid('123', 'visa')).toBe(true);
    expect(securityCodeValid('1234', 'visa')).toBe(false);
  });
});

describe('formatCardNumber', () => {
  it('groups by scheme', () => {
    expect(formatCardNumber('4242424242424242')).toBe('4242 4242 4242 4242');
    expect(formatCardNumber('378282246310005')).toBe('3782 822463 10005');
  });
});

describe('cardSummary', () => {
  it('keeps only what may be stored', () => {
    const summary = cardSummary({
      cardNumber: '4242 4242 4242 4242',
      expMonth: 4,
      expYear: 2030,
      cardholderName: '  Rania Khoury  ',
    });

    expect(summary).toEqual({
      brand: 'visa',
      last4: '4242',
      expMonth: 4,
      expYear: 2030,
      cardholderName: 'Rania Khoury',
    });

    // The guarantee that matters: no field of the summary contains the number.
    expect(JSON.stringify(summary)).not.toContain('4242424242424242');
  });
});

describe('annualSavingPercent', () => {
  it('is a real saving, or the annual plan has no reason to exist', () => {
    expect(annualSavingPercent()).toBeGreaterThan(0);
  });
});

describe('countries', () => {
  it('offers Lebanon and nothing else, for now', () => {
    expect(AVAILABLE_COUNTRIES).toEqual(['LB']);
    expect(isAvailableCountry('LB')).toBe(true);
    expect(isAvailableCountry('FR')).toBe(false);
  });

  it('lists planned countries as unavailable rather than hiding them', () => {
    const options = countryOptions('en');

    expect(options[0]).toMatchObject({ code: 'LB', available: true });
    expect(options.length).toBeGreaterThan(1);
    expect(options.filter((option) => option.available)).toHaveLength(1);
    expect(options.every((option) => option.name.length > 0)).toBe(true);
  });
});
