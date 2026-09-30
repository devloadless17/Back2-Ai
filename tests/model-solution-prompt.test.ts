import { describe, expect, it } from 'vitest';

import { modelSolutionPrompt } from '../src/lib/model-solution';

/*
 * This prompt writes the answer a student reads when the paper came without
 * one — about 3,250 past-exam questions and 4,700 book exercises have no
 * official solution at all. Two failures matter, and they pull against each
 * other: leaving the student with nothing, and inventing something.
 */

const base = { language: 'en', subject: 'Physics', hasPassage: false, hasFigure: false, hasCourseMaterial: false };

describe('answering a question whose paper came without an answer', () => {
  it('answers in the language the subject is taught in', () => {
    expect(modelSolutionPrompt({ ...base, language: 'fr', subject: 'Physique' })).toContain('French');
    expect(modelSolutionPrompt({ ...base, language: 'ar' })).toContain('Arabic');
  });

  it('does not refuse merely because a figure is missing', () => {
    // THE FAILURE THIS EXISTS TO PREVENT. The first version refused whenever the
    // exercise leaned on anything it had not been handed, and a figure is
    // printed beside a large share of the science papers — so the student was
    // left with a blank where an answer should be.
    const withFigure = modelSolutionPrompt({ ...base, hasFigure: true });
    expect(withFigure).toContain('Being short of a figure is not a reason to refuse');
    expect(withFigure).toMatch(/method for the parts that do/i);
  });

  it('forbids inventing a value it could not see', () => {
    // The other half of the same rule. Teaching the method is useful; making up
    // a coordinate read off a graph is worse than saying nothing, because the
    // student cannot tell the difference.
    expect(modelSolutionPrompt({ ...base, hasFigure: true })).toMatch(/NEVER invent a number/);
  });

  it('says nothing about figures when none is printed', () => {
    expect(modelSolutionPrompt(base)).not.toMatch(/figure, graph or table is printed/);
  });

  it('uses the book’s own method when the course material is there', () => {
    // A Lebanese barème marks the programme's method, so an answer that is
    // correct by another route still loses marks.
    const grounded = modelSolutionPrompt({ ...base, hasCourseMaterial: true });
    expect(grounded).toMatch(/course book/i);
    expect(grounded).toMatch(/their method|notation/i);
  });

  it('points the model at the passage when the exercise examines one', () => {
    expect(modelSolutionPrompt({ ...base, hasPassage: true })).toMatch(/text the exercise examines|Answer from that text/i);
    expect(modelSolutionPrompt(base)).not.toMatch(/Answer from that text/i);
  });

  it('still allows a refusal when the text itself is unusable', () => {
    expect(modelSolutionPrompt(base)).toContain('NO_ANSWER');
  });
});
