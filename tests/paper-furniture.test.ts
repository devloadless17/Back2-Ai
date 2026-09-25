import { describe, expect, it } from 'vitest';

import { stripPaperFurniture } from '../scripts/corpus/paper-furniture';

describe('stripPaperFurniture', () => {
  it('removes a detached marks column and the footer under it (2023 history paper)', () => {
    const text = [
      'ب- عرّف الجمعية "العربية الفتاة"، واذكر أهدافها، وبيّن مصيرها.',
      '',
      ' (علامتان ونصف) ',
      '(علامــة ونصـف) ',
      ' (ثلاث علامـــات) ',
      '(علامتـــــــــــــان)',
      '(أرب ـع علامات)',
      'العادية ',
      'الثلاثاء 11 تموز2023 ',
      ' مشروع',
    ].join('\n');
    const out = stripPaperFurniture(text);
    expect(out.text).toBe('ب- عرّف الجمعية "العربية الفتاة"، واذكر أهدافها، وبيّن مصيرها.');
    expect(out.removed).toHaveLength(8);
  });

  it('keeps a single mark at the end: it belongs to the last sub-question', () => {
    const text = 'ج - هل ترى أن اللجوء إلى القوة هو دائماً موقف لا أخلاقي؟\n(أربع علامات)';
    expect(stripPaperFurniture(text).text).toBe(text);
  });

  it('drops a footer below a single mark but keeps the mark', () => {
    const text = 'ج - علّل إجابتك.\n(أربع علامات)\nمشروع';
    expect(stripPaperFurniture(text).text).toBe('ج - علّل إجابتك.\n(أربع علامات)');
  });

  it('removes page numbers and English/French mark blocks', () => {
    expect(stripPaperFurniture('Solve the equation.\nPage 4 of 4').text).toBe('Solve the equation.');
    expect(stripPaperFurniture('c) Discuss.\n(9 pts)\n(7 pts)\n(4 pts)').text).toBe('c) Discuss.');
    expect(stripPaperFurniture('Calculate f(1).\n2/3').text).toBe('Calculate f(1).');
  });

  it('removes letterhead lines even when the old text layer split their words', () => {
    const text = 'اشرح التنظيمات الإدارية.\nالمديري ة العام ة للت ربية\nفرعا العلوم العامة وعلوم الحياة\nالس بت 31 تموز2021\nمشروع';
    expect(stripPaperFurniture(text).text).toBe('اشرح التنظيمات الإدارية.');
  });

  it('leaves real content alone', () => {
    for (const text of [
      'Calculate the probability.\n7/12',
      'Find x such that 2x = 3.',
      'أوضح أربعة من أسباب الثورة السورية سنة 1925.',
      'Explain how the market reached this price.\n$$p = 2$$',
      'اذكر أربعة من مظاهر السياسة الفرنسية.\nفرنسا',
      'Name the gland that secretes LH.',
    ]) {
      expect(stripPaperFurniture(text).text).toBe(text);
    }
  });
});
