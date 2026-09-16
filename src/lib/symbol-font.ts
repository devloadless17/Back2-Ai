/**
 * Recovers the mathematical symbols a PDF stored as private-use codepoints.
 *
 * WHAT WENT WRONG IN THE PAPERS. Lebanese exam papers set their mathematics in
 * the Adobe Symbol font, and a PDF that embeds Symbol writes each glyph at
 * `0xF000 + its byte` — inside the Unicode Private Use Area, which by definition
 * has no standard meaning. Extraction preserved those codepoints faithfully and
 * they are, to everything downstream, unmappable garbage: a blank box on screen,
 * a parse error inside `$…$`, and noise in an embedding.
 *
 * It is not a corner case. 891 of the 1,158 questions carrying LaTeX contain
 * them, and 242 of 3,324 mathematics spans fail to render because of them. The
 * single most common is U+F03D, which is `=`. The one that prompted this work is
 * U+F044, which is Δ — 1,195 occurrences of a delta that showed as nothing.
 *
 * THE MAPPING IS THE PUBLISHED ADOBE SYMBOL ENCODING, not a guess, and the
 * corpus confirms it in context: U+F0A5 appears in "asymptote à (C) en +␣",
 * which is `+∞`; U+F044 in "␣m = m_before − m_after", which is `Δm`.
 *
 * WHAT IS DELIBERATELY NOT MAPPED. The bracket-piece glyphs (0xE6-0xEF,
 * 0xF6-0xFE) are the top, middle and bottom THIRDS of a large parenthesis or
 * brace, stacked vertically in the original layout. There is no single character
 * that means "the top third of a bracket", and substituting a whole "(" for each
 * piece would turn one tall bracket into three short ones. They are dropped
 * instead: a missing bracket is visibly missing, where three spurious ones read
 * as an expression the examiner never wrote.
 */

/**
 * Adobe Symbol, byte to Unicode. Index is the low byte of the private-use
 * codepoint, so U+F044 is looked up at 0x44.
 */
const SYMBOL: Record<number, string> = {
  0x22: '∀', 0x24: '∃', 0x27: '∋', 0x2a: '∗', 0x2d: '−', 0x40: '≅',
  // Greek capitals.
  0x41: 'Α', 0x42: 'Β', 0x43: 'Χ', 0x44: 'Δ', 0x45: 'Ε', 0x46: 'Φ', 0x47: 'Γ',
  0x48: 'Η', 0x49: 'Ι', 0x4a: 'ϑ', 0x4b: 'Κ', 0x4c: 'Λ', 0x4d: 'Μ', 0x4e: 'Ν',
  0x4f: 'Ο', 0x50: 'Π', 0x51: 'Θ', 0x52: 'Ρ', 0x53: 'Σ', 0x54: 'Τ', 0x55: 'Υ',
  0x56: 'ς', 0x57: 'Ω', 0x58: 'Ξ', 0x59: 'Ψ', 0x5a: 'Ζ',
  0x5c: '∴', 0x5e: '⊥', 0x60: '‾',
  // Greek lower case.
  0x61: 'α', 0x62: 'β', 0x63: 'χ', 0x64: 'δ', 0x65: 'ε', 0x66: 'φ', 0x67: 'γ',
  0x68: 'η', 0x69: 'ι', 0x6a: 'ϕ', 0x6b: 'κ', 0x6c: 'λ', 0x6d: 'μ', 0x6e: 'ν',
  0x6f: 'ο', 0x70: 'π', 0x71: 'θ', 0x72: 'ρ', 0x73: 'σ', 0x74: 'τ', 0x75: 'υ',
  0x76: 'ϖ', 0x77: 'ω', 0x78: 'ξ', 0x79: 'ψ', 0x7a: 'ζ', 0x7e: '∼',
  // Operators and relations.
  0xa1: 'ϒ', 0xa2: '′', 0xa3: '≤', 0xa4: '⁄', 0xa5: '∞', 0xa6: 'ƒ',
  0xab: '↔', 0xac: '←', 0xad: '↑', 0xae: '→', 0xaf: '↓',
  0xb0: '°', 0xb1: '±', 0xb2: '″', 0xb3: '≥', 0xb4: '×', 0xb5: '∝', 0xb6: '∂',
  0xb7: '•', 0xb8: '÷', 0xb9: '≠', 0xba: '≡', 0xbb: '≈', 0xbc: '…',
  0xc0: 'ℵ', 0xc1: 'ℑ', 0xc2: 'ℜ', 0xc3: '℘', 0xc4: '⊗', 0xc5: '⊕', 0xc6: '∅',
  0xc7: '∩', 0xc8: '∪', 0xc9: '⊃', 0xca: '⊇', 0xcb: '⊄', 0xcc: '⊂', 0xcd: '⊆',
  0xce: '∈', 0xcf: '∉',
  0xd0: '∠', 0xd1: '∇', 0xd5: '∏', 0xd6: '√', 0xd7: '⋅', 0xd8: '¬', 0xd9: '∧',
  0xda: '∨', 0xdb: '⇔', 0xdc: '⇐', 0xdd: '⇑', 0xde: '⇒', 0xdf: '⇓',
  0xe0: '◊', 0xe1: '⟨', 0xe5: '∑', 0xf1: '⟩', 0xf2: '∫',
};

/**
 * Codepoints that are a PIECE of a taller glyph, dropped rather than mapped.
 * See the note above on why substituting a whole bracket is worse than nothing.
 */
const BRACKET_PIECES = new Set([
  0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xeb, 0xec, 0xed, 0xee, 0xef,
  0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa, 0xfb, 0xfc, 0xfd, 0xfe,
]);

/** True when the text holds anything this module would change. */
export function hasSymbolFontDamage(text: string): boolean {
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code >= 0xe000 && code <= 0xf8ff) return true;
    // Invisible maths operators. Meaningful to a layout engine, meaningless to
    // a reader, and a parse error to KaTeX inside a formula.
    if (code >= 0x2061 && code <= 0x2064) return true;
  }
  return false;
}

/**
 * The same text with its Symbol-font codepoints turned back into mathematics.
 *
 * A private-use codepoint with no entry in the table is DROPPED, not kept.
 * Keeping it preserves a character that renders as a blank box and breaks a
 * formula; dropping it loses a symbol nobody could read anyway. Neither is good
 * and the second is quieter about it — which is why `check:math-rendering`
 * exists to say how much is still failing after this runs.
 */
export function repairSymbolFont(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0)!;

    if (code >= 0x2061 && code <= 0x2064) continue;

    if (code >= 0xe000 && code <= 0xf8ff) {
      const low = code & 0xff;
      if (BRACKET_PIECES.has(low)) continue;
      const mapped = SYMBOL[low];
      if (mapped !== undefined) {
        out += mapped;
        continue;
      }
      // Symbol's digits, letters and ASCII punctuation sit at their own byte
      // values, so an unmapped byte in the printable ASCII range is simply that
      // character. Anything else is a glyph this table does not know.
      if (low >= 0x20 && low <= 0x7e) {
        out += String.fromCharCode(low);
        continue;
      }
      continue;
    }

    out += ch;
  }
  return out;
}
