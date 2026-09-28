import { describe, expect, it } from 'vitest';

import { hasCorruptByte } from '../scripts/corpus/book-exercise-guards';

/*
 * A NUL byte in an extracted exercise aborts the whole load — Postgres refuses
 * it with `invalid byte sequence for encoding "UTF8": 0x00`, and one bad reply
 * meant not a single exercise was written.
 *
 * The first two attempts at this check were both wrong, so the shape of the
 * mistake is pinned here rather than described in a comment.
 */
describe('holding an exercise whose reply came back corrupted', () => {
  it('finds the byte even though JSON.stringify escapes it', () => {
    // THE MISTAKE THAT COST TWO FAILED LOADS: `JSON.stringify` turns U+0000 into
    // the six characters \u0000, so a check comparing against a literal NUL
    // never matches and the load aborts again looking fixed.
    const exercise = { text: 'Le 2-ph\u0000nyl\u0000thanol est', held: [] };
    expect(JSON.stringify(exercise)).not.toContain('\u0000');
    expect(hasCorruptByte(exercise)).toBe(true);
  });

  it('finds it wherever it sits in the exercise, not just in the text', () => {
    expect(hasCorruptByte({ text: 'fine', section: 'EXERCI\u0000ES' })).toBe(true);
    expect(hasCorruptByte({ parts: [{ a: 'ok' }, { b: 'b\u0000d' }] })).toBe(true);
  });

  it('leaves a clean exercise alone, accents and LaTeX included', () => {
    // The corrupted rows read "pr\0sente" for "présente": the accented letter is
    // exactly what goes missing, so accented text must not itself look corrupt.
    expect(hasCorruptByte({ text: 'Le 2-phényléthanol est présent dans l’huile.' })).toBe(false);
    expect(hasCorruptByte({ text: 'Calculer $\\frac{1}{2}$ et $\\mathrm{C}_3$.' })).toBe(false);
  });

  it('does not mistake the written escape for the byte', () => {
    // A statement that literally spells out \u0000 — a question about encodings,
    // say — carries no NUL and must load.
    expect(hasCorruptByte({ text: String.raw`The escape \u0000 denotes NUL.` })).toBe(false);
  });
});
