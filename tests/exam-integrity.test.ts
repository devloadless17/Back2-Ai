import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Nothing that marks the paper may reach the student while they are sitting it.
 *
 * The exam desk renders in the browser, so every field the server maps into
 * `ExamSlot` is in the page payload and readable by anyone who opens the
 * devtools. A solution, a barème criterion or a marking explanation sitting
 * there is the answer key, whether or not any pixel draws it.
 *
 * This holds today by construction rather than by luck, which is exactly why
 * it needs a guard: `slotContent` returns `officialSolution`, the slot has a
 * `baremeSnapshot`, and both are one careless spread away from the client.
 *
 * A source-level check because there is no database or browser here. It cannot
 * prove the rendered payload; it can prove the mapping does not name the
 * fields, which is the way this would actually break.
 */

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), 'utf8');

const desk = read('src', 'app', '(exam)', 'exam-sim', '[examSimulationId]', 'page.tsx');
const runner = read('src', 'components', 'exam', 'exam-runner.tsx');

/** Everything that would give the mark away. */
const ANSWER_KEY_FIELDS = [
  'officialSolution',
  'generatedSolution',
  'baremeSnapshot',
  'baremeResult',
  'justification',
  'explanation',
];

describe('the sitting page payload', () => {
  for (const field of ANSWER_KEY_FIELDS) {
    it(`does not send ${field} to the client`, () => {
      expect(desk).not.toContain(field);
    });
  }

  it('does not send the barème under any spelling', () => {
    expect(desk.toLowerCase()).not.toContain('bareme');
    expect(desk.toLowerCase()).not.toContain('barème');
  });

  it('never spreads a whole slot into the client model', () => {
    /*
     * `...slot` would carry the barème snapshot across in one keystroke, and
     * the mapping is explicit precisely so that cannot happen by accident.
     */
    expect(desk).not.toMatch(/\.\.\.slot\b/);
    expect(desk).not.toMatch(/\.\.\.simulation\b/);
  });

  it('still sends what the student legitimately needs', () => {
    // The guard must not be satisfiable by sending nothing.
    for (const field of ['contentText', 'contentLatex', 'maxScore', 'savedAnswer']) {
      expect(desk).toContain(field);
    }
  });
});

describe('the runner itself', () => {
  it('has no notion of a correct answer to leak', () => {
    for (const field of ANSWER_KEY_FIELDS) {
      expect(runner).not.toContain(field);
    }
  });

  it('reads remaining time from the server value, not from mount time', () => {
    /*
     * `expiresAt` is server-authoritative and the countdown is display only.
     * A timer measured from when the component mounted would reset on every
     * refresh and hand the student an unlimited paper.
     */
    expect(runner).toContain('initialRemainingSeconds');
    expect(runner).not.toMatch(/Date\.now\(\)\s*-\s*mounted/);
  });
});

describe('the marking grammar is shared, not duplicated', () => {
  it('renders exam results through the same ExaminerMark as Practice', () => {
    const results = read(
      'src',
      'app',
      '(app)',
      'exam-sim',
      '[examSimulationId]',
      'results',
      'page.tsx',
    );
    expect(results).toContain('<ExaminerMark');
  });

  it('has no second marking component left to drift from it', () => {
    /*
     * `mark-explanation.tsx` is deleted, not merely unused. A component with
     * no call sites is a component someone reaches for later, and the whole
     * point of the migration was that the product should have one marking
     * language rather than two that happen to agree today.
     *
     * Matching on the import rather than the word, because the results page
     * explains in a comment what it used to render.
     */
    const results = read(
      'src',
      'app',
      '(app)',
      'exam-sim',
      '[examSimulationId]',
      'results',
      'page.tsx',
    );
    expect(results).not.toMatch(/import .*MarkExplanation/);
    expect(existsSync(join(process.cwd(), 'src', 'components', 'exam', 'mark-explanation.tsx'))).toBe(
      false,
    );
  });
});
