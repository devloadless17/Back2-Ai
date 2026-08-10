import { describe, expect, it } from 'vitest';

import { baremeMaxScore, parseBareme, parseBaremeResult } from '@/lib/grading';

describe('parseBareme', () => {
  it('accepts a well-formed barème', () => {
    const bareme = parseBareme([
      { criterion: 'Sets up the integral correctly', points: 2 },
      { criterion: 'Correct final value with units', points: 1.5 },
    ]);

    expect(bareme).toHaveLength(2);
    expect(bareme?.[0]?.points).toBe(2);
  });

  it('rejects malformed JSONB rather than half-reading it', () => {
    expect(parseBareme(null)).toBeNull();
    expect(parseBareme([])).toBeNull();
    expect(parseBareme([{ criterion: 'missing points' }])).toBeNull();
    expect(parseBareme([{ criterion: 'negative', points: -1 }])).toBeNull();
    expect(parseBareme('not an array')).toBeNull();
  });
});

describe('baremeMaxScore', () => {
  it('totals the criteria', () => {
    expect(
      baremeMaxScore([
        { criterion: 'a', points: 2 },
        { criterion: 'b', points: 1.5 },
        { criterion: 'c', points: 0.5 },
      ]),
    ).toBe(4);
  });

  it('rounds to two decimals so half marks do not accumulate float noise', () => {
    expect(
      baremeMaxScore([
        { criterion: 'a', points: 0.1 },
        { criterion: 'b', points: 0.2 },
      ]),
    ).toBe(0.3);
  });
});

describe('parseBaremeResult', () => {
  it('returns an empty list for absent or malformed results', () => {
    expect(parseBaremeResult(null)).toEqual([]);
    expect(parseBaremeResult([{ criterion: 'a' }])).toEqual([]);
  });

  it('reads a stored marking result back', () => {
    const results = parseBaremeResult([
      { criterion: 'a', points_awarded: 1, points_possible: 2, justification: 'Partly right.' },
    ]);
    expect(results).toHaveLength(1);
    expect(results[0]?.points_awarded).toBe(1);
  });
});
