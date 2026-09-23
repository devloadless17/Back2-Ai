import { describe, expect, it } from 'vitest';

import { shouldRetract } from '@/lib/verification';

/**
 * Taking an answer off a student's screen is the strongest thing the tutor
 * does. It has to rest on the checker having actually found something.
 */
const verdict = (over: Partial<Parameters<typeof shouldRetract>[0]>) => ({
  supported: true,
  severity: 'none' as const,
  issues: [],
  notes: '',
  modelUsed: null,
  inconclusive: false,
  ...over,
});

describe('shouldRetract', () => {
  it('withdraws an answer the checker found unsupported', () => {
    expect(
      shouldRetract(verdict({ supported: false, severity: 'major', issues: ['invented a formula'] })),
    ).toBe(true);
  });

  it('keeps an answer when the check itself could not run', () => {
    // 23 September: the verifier's output ceiling was reached mid-thought on a
    // long physics derivation, and a correct answer was withdrawn with
    // "I could not verify this against the curriculum" — a claim about the
    // student's own textbook that nothing had checked.
    expect(
      shouldRetract(
        verdict({
          supported: false,
          severity: 'major',
          inconclusive: true,
          notes: 'The verification pass could not be completed.',
        }),
      ),
    ).toBe(false);
  });

  it('keeps an answer the checker passed', () => {
    expect(shouldRetract(verdict({}))).toBe(false);
    expect(shouldRetract(verdict({ severity: 'minor' }))).toBe(false);
  });
});
