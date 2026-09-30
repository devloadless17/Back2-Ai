import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({ db: {} }));

const { quotedTitles } = await import('@/lib/retrieval');

describe('titles quoted in the conversation', () => {
  it('finds a title the tutor quoted when the student only asks where the text is', () => {
    const titles = quotedTitles({
      query: 'اين النص؟',
      history: [
        { role: 'user', content: 'أعطني أسئلة على نص' },
        { role: 'assistant', content: 'إليك نموذج أسئلة على نصّ «شبابك على قدر طاقتك» لمارون عبّود:' },
      ],
    });
    expect(titles).toEqual(['شبابك على قدر طاقتك']);
  });

  it('puts the newest message first', () => {
    const titles = quotedTitles({
      query: 'et dans « Le Horla » ?',
      history: [{ role: 'user', content: 'Parlons de « Candide »' }],
    });
    expect(titles).toEqual(['Le Horla', 'Candide']);
  });

  it('ignores quotes too short to be a title', () => {
    expect(quotedTitles({ query: 'what does «on» refer to?', history: [] })).toEqual([]);
  });
});
