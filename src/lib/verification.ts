import 'server-only';

import { z } from 'zod';

import { ai } from '@/lib/ai';

/**
 * Verification pass.
 *
 * Runs on anything the system *synthesized* rather than restated: concept-level
 * chat answers, personal-reference answers, and generated problems. A tier-1
 * answer — the official question with its official solution — is not verified,
 * because there is nothing to verify against that is more authoritative than
 * what was already retrieved.
 *
 * The verifier is given the same source material as the writer and asked one
 * question: is every claim here supported by that material? It is deliberately
 * a separate call with a separate prompt. Asking the same generation to
 * self-check in one pass reliably produces "yes, correct" — the model has
 * already committed to the answer by the time it is asked.
 *
 * This is shared by step-5 chat and step-6 generation on purpose: one place
 * where "did we make this up?" is decided.
 */

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['supported', 'severity', 'issues', 'notes'],
  properties: {
    supported: { type: 'boolean' },
    severity: { type: 'string', enum: ['none', 'minor', 'major'] },
    issues: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
} as const;

const verdictResponseSchema = z.object({
  supported: z.boolean(),
  severity: z.enum(['none', 'minor', 'major']),
  issues: z.array(z.string()),
  notes: z.string(),
});

export type VerificationVerdict = {
  /** False means the answer must not be shown as-is. */
  supported: boolean;
  severity: 'none' | 'minor' | 'major';
  issues: string[];
  notes: string;
  modelUsed: string | null;
  /** True when the check itself could not run. Treated as "not verified", never as "passed". */
  inconclusive: boolean;
};

export type VerificationInput = {
  /** What was asked. */
  query: string;
  /** What the system is about to say. */
  answer: string;
  /** The retrieved material the answer is supposed to rest on. */
  context: string;
};

const SYSTEM = [
  'You are checking whether a tutoring answer is supported by the course material it was written from.',
  '',
  'You are not marking the answer for style, completeness or teaching quality. You are checking one',
  'thing: does the answer assert anything that the supplied material does not support?',
  '',
  'severity:',
  '  none  — every substantive claim traces to the material.',
  '  minor — ordinary pedagogical scaffolding beyond the material (restating a definition in simpler',
  '          words, an arithmetic step, an encouraging sentence). Not a factual addition.',
  '  major — a formula, value, rule, method or fact that is not in the material and is not a direct',
  '          consequence of it; or a statement that contradicts the material.',
  '',
  'supported = false if and only if severity is "major".',
  '',
  'issues: one short line per problem found, quoting the offending claim. Empty when severity is none.',
  'notes: one sentence summarising the verdict.',
].join('\n');

export async function verifyAgainstContext(input: VerificationInput): Promise<VerificationVerdict> {
  if (input.context.trim().length === 0) {
    return {
      supported: false,
      severity: 'major',
      issues: ['No source material was supplied for this answer.'],
      notes: 'An answer with no grounding cannot be verified.',
      modelUsed: null,
      inconclusive: false,
    };
  }

  try {
    const provider = ai();
    const response = await provider.completeJson({
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            '# Course material the answer was written from',
            input.context,
            '',
            '# Question asked',
            input.query,
            '',
            '# Answer to check',
            input.answer,
          ].join('\n'),
        },
      ],
      schema: VERDICT_SCHEMA as unknown as Record<string, unknown>,
      schemaName: 'grounding_verification',
      effort: 'high',
      maxTokens: 4000,
      model: provider.verifyModel,
      parse: (value) => verdictResponseSchema.parse(value),
    });

    const data = response.data;
    return {
      // Re-derive rather than trusting the model's own boolean: the rule is
      // ours, and a model that says `supported: true, severity: "major"` must
      // not be able to talk its way past it.
      supported: data.severity !== 'major',
      severity: data.severity,
      issues: data.issues,
      notes: data.notes,
      modelUsed: response.modelUsed,
      inconclusive: false,
    };
  } catch (err) {
    console.error('[verification] check failed', err);
    return {
      supported: false,
      severity: 'major',
      issues: [],
      notes: 'The verification pass could not be completed.',
      modelUsed: null,
      inconclusive: true,
    };
  }
}

