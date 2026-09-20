import { describe, expect, it } from 'vitest';

import { isSuppliedProblem } from '@/lib/question-kind';
import { systemPrompt } from '@/lib/chat';

/**
 * "i gave him this, he couldnt get anything" — 2026-09-20.
 *
 * A student pasted a workbook exercise on a series RLC circuit: the circuit
 * described in words, U_eff given, a resonance curve with one labelled point,
 * and eleven lettered parts. The tutor produced nothing usable, and the reason
 * was not the missing figure. It was the grounded prompt's first hard rule —
 * answer ONLY from the material given below — applied to a question whose
 * material is the problem itself. Retrieval searches a chapter corpus that does
 * not contain a workbook exercise, so the tutor was forbidden from deriving a
 * differential equation that is bookwork in the Lebanese programme.
 */

const RLC_PROBLEM = `The adjacent circuit includes a low frequency generator adjusted to an
alternating sinusoidal voltage of effective value U_eff = 20 V, a capacitor of capacitance C,
a purely inductive coil of inductance L, and a resistor of resistance R.
a) Determine the differential equation that governs the variation of the current i in the circuit.
b) Apply the law of addition of voltages to prove that U_m sin(wt) = R I_m sin(wt + p).
c) Substitute for (wt + p) = 0 to deduce that I_m = U_m / sqrt(R^2 + (1/Cw - Lw)^2).
d) The adjacent graph represents the variation of P_av as a function of w.
   i. Refer to the graph to indicate the value of the proper frequency.
   ii. Prove that R = 10 ohms.`;

describe('telling a supplied problem from a question about a topic', () => {
  it('recognises the pasted RLC exercise', () => {
    expect(isSuppliedProblem(RLC_PROBLEM)).toBe(true);
  });

  it('recognises a one-line problem with its own givens', () => {
    expect(isSuppliedProblem('Calculate the limit of f(x) as x tends to infinity.')).toBe(true);
    expect(isSuppliedProblem('Determine the value of R when U = 20 V and I = 2 A.')).toBe(true);
  });

  /**
   * A solve verb is not enough on its own, and that is the intended line.
   *
   * "Montrer que la réaction est totale" is a real Bac question, but nothing
   * has been handed over with it — no data, no parts, no expression. It is
   * also a question the corpus contains, so it reaches the student through
   * `exact_match` with its official solution attached, which is a better
   * answer than anything the relaxed rules would produce. Widening the rules
   * here would buy nothing and give up the protection.
   */
  it('wants givens, not just a solve verb', () => {
    expect(isSuppliedProblem('Montrer que la réaction est totale.')).toBe(false);
    expect(isSuppliedProblem('Prove that the sequence converges.')).toBe(false);
  });

  it('leaves a question about a topic alone', () => {
    // These must keep the strict rule. Nothing has been handed over to solve,
    // so there is no reason to widen what the tutor may draw on.
    expect(isSuppliedProblem('Explain the photoelectric effect.')).toBe(false);
    expect(isSuppliedProblem('What is unemployment?')).toBe(false);
    expect(isSuppliedProblem("Qu'est-ce qu'une réaction totale ?")).toBe(false);
    expect(isSuppliedProblem('Explique-moi les mécanismes de évolution.')).toBe(false);
  });

  it('is not satisfied by a solve verb with nothing to solve', () => {
    // "Show that" in prose, with no data, no parts and no expression.
    expect(isSuppliedProblem('Can you show that page again please')).toBe(false);
  });
});

/**
 * The prompt actually changes. Asserting on `isSuppliedProblem` alone would
 * pass while the prompt still carried the rule that caused the failure.
 */
describe('which hard rules reach the model', () => {
  const classification = { kind: 'concept', confidence: 'high', signal: 'default' } as const;

  const promptFor = (question: string) =>
    systemPrompt('concept_level', classification, 'en', null, question);

  it('lifts the material-only ban for a supplied problem', () => {
    const prompt = promptFor(RLC_PROBLEM);
    expect(prompt).not.toContain('Answer ONLY from the material given below');
    expect(prompt).toContain('handed you a complete problem');
    expect(prompt).toContain('does not have to contain this problem');
  });

  /**
   * The line is between CONTENT and REASONING, not between strict and loose.
   *
   * The books still decide which laws, formulas and notation are legitimate —
   * that is the entire value of grounding a tutor in the real textbooks, and
   * losing it would teach a student methods their programme does not contain.
   * What the books stop deciding is whether the tutor may do the working.
   */
  it('keeps the books in charge of the method while the solving is the tutor\'s', () => {
    const prompt = promptFor(RLC_PROBLEM);
    expect(prompt).toContain('THE MATERIAL SETS THE TOOLKIT; THE REASONING IS YOURS');
    expect(prompt).toContain('the ones the Lebanese programme teaches');
    expect(prompt).toContain('Do not reach outside the programme for a method');
    // And the step itself is explicitly the tutor's to produce.
    expect(prompt).toContain('are your own work');
  });

  it('keeps the bans that the material-only rule existed to enforce', () => {
    const prompt = promptFor(RLC_PROBLEM);
    // Programme knowledge is released; inventing data and exam facts is not.
    expect(prompt).toContain('Do not invent DATA');
    expect(prompt).toContain('Do not invent a barème');
    // The prompt is assembled from wrapped lines, so assert within one line.
    expect(prompt).toContain('what an unseen figure shows');
    // A described figure is not an unseen one: the tutor must read the values
    // out of the transcription rather than declaring the graph unavailable.
    expect(prompt).toContain('DESCRIPTION OF THE FIGURE');
  });

  it('leaves a topic question under the strict rule', () => {
    const prompt = promptFor('Explain the photoelectric effect.');
    expect(prompt).toContain('Answer ONLY from the material given below');
    expect(prompt).not.toContain('handed you a complete problem');
  });

  it('never puts both sets of rules in one prompt', () => {
    // The file's own warning: two instructions arguing inside one prompt is
    // how the tier-3 block and the kind block once contradicted each other.
    for (const question of [RLC_PROBLEM, 'Explain the photoelectric effect.']) {
      const prompt = promptFor(question);
      const strict = prompt.includes('Answer ONLY from the material given below');
      const relaxed = prompt.includes('handed you a complete problem');
      expect(strict && relaxed).toBe(false);
      expect(strict || relaxed).toBe(true);
    }
  });
});
