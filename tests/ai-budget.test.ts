import { describe, expect, it } from 'vitest';

import { budgetMicrosFor, costMicros, priceOf } from '../src/lib/ai/budget';

/*
 * What a student is charged, and what stops them.
 *
 * Every number here was read off the providers' own usage counters on
 * 2026-09-07, not estimated from character counts — a measured tutor question
 * is two calls totalling $0.0676. The cases that matter are the ones where
 * getting it wrong is silent: an unpriced model that costs nothing would spend
 * against a budget it never depletes, and nobody would learn otherwise until
 * the invoice.
 */
describe('pricing a call', () => {
  it('matches a dated snapshot to its family', () => {
    expect(priceOf('gpt-5.5-2026-04-23').output).toBe(30);
    expect(priceOf('gpt-5.4-mini-2026-03-17').output).toBe(4.5);
  });

  it('prefers the longest matching prefix, so mini is not read as its family', () => {
    // 'gpt-5.4-mini' and 'gpt-5.4' both match; the specific one must win, or
    // the cheap verification pass is billed at the expensive model's rate.
    expect(priceOf('gpt-5.4-mini').input).toBe(0.75);
    expect(priceOf('gpt-5.4').input).toBe(2.5);
  });

  it('charges an unknown model at the highest rate rather than nothing', () => {
    const unknown = priceOf('some-model-nobody-priced');
    const dearest = priceOf('gpt-5.4-pro');
    expect(unknown.output).toBe(dearest.output);
    expect(unknown.output).toBeGreaterThan(0);
  });

  it('bills cached input at the cached rate', () => {
    const fresh = costMicros({ model: 'gpt-5.5', inputTokens: 1_000_000, outputTokens: 0 });
    const cached = costMicros({
      model: 'gpt-5.5', inputTokens: 1_000_000, cachedInputTokens: 1_000_000, outputTokens: 0,
    });
    expect(fresh).toBe(5_000_000n); // $5.00
    expect(cached).toBe(500_000n); //  $0.50 — the ten-fold saving
  });

  it('prices a real measured tutor question', () => {
    // The two calls one question actually made, token for token.
    const answer = costMicros({ model: 'gpt-5.5-2026-04-23', inputTokens: 7953, outputTokens: 674 });
    const verify = costMicros({ model: 'gpt-5.4-mini-2026-03-17', inputTokens: 8253, outputTokens: 325 });
    const total = Number(answer + verify) / 1_000_000;
    expect(total).toBeGreaterThan(0.06);
    expect(total).toBeLessThan(0.08);
  });

  it('never returns a negative cost when cached exceeds input', () => {
    expect(costMicros({ model: 'gpt-5.5', inputTokens: 10, cachedInputTokens: 999, outputTokens: 0 }))
      .toBeGreaterThanOrEqual(0n);
  });
});

describe('the monthly ceiling', () => {
  it('gives an unknown plan the free allowance rather than an unlimited one', () => {
    expect(budgetMicrosFor('something-invented')).toBe(budgetMicrosFor('free'));
  });

  it('lets a paid plan spend more than a free one', () => {
    expect(budgetMicrosFor('monthly')).toBeGreaterThan(budgetMicrosFor('free'));
  });

  it('is worth at least a few questions on the free plan', () => {
    const perQuestion = 67_600n; // measured
    expect(budgetMicrosFor('free') / perQuestion).toBeGreaterThan(10n);
  });
});
