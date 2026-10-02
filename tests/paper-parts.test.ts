import { describe, expect, it } from 'vitest';

import { formatMarks, paperPartsOf, partMarkdown } from '@/lib/paper-parts';
import { normalizeMathDelimiters } from '@/lib/math-delimiters';

import { renderProblem } from '../scripts/corpus/render-gate';

/**
 * An exercise as its printed parts, each with its own official answer.
 *
 * `questions.paper_parts` is JSON written by a corpus loader, so the page
 * reads it through `paperPartsOf`, which must turn anything malformed into
 * "no parts" — the page then shows the exercise as one block, as it always did.
 */
describe('paperPartsOf', () => {
  it('reads the stored shape', () => {
    const got = paperPartsOf({
      intro: 'Exercise 2 (8 points)',
      parts: [
        { label: '1', text: '1) Redraw the circuit.', marks: 0.25, answer: '![](/answer-figures/x.png)' },
        { label: '2', text: '2) Refer to document 4 to:' },
      ],
      run: 'abc',
    });
    expect(got?.parts).toHaveLength(2);
    expect(got?.parts[0]).toMatchObject({ marks: 0.25, answer: '![](/answer-figures/x.png)' });
    expect(got?.parts[1]).not.toHaveProperty('answer');
  });

  it('treats anything malformed as no parts', () => {
    expect(paperPartsOf(null)).toBeNull();
    expect(paperPartsOf({ intro: 'x', parts: [] })).toBeNull();
    expect(paperPartsOf({ parts: [{ label: 1, text: 'x' }] })).toBeNull();
    expect(paperPartsOf('parts')).toBeNull();
  });

  it('drops an empty answer and a mark that is not a number', () => {
    const got = paperPartsOf({ parts: [{ label: '1', text: 't', answer: '  ', marks: 'one' }] });
    expect(got?.parts[0]).toEqual({ label: '1', text: 't' });
  });
});

describe('partMarkdown', () => {
  /*
   * "1) Redraw" is an ordered list item to Markdown, and the page sets lists
   * without markers, so the part lost its number. The first fix wrote "1\)",
   * which the viewer's delimiter repair turns into "1$" — a formula opening
   * mid-sentence. Both are pinned here.
   */
  it('keeps the printed label as text', () => {
    expect(partMarkdown('1) Redraw the circuit.')).toBe('1&#41; Redraw the circuit.');
    expect(partMarkdown('2. Deduce')).toBe('2&#46; Deduce');
  });

  it('does not open a formula through the delimiter repair', () => {
    const shown = normalizeMathDelimiters(partMarkdown('3) Write down the expression of i.'));
    expect(shown).not.toContain('$');
    expect(renderProblem(partMarkdown('3) Write down $i(t)$.'))).toBeNull();
  });

  it('leaves labels that are not list markers alone', () => {
    expect(partMarkdown('2-1) show that waveform (a) represents $u_G$;')).toBe(
      '2-1) show that waveform (a) represents $u_G$;',
    );
    expect(partMarkdown('a - Calculer u2')).toBe('a - Calculer u2');
  });
});

describe('formatMarks', () => {
  it('prints a mark the way the paper does', () => {
    expect(formatMarks(0.75)).toBe('0.75');
    expect(formatMarks(1)).toBe('1');
    expect(formatMarks(1.5)).toBe('1.5');
    expect(formatMarks(0.1 + 0.2)).toBe('0.3');
  });
});

describe('a sub-answer that opens display maths', () => {
  // "**a)** $$" on one line is not display maths to Markdown: the formula
  // arrived as raw LaTeX in red. The builder puts the label on its own line.
  it('renders when the label stands on its own line', () => {
    const formula = '$$\n\\begin{aligned}\n& u_2 = F(3) - F(2)\n\\end{aligned}\n$$';
    expect(renderProblem(`**a)**\n\n${formula}`)).toBeNull();
    expect(renderProblem(`**a)** ${formula}`)).not.toBeNull();
  });
});
