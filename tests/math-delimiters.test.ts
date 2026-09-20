import { describe, expect, it } from 'vitest';

import { normalizeMathDelimiters } from '@/lib/math-delimiters';

/**
 * A physics answer that rendered perfectly for half a screen and then turned
 * into source, 2026-09-20. The model derived eleven parts correctly and reached
 * for `\[ \boxed{…} \]` on the results it cared most about; `remark-math` knows
 * only dollars, so the bracket was left as text and every `$` after it paired
 * one step out of phase.
 */

describe('bracket delimiters become dollars', () => {
  it('converts display brackets', () => {
    const out = normalizeMathDelimiters(String.raw`We get: \[ \boxed{ I_m = \frac{U_m}{R} } \]`);
    expect(out).toContain('$$');
    expect(out).not.toContain('\\[');
    expect(out).not.toContain('\\]');
    expect(out).toContain('\\boxed{ I_m = \\frac{U_m}{R} }');
  });

  it('converts inline parentheses', () => {
    const out = normalizeMathDelimiters(String.raw`the value \( R = 10 \) ohms`);
    expect(out).toBe('the value $ R = 10 $ ohms');
  });

  /**
   * `\\[2pt]` is a LaTeX line break with spacing, not the start of display
   * maths. Rewriting its bracket would break the matrix it belongs to, and the
   * damage would show up only on the questions that use arrays.
   */
  it('leaves a LaTeX line break alone', () => {
    const matrix = String.raw`$$\begin{matrix} a \\[2pt] b \end{matrix}$$`;
    expect(normalizeMathDelimiters(matrix)).toBe(matrix);

    const plain = String.raw`$$x \\ y$$`;
    expect(normalizeMathDelimiters(plain)).toBe(plain);
  });
});

describe('display dollars written mid-sentence', () => {
  /**
   * `$$` is display maths, which `remark-math` wants alone on its line. Written
   * inside a sentence it is not a block, so it is not parsed, and the student
   * reads the dollars.
   */
  it('becomes inline maths rather than staying as text', () => {
    const out = normalizeMathDelimiters('Since $$x = 1,$$ we get the result.');
    expect(out).toBe('Since $x = 1,$ we get the result.');
  });

  it('handles a span with prose only after it', () => {
    const out = normalizeMathDelimiters('$$P = UI$$ is the power.');
    expect(out).toBe('$P = UI$ is the power.');
  });

  it('leaves a real display block alone', () => {
    // Delimiters on their own lines: this is what remark-math wants, and it
    // must survive untouched or every correctly-written formula is demoted.
    const block = 'The expression is:\n\n$$\nP = UI\n$$\n\nwhich follows.';
    expect(normalizeMathDelimiters(block)).toBe(block);
  });

  it('leaves ordinary inline maths alone', () => {
    const text = 'where $R = 10\\ \\Omega$ and $C$ is the capacitance.';
    expect(normalizeMathDelimiters(text)).toBe(text);
  });
});

describe('the reported failure', () => {
  it('no longer leaves bare LaTeX in the middle of an answer', () => {
    const broken = String.raw`Since $$A = \left(\frac{1}{C\omega}-L\omega\right)^2,$$ we get: \[ \boxed{ I_m = \frac{U_m}{\sqrt{R^2+A^2}} } \] --- ## d) Deduction`;
    const out = normalizeMathDelimiters(broken);

    // Nothing the renderer cannot read is left behind.
    expect(out).not.toContain('\\[');
    expect(out).not.toContain('\\]');
    // The mid-sentence display span is now inline, so the sentence survives.
    expect(out).toContain('Since $A = \\left(\\frac{1}{C\\omega}-L\\omega\\right)^2,$ we get:');
    // And the boxed result is a real display block.
    expect(out).toMatch(/\$\$\n\s*\\boxed/);
  });

  it('is a no-op on text with no maths at all', () => {
    const prose = 'Explain the photoelectric effect in your own words.';
    expect(normalizeMathDelimiters(prose)).toBe(prose);
    expect(normalizeMathDelimiters('')).toBe('');
  });
});
