import { describe, expect, it } from 'vitest';

import { canonicalJson, secondPassOrdinals } from '../scripts/corpus/visual-backfill-rules';

/**
 * The backfill's pure rules. The full idempotence and rollback proofs run
 * against a disposable database (see the C5B report); these pin the two rules
 * whose failure would be silent.
 */
const ex = (...marks: Array<number | null>) => marks.map((m) => ({ marks: m }));

describe('secondPassOrdinals', () => {
  it('flags a scheme that repeats the exercise marks (ls/2006 1/bio_en.pdf: 3,4,5,8,3,4,5,8)', () => {
    expect([...secondPassOrdinals(ex(3, 4, 5, 8, 3, 4, 5, 8))].sort()).toEqual([5, 6, 7, 8]);
  });

  it('does not flag papers whose exercises merely share marks', () => {
    expect(secondPassOrdinals(ex(5, 5, 5, 5, 5, 5)).size).toBe(0);
  });

  it('needs a run of at least three', () => {
    expect(secondPassOrdinals(ex(3, 4, 3, 4)).size).toBe(0);
  });

  it('ignores runs with unknown marks', () => {
    expect(secondPassOrdinals(ex(3, null, 5, 3, null, 5)).size).toBe(0);
  });
});

describe('canonicalJson', () => {
  it('treats jsonb key reordering as no change', () => {
    const planned = [{ label: '2.1', labelOccurrence: 0, fingerprint: 'en se referant au document 1' }];
    const stored = [{ fingerprint: 'en se referant au document 1', label: '2.1', labelOccurrence: 0 }];
    expect(canonicalJson(stored)).toBe(canonicalJson(planned));
  });

  it('still sees a real change', () => {
    expect(canonicalJson([{ label: '2.1' }])).not.toBe(canonicalJson([{ label: '2.2' }]));
  });
});
