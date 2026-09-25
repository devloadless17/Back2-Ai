import { describe, expect, it } from 'vitest';

import { unwrapSoftBreaks } from '../src/lib/soft-wrap';

/*
 * The stored text carries a newline at every printed line-wrap, and the viewer
 * renders each one as a hard break. Those newlines carry two different things
 * at once — a paragraph the PDF wrapped at the margin, and a numbered part the
 * author put on its own line — so the fix has to tell them apart. `remarkBreaks`
 * exists to protect the second kind and these tests exist to prove it still is.
 */
describe('rejoining lines a PDF broke mid-sentence', () => {
  it('joins a line that ends mid-sentence', () => {
    // The 2019 LH chemistry paper, as a student met it.
    const text =
      'To function normally, the body needs a steady supply of energy. Some of this energy must\ncome from glucose.';
    expect(unwrapSoftBreaks(text)).toBe(
      'To function normally, the body needs a steady supply of energy. Some of this energy must come from glucose.',
    );
  });

  it('leaves a break after a full stop alone', () => {
    // It may be the author's. A paper printing one sentence per line reads fine.
    const text =
      'However, if energy stores are not refilled then the body weight will decrease.\nIf no food is eaten, glycogen stores provide glucose.';
    expect(unwrapSoftBreaks(text)).toBe(text);
  });

  it('never swallows a numbered part, which is the whole reason remarkBreaks is on', () => {
    const text =
      'Referring to the text above, answer each of the following questions in order\n1- Indicate the two sources of energy between meals.\n2- Copy and complete the table.';
    expect(unwrapSoftBreaks(text)).toBe(text);
  });

  it('leaves a title on its own line', () => {
    // A short line was never wrapped: the PDF breaks at the margin, so a line
    // that stopped early stopped because the author stopped.
    expect(unwrapSoftBreaks('Parkinson Disease\nDocument 1')).toBe('Parkinson Disease\nDocument 1');
  });

  it('does not touch a table, where a newline is a row', () => {
    const text = '| Year | Mass |\n| --- | --- |\n| 1997 | 20% |';
    expect(unwrapSoftBreaks(text)).toBe(text);
  });

  it('does not reach inside display maths', () => {
    const text =
      'Consider the function f defined over the interval and denote by C its representative\n$$\nf(x) = e^{0.5x} - 1\n$$\ncurve.';
    expect(unwrapSoftBreaks(text)).toBe(text);
  });

  it('keeps blank lines, which are paragraph breaks', () => {
    const text = 'A'.repeat(60) + '\n\n' + 'B'.repeat(60);
    expect(unwrapSoftBreaks(text)).toBe(text);
  });

  it('creates and destroys no words', () => {
    // "store d" is an OCR defect in the text layer. Joining must not invent
    // "stored", and must not delete the stray letter either — repairing it is
    // the extractor's job, and a renderer that guesses would hide the damage.
    const text =
      'Between meals, the breakdown of glycogen provides glucose and the breakdown of store d\nfat meets other energy needs.';
    const out = unwrapSoftBreaks(text);
    expect(out).toContain('store d fat');
    expect(out.replace(/\s+/g, ' ')).toBe(text.replace(/\s+/g, ' '));
  });
});
