import { describe, expect, it, vi } from 'vitest';

// The selector decides what can be shown; here it can show a figure for q-shown only.
vi.mock('@/lib/visual-evidence', () => ({
  visualKeysFor: vi.fn(async (qs: { id: string }[]) => new Map(qs.map((q) => [q.id, q.id === 'q-shown' ? ['crop.png'] : []]))),
}));
// q-pending has a crop on record that is not approved yet.
vi.mock('@/lib/db', () => ({
  db: {
    questionVisual: {
      findMany: vi.fn(async ({ where }: { where: { questionId: { in: string[] } } }) =>
        where.questionId.in.filter((id) => id === 'q-pending').map((questionId) => ({ questionId })),
      ),
    },
  },
}));

import { needsFigure, withShowableFigures } from '@/lib/exam-figure-gate';

describe('needsFigure', () => {
  it('spots a question that names a printed picture', () => {
    for (const text of [
      'Using figure 2, determine the period T.',
      'On considère le montage de la figure ci-contre.',
      'Consider the cube ABCDEFGH represented in the adjacent figure.',
      'On réalise le circuit série schématisé dans le document 4.',
      'اعتمادًا على الشكل 1، حدّد ...',
      'حدّد على الخريطة موقع ...',
    ]) {
      expect(needsFigure(text)).toBe(true);
    }
  });

  it('does not flag a curve the student draws, or a document that is text', () => {
    for (const text of [
      'Tracer la courbe (C) dans un repère orthonormé.',
      'Plot, on a graph paper, the curve pH = f(Vb).',
      'Soit f la fonction ... et (C) sa courbe représentative.',
      'En se référant au document 4, indiquer les effets négatifs.',
      'Lisez le document puis répondez aux questions.',
      'انطلاقًا من المستند، بيّن ...',
      'Solve the equation 2x + 3 = 7.',
    ]) {
      expect(needsFigure(text)).toBe(false);
    }
  });
});

describe('withShowableFigures', () => {
  it('drops a question whose figure cannot be shown, by its words or by a pending crop', async () => {
    const pool = [
      { id: 'q-plain', contentText: 'Solve 2x = 4.' },
      { id: 'q-draw', contentText: 'Tracer la courbe (C).' },
      { id: 'q-shown', contentText: 'Using figure 1, find v.' },
      { id: 'q-missing', contentText: 'Using figure 2, find a.' },
      { id: 'q-pending', contentText: 'Referring to document 3, explain.' },
    ];
    const out = await withShowableFigures(pool);
    expect(out.kept.map((q) => q.id)).toEqual(['q-plain', 'q-draw', 'q-shown']);
    expect(out.dropped).toBe(2);
  });
});
