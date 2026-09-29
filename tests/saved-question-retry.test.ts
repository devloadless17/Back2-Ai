import { describe, expect, it } from 'vitest';

import { historyWithoutLegacyWithdrawals, savedQuestionForRetry } from '@/lib/chat';

const question =
  '5- Specify whether this involved immune response is capable to eliminate the cells infected by virus X.';
const withdrawal =
  'I started an answer I could not verify against the curriculum. I would rather withdraw it.';

describe('retrying a legacy withdrawn answer', () => {
  const history = [
    { role: 'user' as const, content: question },
    { role: 'assistant' as const, content: withdrawal },
  ];

  it('recovers the saved exercise for a short retry', () => {
    expect(savedQuestionForRetry('solve it please', history)).toBe(question);
    expect(savedQuestionForRetry('??', history)).toBe(question);
  });

  it('does not replace a new substantive question', () => {
    expect(
      savedQuestionForRetry(
        'Explain how antibodies neutralize free viral particles and prevent infection of target cells.',
        history,
      ),
    ).toBeNull();
  });

  it('removes obsolete withdrawal text before sending history to the model', () => {
    expect(historyWithoutLegacyWithdrawals(history)).toEqual([
      { role: 'user', content: question },
    ]);
  });
});