/**
 * Independent-solve check for generated problems.
 *
 * A second model solves the generated problem cold — without seeing the
 * generator's solution — and its final answer is compared to the generator's.
 * Agreement is the `solver_passed` gate in `generated_problems`. Disagreement
 * means the problem is unsound, ambiguous, or its stated answer is wrong; in
 * every one of those cases it must not reach a student.
 */
const SOLVE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['final_answer', 'solvable', 'reasoning_summary'],
  properties: {
    final_answer: { type: 'string' },
    solvable: { type: 'boolean' },
    reasoning_summary: { type: 'string' },
  },
} as const;

const solveResponseSchema = z.object({
  final_answer: z.string(),
  solvable: z.boolean(),
  reasoning_summary: z.string(),
});

export type SolverCheck = {
  passed: boolean;
  solverAnswer: string | null;
  notes: string;
  modelUsed: string | null;
};

export async function solverCheck(problemText: string, expectedAnswer: string): Promise<SolverCheck> {
  try {
    const provider = ai();
    const solved = await provider.completeJson({
      system: [
        'Solve the examination problem you are given, working at Lebanese Baccalaureate level.',
        '',
        'final_answer: the final result only, in the form a marker would accept. Include units.',
        'solvable: false if the problem is ambiguous, self-contradictory, or missing information',
        '  needed to solve it. Say so rather than inventing the missing value.',
        'reasoning_summary: two or three lines on the method used.',
      ].join('\n'),
      messages: [{ role: 'user', content: problemText }],
      schema: SOLVE_SCHEMA as unknown as Record<string, unknown>,
      schemaName: 'independent_solve',
      effort: 'high',
      model: provider.verifyModel,
      parse: (value) => solveResponseSchema.parse(value),
    });

    if (!solved.data.solvable) {
      return {
        passed: false,
        solverAnswer: null,
        notes: `Solver could not solve the problem as stated: ${solved.data.reasoning_summary}`,
        modelUsed: solved.modelUsed,
      };
    }

    const agrees = await answersAgree(expectedAnswer, solved.data.final_answer);

    return {
      passed: agrees,
      solverAnswer: solved.data.final_answer,
      notes: agrees
        ? 'Independent solve agrees with the stated answer.'
        : `Independent solve produced "${solved.data.final_answer}", stated answer is "${expectedAnswer}".`,
      modelUsed: solved.modelUsed,
    };
  } catch (err) {
    console.error('[verification] solver check failed', err);
    return {
      passed: false,
      solverAnswer: null,
      notes: 'The solver check could not be completed.',
      modelUsed: null,
    };
  }
}

const AGREEMENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['equivalent'],
  properties: { equivalent: { type: 'boolean' } },
} as const;

/**
 * Whether two final answers are the same answer.
 *
 * String comparison is not enough — `1/2`, `0.5` and `\frac{1}{2}` are one
 * answer, and `2,5 m/s` and `2.5 m·s⁻¹` are another. A cheap exact-match
 * shortcut avoids a model call in the common case.
 */
async function answersAgree(expected: string, actual: string): Promise<boolean> {
  const normalize = (s: string) =>
    s.toLowerCase().replace(/\s|\\left|\\right|[{}$]/g, '').replace(/,/g, '.').trim();

  if (normalize(expected) === normalize(actual)) return true;

  try {
    const response = await ai().completeJson({
      system:
        'Decide whether two answers to the same examination question are mathematically equivalent. ' +
        'Different notation, units expressed differently, and rounding to the same precision are equivalent. ' +
        'Different values are not.',
      messages: [{ role: 'user', content: `A: ${expected}\nB: ${actual}` }],
      schema: AGREEMENT_SCHEMA as unknown as Record<string, unknown>,
      schemaName: 'answer_equivalence',
      effort: 'low',
      maxTokens: 500,
      parse: (value) => z.object({ equivalent: z.boolean() }).parse(value),
    });
    return response.data.equivalent;
  } catch {
    // Cannot confirm equivalence — treat as disagreement so the problem goes to
    // a human rather than to a student.
    return false;
  }
}
