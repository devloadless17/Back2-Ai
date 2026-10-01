import { describe, expect, it } from 'vitest';

import { bodyToRender, withoutAppendedArabicCover } from '@/lib/question-body';
import { studentPassage } from '@/lib/source-passage';

describe('French paper furniture', () => {
  it('removes an appended Arabic ministry cover', () => {
    const text =
      'Relevez deux indices dans le texte.\n\nوزارة التربية والتعليم العالي\nدائرة الامتحانات الرسمية';
    expect(withoutAppendedArabicCover(text)).toBe('Relevez deux indices dans le texte.');
    expect(bodyToRender(null, text)).not.toMatch(/[؀-ۿ]/u);
    expect(studentPassage(text)).toBe('Relevez deux indices dans le texte.');
  });

  it('keeps an Arabic quotation inside a French text', () => {
    const text = 'Expliquez le sens du titre arabe « الإعمار والاقتصاد » dans ce passage.';
    expect(withoutAppendedArabicCover(text)).toBe(text);
  });

  it('cleans the preferred LaTeX body too', () => {
    expect(bodyToRender('Question en français.\nوزارة التربية والتعليم العالي', 'secours')).toBe(
      'Question en français.',
    );
  });
});
