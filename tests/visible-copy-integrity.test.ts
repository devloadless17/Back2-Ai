import { describe, expect, it } from 'vitest';

import { ar } from '@/lib/i18n/dictionaries/ar';
import { en } from '@/lib/i18n/dictionaries/en';
import { fr } from '@/lib/i18n/dictionaries/fr';

function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (!value || typeof value !== 'object') return [];
  return Object.values(value).flatMap(strings);
}

describe('student-visible translated copy', () => {
  it('contains no replacement characters or common UTF-8 mojibake', () => {
    for (const dictionary of [en, fr, ar]) {
      for (const value of strings(dictionary)) {
        expect(value).not.toMatch(/\uFFFD|Ã.|Â[\u0080-\u00BF]|â(?:€|€™|œ|\u0080)/u);
      }
    }
  });

  it('translates the generated textbook-answer state in every interface language', () => {
    for (const dictionary of [en, fr, ar]) {
      expect(dictionary.flashcards.answerFromBookLoading.trim()).not.toBe('');
      expect(dictionary.flashcards.answerFromBook.trim()).not.toBe('');
      expect(dictionary.flashcards.answerFromExam.trim()).not.toBe('');
      expect(dictionary.schedule.sunday.trim()).not.toBe('');
    }
  });
});
