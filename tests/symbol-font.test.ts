import { describe, expect, it } from 'vitest';

import { hasSymbolFontDamage, repairSymbolFont } from '@/lib/symbol-font';

/**
 * Recovering the symbols Lebanese papers stored as private-use codepoints.
 *
 * Every case here is a real string from the corpus, or the real codepoint with
 * its real neighbours. A wrong mapping does not throw — it silently prints a
 * different equation to a student sitting a national exam — so the mapping is
 * pinned symbol by symbol.
 */

const pua = (byte: number) => String.fromCodePoint(0xf000 + byte);

describe('the symbols that prompted this', () => {
  it('turns U+F044 back into Δ — 1,195 deltas that showed as nothing', () => {
    expect(repairSymbolFont(`${pua(0x44)}m = m_before - m_after`)).toBe('Δm = m_before - m_after');
  });

  it('turns U+F0A5 back into ∞, in the phrase it appears in', () => {
    expect(repairSymbolFont(`asymptote à (C) en +${pua(0xa5)}`)).toBe('asymptote à (C) en +∞');
  });

  it('recovers the operators that carry an equation', () => {
    expect(repairSymbolFont(pua(0x3d))).toBe('=');
    expect(repairSymbolFont(pua(0x2d))).toBe('−');
    expect(repairSymbolFont(pua(0xb4))).toBe('×');
    expect(repairSymbolFont(pua(0xb8))).toBe('÷');
    expect(repairSymbolFont(pua(0xa3))).toBe('≤');
    expect(repairSymbolFont(pua(0xb3))).toBe('≥');
    expect(repairSymbolFont(pua(0xae))).toBe('→');
  });

  it('recovers the Greek an exam paper actually uses', () => {
    expect(repairSymbolFont(pua(0x70))).toBe('π');
    expect(repairSymbolFont(pua(0x6c))).toBe('λ');
    expect(repairSymbolFont(pua(0x71))).toBe('θ');
    expect(repairSymbolFont(pua(0x61))).toBe('α');
    expect(repairSymbolFont(pua(0x57))).toBe('Ω');
    expect(repairSymbolFont(pua(0x53))).toBe('Σ');
  });

  it('recovers set notation, which philosophy and maths both print', () => {
    expect(repairSymbolFont(pua(0xce))).toBe('∈');
    expect(repairSymbolFont(pua(0xc8))).toBe('∪');
    expect(repairSymbolFont(pua(0xc7))).toBe('∩');
    expect(repairSymbolFont(pua(0xd6))).toBe('√');
    expect(repairSymbolFont(pua(0xf2))).toBe('∫');
  });
});

describe('what it refuses to invent', () => {
  it('drops a bracket PIECE rather than substituting a whole bracket', () => {
    /*
     * 0xE6 and 0xE8 are the top and bottom thirds of one tall parenthesis.
     * Mapping each to "(" turns a single bracket into two, which reads as an
     * expression the examiner never wrote.
     */
    expect(repairSymbolFont(`${pua(0xe6)}x${pua(0xe8)}`)).toBe('x');
  });

  it('drops the invisible operators that break KaTeX inside a formula', () => {
    // U+2061 FUNCTION APPLICATION: meaningful to a layout engine, a parse error
    // to KaTeX, and invisible to a reader either way.
    expect(repairSymbolFont('\\frac{2}{\u2061-\u2061xe-x}')).toBe('\\frac{2}{-xe-x}');
  });

  it('passes ordinary text through untouched, Arabic included', () => {
    const text = 'الاستعارة في النص — f(x) = 3x² + 9x + 1';
    expect(repairSymbolFont(text)).toBe(text);
  });

  it('leaves a real Unicode Δ alone rather than double-mapping it', () => {
    expect(repairSymbolFont('Δm = 5')).toBe('Δm = 5');
  });
});

describe('knowing whether there is anything to do', () => {
  it('reports damage only when there is some', () => {
    expect(hasSymbolFontDamage(`E = mc² ${pua(0x44)}`)).toBe(true);
    expect(hasSymbolFontDamage('E = mc²')).toBe(false);
    expect(hasSymbolFontDamage('\u2061')).toBe(true);
  });
});
