import { describe, expect, it } from 'vitest';

import { flashcardAnswerPrompt } from '@/lib/flashcard-answer';

describe('missing flashcard answers are grounded in the book', () => {
  it('forbids general knowledge and preserves source wording', () => {
    const prompt = flashcardAnswerPrompt('ar');
    expect(prompt).toContain('using ONLY the textbook passages');
    expect(prompt).toContain('preserve any definition, date, name, list, or stated conclusion exactly');
    expect(prompt).toContain('Do not add general knowledge');
    expect(prompt).toContain('NO_ANSWER');
    expect(prompt).toContain('Answer in Arabic');
  });
});
