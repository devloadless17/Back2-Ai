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
    'أ- عرف لبنان خلال الحرب العالمية الأولى ضائقة اقتصادية خانقة. عالج أسبابها وبيّن نتائجها. (أربع علامات)',
    'Calculate the energy stored in the capacitor. (1.5 pts)',
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

  it('keeps cards short: one question, a short answer', () => {
    // Several numbered parts are several cards, not one.
    expect(
      isCardShaped({ contentText: 'Ethanoic acid reacts with ethanol.\n1. Write the equation.\n2. Name the ester.' }),
    ).toBe(false);
    // A paragraph is not a card.
    expect(isCardShaped({ contentText: 'x'.repeat(200) })).toBe(false);
    // Nor is a short question whose official answer runs a page.
    expect(isCardShaped({ contentText: 'Define the half-life.', officialSolution: 'y'.repeat(400) })).toBe(false);
    expect(isCardShaped({ contentText: 'Define the half-life.', officialSolution: 'The time for half the nuclei to decay.' })).toBe(true);
  });

  it('caps a generated front at a short line', () => {
    expect(generatedFrontStandsAlone('What is a perfect gas?', false)).toBe(true);
    expect(generatedFrontStandsAlone('w '.repeat(70), false)).toBe(false);
  });
});
