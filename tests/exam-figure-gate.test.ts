import { describe, expect, it, vi } from 'vitest';

// The selector decides what can be shown; here it can show a figure for q-shown only.
vi.mock('@/lib/visual-evidence', () => ({
  visualKeysFor: vi.fn(async (qs: { id: string }[]) => new Map(qs.map((q) => [q.id, q.id === 'q-shown' ? ['crop.png'] : []]))),
}));

import { needsFigure, withShowableFigures } from '@/lib/exam-figure-gate';

describe('needsFigure', () => {
  it('spots a question that points at a printed figure', () => {
    for (const text of [
      'Using figure 2, determine the period T.',
      'La courbe ci-contre représente u(t).',
      'Tracer le graphe de f.',
      'Analyze document 3.',
      'اعتمادًا على الشكل 1، حدّد ...',
      'حدّد على الخريطة موقع ...',
    ]) {
      expect(needsFigure(text)).toBe(true);
    }
  });

  it('leaves questions that name a reading text or nothing at all', () => {
    for (const text of [
      'Solve the equation 2x + 3 = 7.',
      'Lisez le document puis répondez aux questions.',
      'انطلاقًا من المستند، بيّن ...',
      'Calculate the probability of drawing two red balls.',
    ]) {
      expect(needsFigure(text)).toBe(false);
    }
  });
});

describe('withShowableFigures', () => {
  it('drops only the questions whose figure cannot be shown', async () => {
    const pool = [
      { id: 'q-plain', contentText: 'Solve 2x = 4.' },
      { id: 'q-shown', contentText: 'Using figure 1, find v.' },
      { id: 'q-missing', contentText: 'Using figure 2, find a.' },
    ];
    const out = await withShowableFigures(pool);
    expect(out.kept.map((q) => q.id)).toEqual(['q-plain', 'q-shown']);
    expect(out.dropped).toBe(1);
  });
});
