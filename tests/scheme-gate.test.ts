import { describe, expect, it } from 'vitest';

import { verify, exerciseOf } from '../scripts/corpus/read-schemes';

type Row = { exercise: string; label: string; answer: string; marks: number | null };

const PAPER = [
  { index: 1, marks: 6.5, parts: [] },
  { index: 2, marks: 7.5, parts: [] },
  { index: 3, marks: 6.0, parts: [] },
];

/** A maths-style scheme: a mark column, printed on twice the paper's scale. */
function marked(): Row[] {
  return [
    { exercise: '1', label: '1', answer: 'a', marks: 6.5 },
    { exercise: '1', label: '2', answer: 'b', marks: 6.5 },
    { exercise: '2', label: '1', answer: 'c', marks: 15 },
    { exercise: '3', label: '1', answer: 'd', marks: 12 },
  ];
}

/** A chemistry-style scheme: expected answers and remarks, no mark column. */
function answersOnly(): Row[] {
  return [
    { exercise: '1', label: 'I-1', answer: 'Le matériel utilisé comporte la pipette...', marks: null },
    { exercise: '2', label: 'II-1', answer: 'À l équivalence, on a n CH3COOH...', marks: null },
    { exercise: '3', label: 'I-1', answer: 'Éthanoate de propyle et propanamide.', marks: null },
  ];
}

describe('the marked shape', () => {
  it('accepts a scheme whose exercises agree on one scale', () => {
    const v = verify(marked(), PAPER);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.shape).toBe('marked');
      expect(v.ratio).toBeCloseTo(2, 5);
    }
  });
});

describe('the answers-only shape', () => {
  it('is accepted rather than thrown away for having no marks', () => {
    // This is the regression. A chemistry scheme prints
    // "Réponses attendues | Remarques" and no mark column, and the first cut of
    // this gate refused every one of them — discarding official answers in the
    // subject where answers are scarcest.
    const v = verify(answersOnly(), PAPER);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.shape).toBe('answers');
  });

  it('carries no barème, so the paper keeps the one it had', () => {
    const v = verify(answersOnly(), PAPER);
    expect(v.ok).toBe(true);
    // ratio is meaningless without marks and must not scale anything.
    if (v.ok) expect(v.ratio).toBe(1);
  });

  it('is refused when it covers too little of the paper', () => {
    const thin = [answersOnly()[0]!];
    const v = verify(thin, PAPER);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/covers 1\/3/);
  });

  it('still requires answer text', () => {
    const empty = answersOnly().map((r) => ({ ...r, answer: '   ' }));
    expect(verify(empty, PAPER).ok).toBe(false);
  });
});

describe('the phantom-exercise check, which applies to both shapes', () => {
  it('refuses a scheme naming an exercise the paper does not have', () => {
    // A page of the question paper read as a scheme produces exactly this.
    const rows = [...answersOnly(), { exercise: '7', label: '1', answer: 'x', marks: null }];
    const v = verify(rows, PAPER);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/does not have: 7/);
  });

  it('applies to marked schemes too', () => {
    const rows = [...marked(), { exercise: '9', label: '1', answer: 'x', marks: 4 }];
    expect(verify(rows, PAPER).ok).toBe(false);
  });
});

describe('exerciseOf', () => {
  it('reads the numbering these papers use', () => {
    expect(exerciseOf('Q 1')).toBe('1');
    expect(exerciseOf('Exercise II')).toBe('2');
    expect(exerciseOf('التمرين الثاني')).toBe('2');
  });
});

describe('telling an under-parsed paper from a misread scheme', () => {
  const FULL = [
    { index: 1, marks: 7, parts: [] },
    { index: 2, marks: 7, parts: [] },
    { index: 3, marks: 6, parts: [] },
  ];
  const SHORT = [
    { index: 1, marks: 6.5, parts: [] },
    { index: 2, marks: 7.5, parts: [] },
  ];
  const rowsNamingFour: Row[] = [
    { exercise: '1', label: '1', answer: 'a', marks: null },
    { exercise: '2', label: '1', answer: 'b', marks: null },
    { exercise: '4', label: '1', answer: 'c', marks: null },
  ];

  it('blames the scheme when the paper already totals twenty', () => {
    const v = verify(rowsNamingFour, FULL);
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.reason).toMatch(/scheme names exercise/);
      expect(v.reason).not.toMatch(/under-parsed/);
    }
  });

  it('blames the parse when the paper falls short of twenty', () => {
    // gs/2004 2/chem_fr.pdf: parsed 6.5 + 7.5 = 14, scheme prints a third
    // exercise worth 6. The scheme is right and the extractor missed one.
    const v = verify([{ exercise: '3', label: '1', answer: 'c', marks: null }], SHORT);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/under-parsed: it totals 14\/20/);
  });
});
