import { describe, expect, it } from 'vitest';

import { studentPassage } from '@/lib/source-passage';

describe('Arabic exam document passages', () => {
  it('stops before questions appended by whole-paper OCR', () => {
    const stored = [
      'المستند رقم (٣)',
      'أحمد طرايش، الجزيرة نت، ٢٠٢٣ (بتصرف)',
      '',
      'صفحة ١ من ٣',
      '',
      'الأسئلة: تتألف المسابقة من ثلاث مجموعات من الأسئلة.',
      'أولاً- حدد طبيعة المستند.',
      'أسس التصحيح',
      'الإجابة: نص لا يجوز عرضه قبل الحل.',
    ].join('\n');

    expect(studentPassage(stored)).toBe([
      'المستند رقم (٣)',
      'أحمد طرايش، الجزيرة نت، ٢٠٢٣ (بتصرف)',
    ].join('\n'));
  });

  it('also stops when a correction key directly follows the documents', () => {
    expect(studentPassage('المستند رقم (١)\nمحتوى المستند\nمعايير التصحيح:\nالحل')).toBe(
      'المستند رقم (١)\nمحتوى المستند',
    );
  });

  it('does not cut prose that mentions questions inside a sentence', () => {
    const passage = 'يناقش الكاتب الأسئلة التي يطرحها النمو السكاني في المدن.';
    expect(studentPassage(passage)).toBe(passage);
  });
});
