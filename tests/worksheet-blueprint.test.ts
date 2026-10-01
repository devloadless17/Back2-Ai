import { describe, expect, it } from 'vitest';

import {
  followsWorksheetBlueprint,
  hasBrokenWorksheetBoundaries,
  repairWorksheetBoundaries,
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

  it('prefers a complete 2024 paper over a representative older paper', () => {
    const selected = selectOfficialCycle([
      { sourceExamId: 'older', orderIndex: 0, year: 2023, usable: true },
      { sourceExamId: 'older', orderIndex: 1, year: 2023, usable: true },
      { sourceExamId: 'older', orderIndex: 2, year: 2023, usable: true },
      { sourceExamId: 'preferred', orderIndex: 1, year: 2024, usable: true },
      { sourceExamId: 'preferred', orderIndex: 0, year: 2024, usable: true },
    ]);
    expect(selected.map((item) => item.sourceExamId)).toEqual(['preferred', 'preferred']);
    expect(selected.map((item) => item.orderIndex)).toEqual([0, 1]);
  });

  it('falls back when the 2024 paper is damaged', () => {
    const selected = selectOfficialCycle([
      { sourceExamId: 'preferred', orderIndex: 0, year: 2024, usable: true },
      { sourceExamId: 'preferred', orderIndex: 1, year: 2024, usable: false },
      { sourceExamId: 'fallback', orderIndex: 0, year: 2023, usable: true },
      { sourceExamId: 'fallback', orderIndex: 1, year: 2023, usable: true },
    ]);
    expect(selected.map((item) => item.sourceExamId)).toEqual(['fallback', 'fallback']);
  });

  it('detects OCR rows that contain a later official section heading', () => {
    expect(
      hasBrokenWorksheetBoundaries(
        `${'A company exercise with its own questions. '.repeat(8)}\nIV- Logarithm and economic functions (5 points)`,
      ),
    ).toBe(true);
    expect(
      hasBrokenWorksheetBoundaries('IV- Logarithm and economic functions (5 points)\n1) Calculate the result.'),
    ).toBe(false);
  });

  it('splits merged sections and carries an orphan heading to its body', () => {
    const rows = repairWorksheetBoundaries([
      {
        id: 'first',
        contentText: `${'Section III body. '.repeat(10)}\nIV- Logarithms (5 points)\n${'Question table. '.repeat(12)}\nV- Supply and demand (5 points)`,
      },
      { id: 'second', contentText: 'A company produces units. Calculate the market equilibrium.' },
    ]);
    expect(rows).toHaveLength(3);
    expect(rows[0]!.contentText).toContain('Section III body');
    expect(rows[0]!.contentText).not.toContain('IV-');
    expect(rows[1]!.contentText).toMatch(/^IV-/);
    expect(rows[1]!.contentText).not.toMatch(/(?:^|\n)V-/);
    expect(rows[2]!.contentText).toMatch(/^V- Supply and demand/);
    expect(rows[2]!.contentText).toContain('A company produces units');
  });
});
