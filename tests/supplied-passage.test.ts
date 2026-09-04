import { describe, expect, it } from 'vitest';

import { suppliedPassage } from '../src/lib/retrieval';

/*
 * Which text a comprehension part is answered against.
 *
 * A Lebanese comprehension exercise is one passage followed by numbered parts,
 * and only the first message carries the passage. Every part after that arrives
 * short and bare — "2. Relevez deux figures de style." — with nothing in its own
 * words to say what it is about. Before this rule those parts were sent down the
 * chapter path and answered, confidently, out of whichever chapter happened to
 * be nearest. That is the failure worth a test: not a crash, an answer.
 */
const base = { subjectIds: [], userId: 'u' };
const long = (marker: string) => `${marker} ${'texte '.repeat(80)}`;

describe('a passage supplied on an earlier turn', () => {
  it('is recovered for a short follow-up part', () => {
    const passage = long('Le vieil homme regardait la mer.');
    expect(
      suppliedPassage({
        ...base,
        query: '2. Relevez deux figures de style.',
        history: [
          { role: 'user', content: passage },
          { role: 'assistant', content: 'Le mot repris est « toujours ».' },
        ],
      }),
    ).toBe(passage);
  });

  it('is the query itself when the message carries it', () => {
    const pasted = long('Texte :');
    expect(suppliedPassage({ ...base, query: pasted, history: [] })).toBe(pasted);
  });

  it('is absent when nothing long was ever supplied', () => {
    expect(
      suppliedPassage({
        ...base,
        query: '2. Relevez deux figures de style.',
        history: [
          { role: 'user', content: 'bonjour' },
          { role: 'assistant', content: 'Bonjour, comment puis-je aider ?' },
        ],
      }),
    ).toBeNull();
  });

  it('never grounds on the tutor’s own long answer', () => {
    expect(
      suppliedPassage({
        ...base,
        query: '2. Relevez deux figures de style.',
        // The assistant explaining at length is not a passage. Treating it as
        // one lets a wrong answer be confirmed by quoting itself back.
        history: [{ role: 'assistant', content: long('Une figure de style est') }],
      }),
    ).toBeNull();
  });

  it('takes the most recent passage when a student moves to a second text', () => {
    const first = long('Premier texte :');
    const second = long('Deuxieme texte :');
    expect(
      suppliedPassage({
        ...base,
        query: '1. Quel est le ton de ce texte ?',
        history: [
          { role: 'user', content: first },
          { role: 'assistant', content: 'Le ton est nostalgique.' },
          { role: 'user', content: second },
          { role: 'assistant', content: 'Bien.' },
        ],
      }),
    ).toBe(second);
  });

  it('forgets a passage left far behind', () => {
    const passage = long('Texte :');
    const filler = Array.from({ length: 14 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: 'ok',
    }));
    expect(
      suppliedPassage({ ...base, query: 'et la suite ?', history: [{ role: 'user', content: passage }, ...filler] }),
    ).toBeNull();
  });
});
