import { describe, expect, it } from 'vitest';

import { bodyToRender } from '@/components/ui/math';

/**
 * Which stored body a question renders from.
 *
 * 122 questions in this corpus carry U+FFFD in `content_latex` — bytes that
 * could not be decoded when the paper was read. 119 of them have a clean
 * `content_text` beside them, and the component preferred the LaTeX
 * unconditionally, so a student was shown
 *
 *   f '(x) = –������–������ – (–������ – 2)������
 *
 * while the readable copy sat in the next column. The strings below are the
 * shape of that real damage, not an invented one.
 */

const BROKEN_LATEX =
  "f '(x) = ���� - (��� - 2)���";
const CLEAN_TEXT =
  "f '(x) = -e^{-x} - (-e^{-x} - 2)e^{-x}. Then y=2 is a horizontal asymptote to (C) at +infinity.";

describe('a damaged LaTeX body', () => {
  it('falls back to the plain text when that is clean', () => {
    expect(bodyToRender(BROKEN_LATEX, CLEAN_TEXT)).toBe(CLEAN_TEXT);
  });

  it('still shows the LaTeX when the plain text is damaged too', () => {
    // 3 of the 122 are broken in both. There is nothing better to show, and
    // showing nothing would be worse than showing what the paper gave us.
    const alsoBroken = 'f(x) = ���';
    expect(bodyToRender(BROKEN_LATEX, alsoBroken)).toBe(BROKEN_LATEX);
  });

  it('does not fall back to an empty plain text', () => {
    expect(bodyToRender(BROKEN_LATEX, '')).toBe(BROKEN_LATEX);
  });
});

describe('an intact body is left alone', () => {
  it('prefers the LaTeX, which is the point of storing it', () => {
    const latex = '$f(x) = \\frac{2}{3}\\sqrt{9-x^{2}}$';
    expect(bodyToRender(latex, 'f(x) = 2/3 sqrt(9 - x^2)')).toBe(latex);
  });

  it('uses the text when there is no LaTeX at all', () => {
    expect(bodyToRender(null, CLEAN_TEXT)).toBe(CLEAN_TEXT);
    expect(bodyToRender(undefined, CLEAN_TEXT)).toBe(CLEAN_TEXT);
    expect(bodyToRender('', CLEAN_TEXT)).toBe(CLEAN_TEXT);
  });

  it('does not mistake Arabic or maths symbols for damage', () => {
    // The guard must key on U+FFFD alone. Private-use codepoints are a
    // different failure with a different fix — `repairSymbolFont` puts those
    // back, and treating them as undecodable would throw away a body that is
    // about to be repaired.
    const symbolFont = 'a = v / t';
    expect(bodyToRender(symbolFont, 'plain')).toBe(symbolFont);

    const arabic = 'احسب $f(x)$ عند $x=0$';
    expect(bodyToRender(arabic, 'plain')).toBe(arabic);
  });
});
