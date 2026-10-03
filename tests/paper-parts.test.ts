import { describe, expect, it } from 'vitest';

import { formatMarks, paperPartAnswerIsUsable, paperPartsOf, partMarkdown, partOnlyHeads } from '@/lib/paper-parts';
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
        { label: '2', text: '2) Refer to document 4 to:', answerImage: '/answer-figures/key-row.png' },
      ],
      run: 'abc',
    });
    expect(got?.parts).toHaveLength(2);
    expect(got?.parts[0]).toMatchObject({ marks: 0.25, answer: '![](/answer-figures/x.png)' });
    expect(got?.parts[1]).not.toHaveProperty('answer');
    expect(got?.parts[1]).toMatchObject({ answerImage: '/answer-figures/key-row.png' });
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

  it('accepts only local official-key crops', () => {
    const got = paperPartsOf({ parts: [
      { label: '1', text: 'Find x.', answerImage: '/answer-figures/official-1.webp' },
      { label: '2', text: 'Find y.', answerImage: 'https://untrusted.example/key.png' },
    ] });
    expect(got?.parts[0]).toMatchObject({ answerImage: '/answer-figures/official-1.webp' });
    expect(got?.parts[1]).not.toHaveProperty('answerImage');
  });

  it('withholds a copied question, another part’s answer, and table debris', () => {
    const part = { label: '2.1', text: '2.1 Determine the pH of the solution.' };
    expect(paperPartAnswerIsUsable('2.1 Determine the pH of the solution.', part)).toBe(false);
    expect(paperPartAnswerIsUsable('3.2 The concentration is 0.1 mol/L.', part)).toBe(false);
    expect(paperPartAnswerIsUsable('& 1', part)).toBe(false);
    expect(paperPartAnswerIsUsable('2.1 $\\mathrm{pH}=3.4$', part)).toBe(true);
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

/**
 * Which unanswered parts the page flags "no official answer": every part but
 * a heading whose sub-parts carry the answers.
 */
describe('partOnlyHeads', () => {
  const parts = [{ label: '1' }, { label: '2' }, { label: '2.1' }, { label: '2.2' }, { label: 'I.A' }, { label: 'I.A.1' }];

  it('is a heading when a later part extends its label', () => {
    expect(partOnlyHeads(parts, 1)).toBe(true);
    expect(partOnlyHeads(parts, 4)).toBe(true);
  });

  it('is not a heading when nothing extends it', () => {
    expect(partOnlyHeads(parts, 0)).toBe(false);
    expect(partOnlyHeads(parts, 2)).toBe(false);
  });

  it('does not take "2" for the head of "21"', () => {
    expect(partOnlyHeads([{ label: '2' }, { label: '21' }], 0)).toBe(false);
  });
});
