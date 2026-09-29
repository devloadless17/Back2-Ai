import { describe, expect, it } from 'vitest';

import { stripLabelRuns } from '../scripts/corpus/figure-label-debris';

describe('stripLabelRuns', () => {
  it('removes the labels of a figure read into the question (the reported physics case)', () => {
    const text = [
      '1-4) The previous two experiments show an aspect of light.',
      'Name this aspect.',
      '',
      'S',
      'Laser',
      'source',
      'x',
      'O',
      'D',
      '(E)',
      'Doc. 7',
      'L',
      'θ1',
      'Second aspect',
      'The monochromatic radiation, of wavelength λ, illuminates a metal.',
    ].join('\n');
    const out = stripLabelRuns(text);
    expect(out.text).toContain('Name this aspect.');
    expect(out.text).toContain('The monochromatic radiation');
    expect(out.text).not.toMatch(/\nLaser\n/);
    expect(out.removed).toContain('Doc. 7');
  });

  it('keeps sub-question numbers, equations and short real lines', () => {
    const text = ['Données :', 'g = 10 m/s²', 'a- Calculer v.', 'b- En déduire E.', 'c- Conclure.', 'd- Justifier.'].join('\n');
    expect(stripLabelRuns(text).text).toBe(text);
  });

  it('keeps a run shorter than four', () => {
    const text = 'Consider the circuit.\nR\nC\nK\nClose the switch K.';
    expect(stripLabelRuns(text).text).toBe(text);
  });
});

describe('content broken over lines is not a figure label', () => {
  it('keeps a nuclear equation, a codon table and a bulleted list', () => {
    for (const text of [
      'Complete the equation:\n1\n0n +\n235\n92U →\nA\nZX',
      'Use the table:\nAUC Ile\nAAC Asn\nGAU Asp\nUAG Stop',
      'Medicines:\ndrug\nAdvil\nPanadol\n• antibiotic',
    ]) {
      expect(stripLabelRuns(text).text).toBe(text);
    }
  });
});
