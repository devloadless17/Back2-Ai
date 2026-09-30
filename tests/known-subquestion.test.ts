import { describe, expect, it } from 'vitest';

import { asksForOfficialAnswer } from '@/lib/chat';
import { lexicalAgreement, subquestionAgreement } from '@/lib/retrieval';

const FULL_EXERCISE = `Virus X infects a target cell. Documents 1 and 2 show the
activation and multiplication of specific lymphocytes.
1- Identify the immune cells involved.
2- Describe their activation.
3- Explain the observed multiplication.
4- Name the type of immune response.
5- Specify whether this involved immune response is capable to eliminate the cells infected by virus X.`;

describe('a known part copied from a stored multi-part exercise', () => {
  it('recognises direct answer requests in the supported course languages', () => {
    expect(asksForOfficialAnswer('solve plz')).toBe(true);
    expect(asksForOfficialAnswer('donne-moi la solution')).toBe(true);
    expect(asksForOfficialAnswer('أعطني الجواب')).toBe(true);
    expect(asksForOfficialAnswer('explain why this works')).toBe(false);
  });

  it('matches its parent exercise even though symmetric overlap is necessarily low', () => {
    const part =
      '5- Specify whether this involved immune response is capable to eliminate the cells infected by virus X. solve plz';
    expect(lexicalAgreement(part, FULL_EXERCISE)).toBeLessThan(0.8);
    expect(subquestionAgreement(part, FULL_EXERCISE)).toBeGreaterThanOrEqual(0.9);
  });

  it('does not promote a generic short instruction to an exact question', () => {
    expect(subquestionAgreement('Explain your answer please.', FULL_EXERCISE)).toBe(0);
    expect(subquestionAgreement('Specify whether this is correct.', FULL_EXERCISE)).toBe(0);
  });

  it('does not match a different question merely because it shares a topic', () => {
    expect(
      subquestionAgreement(
        'Explain how antibodies neutralize free viral particles in the blood plasma.',
        FULL_EXERCISE,
      ),
    ).toBeLessThan(0.9);
  });
});
