import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({ db: {} }));

const { generatedFrontStandsAlone, isCardShaped } = await import('@/lib/queries/flashcards');

// Real cards students were dealt on the live site, 2026-10-02.
describe('a flashcard has to make sense on its own', () => {
  it.each([
    'تتضمن المجموعة الأولى قسمين اختباريين: عليك اختيار إما القسم الأول بالكامل إما القسم الثاني بالكامل',
    'في الثقافة الأدبية العالمية - استخلص المعاني الرئيسة . -حدّد المسار الخلقي والروحي للشاعر . ۱ ۱ ۲ المجموع',
    'b) Deduce the value of the capacitance C.',
    'Using document 2, explain the role of the baroreceptors.',
    'Choose one of the two exercises below.',
  ])('drops: %s', (text) => {
    expect(isCardShaped({ contentText: text })).toBe(false);
  });

  it.each([
    'Which functional group characterises CH₃—CO—CH₃?',
    'A rise in arterial pressure detected by the baroreceptors of the carotid sinus leads to:',
    'ما وظيفة مؤتمر سان ريمو سنة 1920؟',
    'Define the half-life of a radioactive isotope.',
  ])('keeps: %s', (text) => {
    expect(isCardShaped({ contentText: text })).toBe(true);
  });

  it('drops a generated card that points back at one exam exercise', () => {
    expect(generatedFrontStandsAlone('2021 urn: are R and O independent?', true)).toBe(false);
    expect(generatedFrontStandsAlone('Blood table: p(rhesus negative / group O)', true)).toBe(false);
  });

  it('keeps general cards, from a book or an exam', () => {
    expect(generatedFrontStandsAlone('Formula for p(B/A)', true)).toBe(true);
    expect(generatedFrontStandsAlone('Mole fraction of a gas in a mixture', false)).toBe(true);
    expect(generatedFrontStandsAlone('ما وظيفة مؤتمر سان ريمو سنة 1920؟', false)).toBe(true);
  });
});
