import { describe, expect, it } from 'vitest';

import { modelBaremePrompt } from '../src/lib/model-bareme';

/*
 * This writes the marking scheme a student's written answer is scored against
 * when the paper came without one — 1,618 past-exam questions. A scheme decides
 * marks, so the failures that matter are inventing criteria no Lebanese
 * examiner uses, and letting the total drift away from what the paper printed.
 */

const base = { language: 'fr', subject: 'Physique', statedMarks: null as number | null, examples: [] };
const example = [
  [{ criterion: 'Écrire l’équation différentielle', points: 1 }, { criterion: 'Déterminer la constante de temps', points: 1.5 }],
];

describe('writing the marking scheme for a question that came without one', () => {
  it('marks what the candidate produces, never how they present it', () => {
    // A model left to itself proposes "clarity", "presentation", "effort" —
    // none of which appear on a Lebanese barème, and all of which would take
    // marks off a correct answer.
    const prompt = modelBaremePrompt(base);
    expect(prompt).toMatch(/names what the candidate must produce/i);
    expect(prompt).toMatch(/Never mark presentation, clarity, effort or neatness/i);
  });

  it('follows the shape of real schemes when it has them', () => {
    // A Lebanese barème is a template, not an answer: it splits marks by the
    // steps the programme expects. Real ones are what teach that shape.
    const prompt = modelBaremePrompt({ ...base, examples: example });
    expect(prompt).toMatch(/Real marking schemes from this same subject/i);
    expect(prompt).toMatch(/Follow their shape.*not their content/is);
  });

  it('says nothing about examples when there are none', () => {
    expect(modelBaremePrompt(base)).not.toMatch(/Real marking schemes/i);
  });

  it('holds the total to what the paper printed', () => {
    // The marks are on the paper. A scheme adding up to something else scores
    // every student out of the wrong number.
    expect(modelBaremePrompt({ ...base, statedMarks: 7 })).toContain('out of 7');
    expect(modelBaremePrompt({ ...base, statedMarks: 7 })).toMatch(/add up to exactly that/i);
  });

  it('caps the total when the paper did not say', () => {
    const prompt = modelBaremePrompt(base);
    expect(prompt).toMatch(/at most 20/);
    expect(prompt).not.toContain('out of null');
  });

  it('writes the criteria in the language the subject is taught in', () => {
    expect(modelBaremePrompt(base)).toContain('French');
    expect(modelBaremePrompt({ ...base, language: 'ar' })).toContain('Arabic');
  });

  it('lets it refuse rather than mark an exercise it cannot see', () => {
    expect(modelBaremePrompt(base)).toMatch(/"bareme":\[\]/);
  });
});
