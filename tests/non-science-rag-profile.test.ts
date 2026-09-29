import { describe, expect, it } from 'vitest';

import { isScientificSubjectName, retrievalHandoverLimit } from '@/lib/retrieval';

describe('non-science RAG profile', () => {
  it('uses the measured 20-source recall window for every non-science family', () => {
    for (const subject of [
      'Arabe',
      'English',
      'Francais',
      'أدب عربي',
      'فلسفة عامة',
      'تاريخ',
      'جغرافيا',
      'تربية وطنية',
      'اقتصاد',
      'اجتماع',
    ]) {
      expect(isScientificSubjectName(subject), subject).toBe(false);
      expect(retrievalHandoverLimit(subject), subject).toBe(20);
    }
  });

  it('leaves every scientific subject at the established 12-source window', () => {
    for (const subject of [
      'Mathematics',
      'Mathématiques',
      'Physics',
      'Physique',
      'Chemistry',
      'Chimie',
      'Life Sciences',
      'Sciences de la vie',
    ]) {
      expect(isScientificSubjectName(subject), subject).toBe(true);
      expect(retrievalHandoverLimit(subject), subject).toBe(12);
    }
  });
});
