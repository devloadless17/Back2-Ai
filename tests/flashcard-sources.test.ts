import { describe, expect, it } from 'vitest';

import { flashcardSources, usableFlashcardSourceText } from '@/lib/flashcard-bank';

describe('AI flashcard sources', () => {
  it('rejects blank and visibly damaged OCR before it reaches a card', () => {
    expect(usableFlashcardSourceText('')).toBe(false);
    expect(usableFlashcardSourceText('No worked answer was recorded.')).toBe(false);
    expect(usableFlashcardSourceText('damaged \uFFFD answer')).toBe(false);
    expect(usableFlashcardSourceText('ا ل ج و ا ب غير صالح')).toBe(false);
  });

  it('keeps book passages and official exam corrections as distinct provenance', () => {
    const sources = flashcardSources(
      [{ id: 'book-1', title: 'Immunity', contentText: 'Textbook facts' }],
      [
        {
          id: 'exam-1',
          contentText: 'State the conclusion.',
          officialSolution: 'The official conclusion.',
          sourceExam: { year: 2025, session: 'first' },
        },
      ],
    );

    expect(sources).toEqual([
      { id: 'book-1', kind: 'book', title: 'Immunity', text: 'Textbook facts' },
      {
        id: 'exam-1',
        kind: 'exam',
        title: 'Official exam 2025 first',
        text: 'Question:\nState the conclusion.\n\nOfficial correction:\nThe official conclusion.',
      },
    ]);
  });
});
