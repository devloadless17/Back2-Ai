import { describe, expect, it } from 'vitest';

import {
  followsWorksheetBlueprint,
  selectOfficialCycle,
  worksheetBlueprint,
} from '@/lib/worksheet-blueprint';

describe('worksheet subject blueprints', () => {
  const comprehension =
    'Read the following passage carefully, and then answer the questions that follow. Paragraph 1 explains the discovery.';
  const writing =
    'Prompt A: Write a well-organized argumentative essay of 250-300 words about technology.';

  it('builds one complete comprehension section for English', () => {
    expect(worksheetBlueprint('English')).toEqual({
      count: 1,
      acceptedKinds: ['comprehension'],
      selection: 'filtered',
    });
    expect(followsWorksheetBlueprint('English', comprehension)).toBe(true);
    expect(followsWorksheetBlueprint('English', writing)).toBe(false);
  });

  it('uses the same passage-based section rule for French and Arabic literature', () => {
    expect(worksheetBlueprint('Francais').count).toBe(1);
    expect(worksheetBlueprint('أدب عربي').count).toBe(1);
    expect(followsWorksheetBlueprint('Francais', 'Production écrite : Rédigez un essai argumentatif.')).toBe(false);
  });

  it('uses the three official alternatives for philosophy', () => {
    expect(worksheetBlueprint('فلسفة عامة')).toEqual({
      count: 3,
      acceptedKinds: ['essay'],
      selection: 'filtered',
    });
  });

  it('uses an official paper for every other subject', () => {
    expect(worksheetBlueprint('Mathematics')).toEqual({
      count: null,
      acceptedKinds: null,
      selection: 'official_cycle',
    });
  });

  it('chooses a representative real cycle and keeps its printed order', () => {
    const row = (sourceExamId: string, orderIndex: number, year: number) => ({
      sourceExamId,
      orderIndex,
      year,
    });
    const selected = selectOfficialCycle([
      row('short-incomplete', 0, 2025),
      row('normal-old', 1, 2023), row('normal-old', 0, 2023), row('normal-old', 2, 2023),
      row('normal-new', 2, 2024), row('normal-new', 0, 2024), row('normal-new', 1, 2024),
      row('oversized', 0, 2022), row('oversized', 1, 2022), row('oversized', 2, 2022), row('oversized', 3, 2022), row('oversized', 4, 2022),
    ]);
    expect(selected.map((item) => [item.sourceExamId, item.orderIndex])).toEqual([
      ['normal-new', 0], ['normal-new', 1], ['normal-new', 2],
    ]);
  });

  it('rejects a whole paper when one of its exercises is unusable', () => {
    const selected = selectOfficialCycle([
      { sourceExamId: 'damaged', orderIndex: 0, year: 2025, usable: true },
      { sourceExamId: 'damaged', orderIndex: 1, year: 2025, usable: false },
      { sourceExamId: 'complete', orderIndex: 1, year: 2024, usable: true },
      { sourceExamId: 'complete', orderIndex: 0, year: 2024, usable: true },
    ]);
    expect(selected.map((item) => item.sourceExamId)).toEqual(['complete', 'complete']);
    expect(selected.map((item) => item.orderIndex)).toEqual([0, 1]);
  });
});
