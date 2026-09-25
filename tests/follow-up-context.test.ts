import { describe, expect, it } from 'vitest';

import { followUpQuery } from '@/lib/retrieval';

/**
 * A short message searched together with the turn it depends on.
 *
 * "وما هي نتائجها؟" is a complete question to anyone who read the message
 * before it and sixteen meaningless characters to an embedding. This is the
 * join that gives retrieval the half of the question the student did not
 * repeat — and the cases where it must NOT join, because dragging an old topic
 * onto a new question is the failure it would otherwise introduce.
 */

const turn = (role: 'user' | 'assistant', content: string) => ({ role, content });

describe('a follow-up that cannot stand alone', () => {
  it('joins the short message to the question before it', () => {
    const joined = followUpQuery({
      query: 'وما هي نتائجها؟',
      subjectIds: ['s1'],
      userId: 'u1',
      history: [turn('user', 'ما هي أسباب الحرب الأهلية اللبنانية؟'), turn('assistant', 'أسبابها ثلاثة...')],
    });

    expect(joined).toContain('أسباب الحرب الأهلية اللبنانية');
    expect(joined).toContain('وما هي نتائجها؟');
  });

  it('fires on the one-word difference, where the two questions are nearly the same', () => {
    // The case that reads as the tutor forgetting: same sentence, one word
    // changed, and on its own words it retrieves the same wrong thing.
    const joined = followUpQuery({
      query: 'والسلطة التنفيذية؟',
      subjectIds: ['s1'],
      userId: 'u1',
      history: [turn('user', 'ما هي صلاحيات السلطة التشريعية في لبنان؟')],
    });

    expect(joined).toContain('صلاحيات السلطة التشريعية');
  });

  it('reads the student, never the tutor', () => {
    // Searching on the tutor' own previous answer is how a wrong answer gets
    // confirmed by being looked up again.
    const joined = followUpQuery({
      query: 'ولماذا؟',
      subjectIds: ['s1'],
      userId: 'u1',
      history: [turn('user', 'ما هو التضخم؟'), turn('assistant', 'التضخم هو ارتفاع مستمر في المستوى العام للأسعار.')],
    });

    expect(joined).toContain('ما هو التضخم؟');
    expect(joined).not.toContain('ارتفاع مستمر');
  });

  it('works in French and English too', () => {
    expect(
      followUpQuery({
        query: 'et les conséquences ?',
        subjectIds: ['s1'],
        userId: 'u1',
        history: [turn('user', 'Quelles sont les causes de la crise de 1929 ?')],
      }),
    ).toContain('causes de la crise de 1929');
  });

  it('caps how much of the earlier turn it carries', () => {
    const joined = followUpQuery({
      query: 'ولماذا؟',
      subjectIds: ['s1'],
      userId: 'u1',
      history: [turn('user', 'x'.repeat(2000))],
    });

    // 300 of context plus a newline plus the seven-character message.
    expect(joined?.length).toBeLessThan(320);
  });
});

describe('when it must not join', () => {
  it('leaves a question that carries its own topic alone', () => {
    // Long enough to embed on its own words. Joining would let the previous
    // topic compete with the one the student actually asked about.
    expect(
      followUpQuery({
        query: 'اشرح لي بالتفصيل أسباب قيام الثورة العربية الكبرى ونتائجها على المشرق العربي وما تلاها من اتفاقات.',
        subjectIds: ['s1'],
        userId: 'u1',
        history: [turn('user', 'ما هو التضخم؟')],
      }),
    ).toBeNull();
  });

  it('returns null on the first message of a conversation', () => {
    expect(followUpQuery({ query: 'ولماذا؟', subjectIds: ['s1'], userId: 'u1', history: [] })).toBeNull();
    expect(followUpQuery({ query: 'ولماذا؟', subjectIds: ['s1'], userId: 'u1' })).toBeNull();
  });

  it('returns null when only the tutor has spoken', () => {
    expect(
      followUpQuery({
        query: 'ولماذا؟',
        subjectIds: ['s1'],
        userId: 'u1',
        history: [turn('assistant', 'مرحباً، كيف أساعدك؟')],
      }),
    ).toBeNull();
  });

  it('does not reach back past the turns a topic survives', () => {
    // Four turns. A topic abandoned longer ago than that is not this
    // question' topic, and reaching for it would answer against an old chapter.
    expect(
      followUpQuery({
        query: 'ولماذا؟',
        subjectIds: ['s1'],
        userId: 'u1',
        history: [
          turn('user', 'ما هو التضخم؟'),
          turn('assistant', 'a'),
          turn('assistant', 'b'),
          turn('assistant', 'c'),
          turn('assistant', 'd'),
        ],
      }),
    ).toBeNull();
  });

  it('skips an empty earlier turn rather than joining to nothing', () => {
    expect(
      followUpQuery({
        query: 'ولماذا؟',
        subjectIds: ['s1'],
        userId: 'u1',
        history: [turn('user', 'ما هو التضخم؟'), turn('user', '   ')],
      }),
    ).toContain('ما هو التضخم؟');
  });
});
