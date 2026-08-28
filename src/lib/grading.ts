import 'server-only';

import { z } from 'zod';

import { ai } from '@/lib/ai';
import { env } from '@/lib/env';

/**
 * Barème marking engine.
 *
 * One engine, two entry paths — typed answers and photographed handwriting —
 * exactly as specified. The photo path differs only in that it runs an OCR
 * self-consistency gate *before* marking; everything downstream is identical,
 * so a student cannot be marked differently for having written on paper.
 *
 * Design constraints that come from this being an official examination system:
 *   * The model never invents criteria. It is given the barème and may only
 *     award points against the criteria it was handed.
 *   * The model says MET or NOT MET; the points are assigned server-side from
 *     the barème. It cannot inflate a mark because it never names a number.
 *   * Every criterion carries a written justification, so a contested mark can
 *     be reviewed by a human without re-running the model.
 *   * A refusal or a malformed response is surfaced as "needs human marking",
 *     never as a zero.
 */

/** A criterion as stored on `questions.bareme` / `generated_problems.bareme`. */
export const baremeCriterionSchema = z.object({
  criterion: z.string().min(1),
  points: z.number().min(0),
});

export const baremeSchema = z.array(baremeCriterionSchema).min(1);

export type BaremeCriterion = z.infer<typeof baremeCriterionSchema>;
export type Bareme = z.infer<typeof baremeSchema>;

/** A marked criterion as stored on `exam_answers.bareme_result`. */
export const baremeResultItemSchema = z.object({
  criterion: z.string(),
  points_awarded: z.number(),
  points_possible: z.number(),
  justification: z.string(),
  /**
   * What to show the student when they ask why they lost the mark.
   *
   * Written here, once, at marking time — not regenerated when a student hovers
   * over the criterion. Hover is a gesture, not an intention; regenerating on it
   * would pay for the same paragraph every time a cursor crossed it, and would
   * let the same lost mark be explained two different ways on two viewings.
   *
   * Distinct from `justification`, which faces a teacher reviewing a contested
   * mark and says why the points were awarded as they were. This faces the
   * student and says what went wrong and how the correct reasoning goes. Empty
   * on a criterion that scored full marks: there is nothing to explain.
   *
   * Defaulted rather than required, and the default is doing real work. This
   * schema reads a JSONB column, so it meets rows written before the field
   * existed — and `parseBaremeResult` returns [] on any parse failure, which
   * means requiring it silently emptied every marking result already stored.
   * Six of the six in the database, on a results page that then showed a score
   * with no criteria under it. An old row means the same thing an unexplained
   * criterion means, so it reads as one instead of as nothing.
   *
   * What the marker WRITES is still required: `gradingResponseSchema` and
   * `GRADING_SCHEMA` govern the model's output and neither is relaxed here.
   */
  explanation: z.string().default(''),
  /**
   * True when this criterion is ours, not the examiner's.
   *
   * 868 questions reached the corpus without a barème, and the marker proposes
   * criteria for those rather than refusing. A proposed criterion marked like
   * an official one is the worst version of that feature, so the distinction
   * travels with the criterion itself and the results screen says so.
   *
   * It rides in the JSONB rather than in a column of its own because it
   * qualifies the criteria, not the attempt: a paper can mix an exercise whose
   * scheme survived extraction with one whose did not, and a row-level flag
   * would have to lie about one of them. Optional and defaulted false, for the
   * same reason `explanation` is — this schema meets rows written before the
   * field existed, and requiring it would empty every marking result already
   * stored.
   */
  provisional: z.boolean().default(false),
});

export const baremeResultSchema = z.array(baremeResultItemSchema);

export type BaremeResultItem = z.infer<typeof baremeResultItemSchema>;

export type GradingOutcome = {
  /**
   * `graded` is a mark against the paper's own barème and is the only one that
   * carries the ministry's authority.
   *
   * `graded_provisional` is a mark against criteria the model proposed, for the
   * 868 questions that arrived with no scheme at all — 799 of them with no
   * official solution either, and 659 in the Arabic subjects, where a student
   * previously wrote an answer and got `needs_human_review` and silence. It is
   * a different KIND of number and never presented as the other: the caller is
   * expected to label it, and the student is told the criteria are our reading
   * of the question rather than the examiner's.
   */
  status: 'graded' | 'graded_provisional' | 'needs_human_review';
  results: BaremeResultItem[];
  totalScore: number;
  maxScore: number;
  modelUsed: string | null;
  /** Populated when status is 'needs_human_review'. */
  reason?: string;
  /** The criteria the model proposed, when it had to invent them. */
  provisionalBareme?: Bareme;
};

export type GradeInput = {
  questionText: string;
  officialSolution: string | null;
  bareme: Bareme;
  studentAnswer: string;
  /** Language the justification should be written in, so feedback matches the student's UI. */
  language: 'fr' | 'en' | 'ar';
  /**
   * The subject, so the marker is told what "met" means here. Optional because
   * an omitted subject must mark rather than throw — it falls back to the common
   * rules, which is what every caller got before this existed.
   */
  subject?: string | null;
};

/*
 * The model decides MET or NOT MET. It never picks a number.
 *
 * Asking for `points_awarded` invited a judgement the data cannot support. A
 * question here is a whole exam exercise — 6.16 numbered parts on average, up
 * to 56 — and 1,594 of them carry a SINGLE criterion covering three or more of
 * those parts. Against a barème that coarse, "2.5 out of 4" is not partial
 * credit; it is a number invented to look like one, and it then flows into
 * mastery, readiness and the predicted mark as though it were measured.
 *
 * Binary per criterion is what the barème can actually carry. Where a question
 * has real per-part criteria — 1,066 of them do — the student still sees which
 * part they lost, which is the feedback that matters. Where it has one
 * criterion, this degrades to correct/not correct, which is honest about how
 * much the scheme knows.
 *
 * `points_awarded` survives in the STORED result, so `exam_answers` rows, the
 * results page and every score downstream keep their shape. It simply takes one
 * of two values now, assigned server-side from `met`, which also removes the
 * inflated-award case the clamp existed to catch.
 */
const GRADING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['criteria'],
  properties: {
    criteria: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['index', 'criterion', 'met', 'justification', 'explanation'],
        properties: {
          index: {
            type: 'integer',
            description: 'The 1-based number of the criterion in the barème list, copied from it.',
          },
          criterion: { type: 'string' },
          met: {
            type: 'boolean',
            description: 'true if the student satisfied this criterion, false otherwise.',
          },
          justification: { type: 'string' },
          explanation: { type: 'string' },
        },
      },
    },
  },
} as const;

const gradingResponseSchema = z.object({
  criteria: z.array(
    z.object({
      index: z.number().int(),
      criterion: z.string(),
      met: z.boolean(),
      justification: z.string(),
      explanation: z.string(),
    }),
  ),
});

const LANGUAGE_NAME = { fr: 'French', en: 'English', ar: 'Arabic' } as const;

/**
 * How a subject is marked — which is not the same question in every subject.
 *
 * A single marking prompt treats a maths proof, a philosophy dissertation and
 * an Arabic commentaire as the same object, and they are not. The barèmes
 * measured across this corpus say so plainly:
 *
 *     Ejtema3      10.00 criteria / 11.3 numbered parts
 *     Chemistry     3.12 / 11.0
 *     Physics       2.38 /  9.3
 *     Falsafa       2.33 /  2.1     intro / développement / conclusion
 *     Mathematics   1.35 /  4.3
 *     Joghrafya     1.00 /  8.1
 *     Tarikh        1.00 /  0.3     one essay, one judgement
 *
 * Philosophy is not the holistic one — it has a real staged scheme with few
 * numbered parts. Maths is the coarse one. تاريخ is the only subject where a
 * single criterion is genuinely the right shape.
 *
 * So what "met" means has to differ. In maths a criterion is about the METHOD
 * and survives an arithmetic slip; in a dissertation it is about whether a
 * stage of the argument is actually present and argued; in a commentaire it is
 * about whether the claim is anchored in the text. Marking all three by the
 * same instruction is how a student loses a maths mark for a sign error and
 * gains a philosophy mark for using the word "problématique".
 */
export type MarkingStyle =
  | 'maths'
  | 'physical_science'
  | 'life_science'
  | 'philosophy'
  | 'literature'
  | 'humanities'
  | 'civics_economics'
  | 'general';

/** Subject name as stored on `subjects.name` → how its papers are marked. */
export function markingStyle(subjectName: string): MarkingStyle {
  const s = subjectName.trim();
  if (/^Math/i.test(s)) return 'maths';
  if (/^(Physic|Physiq|Chemistr|Chimie)/i.test(s)) return 'physical_science';
  if (/^(Life Sciences|Sciences de la vie)/i.test(s)) return 'life_science';
  if (s.includes('فلسفة')) return 'philosophy';
  if (s.includes('أدب') || /^(Francais|Français|English)$/i.test(s)) return 'literature';
  if (s.includes('تاريخ') || s.includes('جغرافيا')) return 'humanities';
  if (s.includes('تربية') || s.includes('اجتماع') || s.includes('اقتصاد')) return 'civics_economics';
  return 'general';
}

/** What "met" means in this subject. Appended to the common rules. */
const STYLE_RULES: Record<MarkingStyle, string[]> = {
  maths: [
    'This is mathematics. The criterion is about the METHOD unless it names the final answer.',
    '- A correct method carried through with an arithmetic or sign slip MEETS a method criterion.',
    '  Losing it for a slip is how a student learns to distrust the marking.',
    '- Each numbered part is separate work. Do not let a wrong part 1 fail a criterion about part 3',
    '  when the student carried their own (wrong) value through correctly.',
    '- Any valid method earns the criterion, including one the official solution does not use.',
  ],
  physical_science: [
    'This is physics or chemistry. Marks follow the reasoning, not the number.',
    '- A correct relation applied correctly MEETS a method criterion even if the arithmetic is wrong.',
    '- Judge units and significant figures ONLY where the criterion asks for them.',
    '- An answer that reaches the right conclusion by sound physical or chemical reasoning is met,',
    '  even when the wording differs from the official solution.',
  ],
  life_science: [
    'This is life sciences. The papers are document-based: the student is asked to reason FROM',
    'evidence, not to recite the chapter.',
    '- A criterion is met when the student draws the conclusion the evidence supports and says what',
    '  in the document supports it. Correct textbook content that ignores the document does not meet',
    '  a criterion about the document.',
    '- Accept correct biological reasoning expressed in the student\'s own terms.',
  ],
  philosophy: [
    'This is philosophy. The criteria are stages of a dissertation — problem, thesis, antithesis,',
    'resolution, conclusion — not facts to be recalled.',
    '- A stage is met when it is actually PRESENT AND ARGUED. Naming it does not meet it: writing',
    '  "la problématique est..." and then not posing a problem is not a problématique.',
    '- Reward argument, structure and use of the quoted text. Do not reward vocabulary.',
    '- A position different from the official solution is fully acceptable if it is argued.',
  ],
  literature: [
    'This is a language and literature paper: comprehension, analysis, and composition.',
    '- A criterion asking for evidence is NOT met by an unsupported assertion, however correct. The',
    '  student must point to the text — a quotation, a line, a word.',
    '- Criteria about expression judge the writing. Criteria about understanding judge the reading.',
    '  Do not let weak expression fail a comprehension criterion, or vice versa.',
    '- A defensible reading that differs from the official one is met.',
  ],
  humanities: [
    'This is history or geography. Answers are expected to be specific and to use the documents.',
    '- A criterion is met when the student names the actors, dates, causes or places it asks for.',
    '  General background that never reaches the specific point does not meet it.',
    '- Where the question refers to a document, the answer must use it, not recite around it.',
  ],
  civics_economics: [
    'This is civics, sociology or economics.',
    '- A criterion asking for a definition is met by an accurate definition in the student\'s own words.',
    '- A criterion asking for an example or an application is not met by the definition alone.',
  ],
  general: [],
};

function gradingSystemPrompt(language: GradeInput['language'], style: MarkingStyle): string {
  const styleRules = STYLE_RULES[style];
  return [
    'You are marking a Lebanese Baccalaureate answer against an official barème.',
    '',
    ...(styleRules.length ? [...styleRules, ''] : []),
    'Rules you must follow exactly:',
    '- Mark ONLY against the criteria you are given. Do not invent, merge, or split criteria.',
    '- Return one entry per criterion, in the order given. Set index to that criterion’s number in',
    '  the barème list below, and copy its text into criterion. The barème text may contain scanning',
    '  errors — copy it as it is, and do not let a garbled criterion stop you marking it.',
    '- Each criterion is MET or NOT MET. There is no middle. Set met=true when the student has done',
    '  what the criterion asks; set met=false when they have not.',
    '- Judge the criterion as a whole. A criterion covering several parts of the question is met when',
    '  the student has done what it describes — do not withhold it for one slip inside otherwise',
    '  correct work, and do not grant it for one part out of several.',
    '- Count correct method as meeting the criterion even when the final numeric answer is wrong,',
    '  unless the criterion is explicitly about the final answer.',
    '- A different but mathematically valid method earns full marks. Do not penalise a student for not',
    '  matching the official solution\'s approach.',
    '- Do not penalise spelling, handwriting, or notation choices unless the criterion is about them.',
    `- Write each justification in ${LANGUAGE_NAME[language]}, in one or two sentences, addressed to the`,
    '  student. Say what earned the marks or what was missing — never just restate the criterion.',
    `- explanation: for a criterion that lost marks, two to four sentences in ${LANGUAGE_NAME[language]}`,
    '  teaching the student what went wrong and how the correct reasoning goes. This is what they will',
    '  be shown when they ask why. Where full marks were awarded, return an empty string — there is',
    '  nothing to explain, and inventing something to say devalues the ones that matter.',
    '',
    'You are marking a real examination. Be accurate and consistent, not generous and not harsh.',
  ].join('\n');
}

/**
 * A criterion is worth all of its points or none of them.
 *
 * Exported so the rule is a thing that can be tested rather than a ternary
 * buried in a map callback. An undefined verdict — a criterion the model did
 * not return — is NOT met: the barème is the authoritative list, and silence
 * about one of its lines is not evidence the student earned it.
 */
export function pointsFor(criterion: BaremeCriterion, met: boolean | undefined): number {
  return met === true ? criterion.points : 0;
}

export async function gradeAgainstBareme(input: GradeInput): Promise<GradingOutcome> {
  const maxScore = input.bareme.reduce((sum, c) => sum + c.points, 0);

  // An empty answer is a zero, and does not need a model call to establish.
  if (input.studentAnswer.trim().length === 0) {
    return {
      status: 'graded',
      results: input.bareme.map((c) => ({
        criterion: c.criterion,
        points_awarded: 0,
        points_possible: c.points,
        justification: 'No answer was submitted for this question.',
        explanation: '',
        provisional: false,
      })),
      totalScore: 0,
      maxScore,
      modelUsed: null,
    };
  }

  const userPrompt = [
    '# Question',
    input.questionText,
    '',
    ...(input.officialSolution ? ['# Official solution (reference only)', input.officialSolution, ''] : []),
    '# Barème',
    ...input.bareme.map((c, i) => `${i + 1}. [${c.points} point(s)] ${c.criterion}`),
    '',
    "# Student's answer",
    input.studentAnswer,
  ].join('\n');

  try {
    const provider = ai();
    const response = await provider.completeJson({
      system: gradingSystemPrompt(input.language, markingStyle(input.subject ?? '')),
      messages: [{ role: 'user', content: userPrompt }],
      schema: GRADING_SCHEMA as unknown as Record<string, unknown>,
      schemaName: 'bareme_marking',
      effort: 'high',
      // Marking runs on the verify model: correctness matters more than latency.
      model: provider.verifyModel,
      parse: (value) => gradingResponseSchema.parse(value),
    });

    /*
     * Re-anchor on OUR barème by NUMBER, not by the model's echo of the text.
     *
     * Matching on the criterion string required the marker to reproduce the
     * barème verbatim — including its OCR damage. A real criterion in this
     * corpus reads "1 1) Verify that x y z 1 0    is an equation of (P)", where
     * x + y + z - 1 = 0 lost its operators in the scan and the index is
     * duplicated. A model told to copy that will tidy it, the normalised
     * strings then differ, and a correctly marked answer is thrown away as
     * `needs_human_review`. Observed on the first live grading run: 3 of 3.
     *
     * The number is stable under exactly the damage the text is not, and the
     * prompt already required one entry per criterion in order. Position is the
     * fallback for a marker that omits the field.
     */
    const marks = response.data.criteria;
    const byIndex = new Map<number, (typeof marks)[number]>();
    marks.forEach((c, i) => {
      const at = Number.isInteger(c.index) && c.index >= 1 ? c.index : i + 1;
      if (!byIndex.has(at)) byIndex.set(at, c);
    });

    const results: BaremeResultItem[] = input.bareme.map((criterion, i) => {
      const marked = byIndex.get(i + 1);
      const awarded = pointsFor(criterion, marked?.met);

      return {
        criterion: criterion.criterion,
        points_awarded: round2(awarded),
        points_possible: criterion.points,
        justification: marked?.justification ?? 'This criterion could not be assessed automatically.',
        // Only where the criterion was missed. A criterion that was met has
        // nothing to explain, and inventing something to say there devalues the
        // explanations that matter. Read off `awarded` rather than off `met` so
        // it still holds for a criterion the model never returned.
        explanation: awarded < criterion.points ? (marked?.explanation ?? '') : '',
        // This path marks against the paper's own barème. These criteria are
        // the examiner's, and are the only ones that carry that authority.
        provisional: false,
      };
    });

    const unmatched = input.bareme.filter((_, i) => !byIndex.has(i + 1));
    if (unmatched.length > 0) {
      return {
        status: 'needs_human_review',
        results,
        totalScore: round2(results.reduce((s, r) => s + r.points_awarded, 0)),
        maxScore,
        modelUsed: response.modelUsed,
        reason: `${unmatched.length} of ${input.bareme.length} criteria were not returned by the marker.`,
      };
    }

    return {
      status: 'graded',
      results,
      totalScore: round2(results.reduce((s, r) => s + r.points_awarded, 0)),
      maxScore,
      modelUsed: response.modelUsed,
    };
  } catch (err) {
    // A marking failure must never become a zero on a student's record.
    console.error('[grading] marking failed', err);
    return {
      status: 'needs_human_review',
      results: input.bareme.map((c) => ({
        criterion: c.criterion,
        points_awarded: 0,
        points_possible: c.points,
        justification: 'Automatic marking was unavailable for this answer.',
        explanation: '',
        provisional: false,
      })),
      totalScore: 0,
      maxScore,
      modelUsed: null,
      reason: err instanceof Error ? err.message : 'Unknown marking error.',
    };
  }
}

// ---------------------------------------------------------------------------
// OCR self-consistency gate (photo path only)
// ---------------------------------------------------------------------------

const CONSISTENCY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['legible', 'relevant', 'confidence', 'notes'],
  properties: {
    legible: { type: 'boolean' },
    relevant: { type: 'boolean' },
    confidence: { type: 'number' },
    notes: { type: 'string' },
  },
} as const;

const consistencyResponseSchema = z.object({
  legible: z.boolean(),
  relevant: z.boolean(),
  confidence: z.number(),
  notes: z.string(),
});

export type ConsistencyOutcome = {
  passed: boolean;
  confidence: number;
  notes: string;
};

/**
 * Checks that OCR output is a coherent, legible attempt at *this* question
 * before any of it reaches the marker.
 *
 * Without this gate, a blurry photo produces garbled text, the marker awards
 * zero against every criterion, and the student is told they failed a question
 * they may have answered correctly. Failing this check is not a mark — it is a
 * request to re-take the photo.
 */
export async function checkOcrConsistency(
  questionText: string,
  extractedText: string,
): Promise<ConsistencyOutcome> {
  if (extractedText.trim().length < 10) {
    return {
      passed: false,
      confidence: 0,
      notes: 'Almost no text could be read from the photo.',
    };
  }

  try {
    const response = await ai().completeJson({
      system: [
        'You check whether text extracted from a photo of handwritten exam work is usable for marking.',
        'You are NOT marking it. A wrong answer that is clearly written passes this check.',
        '',
        'legible  = the text reads as coherent written work, not OCR noise or fragments.',
        'relevant = the work is an attempt at the question given, not a different question or unrelated notes.',
        'confidence = 0..1, how confident you are that marking this text would be fair to the student.',
        'notes = one short sentence for the student if this fails; empty string if it passes.',
      ].join('\n'),
      messages: [
        {
          role: 'user',
          content: `# Question\n${questionText}\n\n# Text extracted from the photo\n${extractedText}`,
        },
      ],
      schema: CONSISTENCY_SCHEMA as unknown as Record<string, unknown>,
      schemaName: 'ocr_consistency',
      effort: 'medium',
      maxTokens: 1000,
      parse: (value) => consistencyResponseSchema.parse(value),
    });

    const { legible, relevant, confidence, notes } = response.data;
    return {
      passed: legible && relevant && confidence >= 0.6,
      confidence: clamp(confidence, 0, 1),
      notes,
    };
  } catch (err) {
    console.error('[grading] OCR consistency check failed', err);
    // Fail closed: if we cannot confirm the photo is readable, do not mark it.
    return {
      passed: false,
      confidence: 0,
      notes: 'The photo could not be checked. Please submit it again.',
    };
  }
}

/** Total marks available for a barème — the authoritative max_score for a question. */
export function baremeMaxScore(bareme: Bareme): number {
  return round2(bareme.reduce((sum, c) => sum + c.points, 0));
}

/** Safely reads a barème out of a JSONB column, returning null if it is absent or malformed. */
export function parseBareme(value: unknown): Bareme | null {
  const parsed = baremeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parseBaremeResult(value: unknown): BaremeResultItem[] {
  const parsed = baremeResultSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

/**
 * What the paper says a question is worth, read off the paper.
 *
 * A question with no barème still prints its own tariff — "(1,5 pt)" at the end
 * of the line, "(٣ علامات)" on an Arabic paper. That number is the examiner's,
 * not ours, and it is the one thing that lets a provisional mark sit on the
 * same scale as an official one instead of inviting a conversion nobody
 * performs.
 *
 * Only the LAST occurrence is taken, and only from the tail of the statement.
 * The tariff is printed after the question; a number earlier in the text is
 * part of the physics — "une masse de 3 points" is not a mark allocation.
 * Anything above 20 is rejected outright: a Lebanese question is worth marks,
 * and 2018 is a year.
 */
export function statedMarksOf(text: string): number | null {
  const tail = text.slice(-220);
  const unit = String.raw`pts?\b|points?\b|marks?\b|علام(?:ة|تان|ات)|درجات?|ن\b`;
  // The lookbehind is load-bearing: without it "session de 2018 points" is read
  // as an 18-mark question, because \d{1,2} happily matches the tail of a year.
  const re = new RegExp(String.raw`(?<![\d.,٫])(\d{1,2}(?:[.,٫]\d{1,2})?)\s*(?:${unit})`, 'giu');

  let best: number | null = null;
  for (const m of tail.matchAll(re)) {
    const value = Number(m[1]!.replace(/[,٫]/, '.'));
    if (Number.isFinite(value) && value > 0 && value <= 20) best = value;
  }
  return best;
}


function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/* ---------------------------------------------------------------------------
 * Marking a question that arrived without a scheme
 * ------------------------------------------------------------------------ */

const PROPOSED_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['markable', 'criteria'],
  properties: {
    markable: {
      type: 'boolean',
      description:
        'false if the question cannot be marked without material you were not given — a figure, a printed passage, a document.',
    },
    criteria: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['criterion', 'points', 'grounded_in', 'met', 'justification', 'explanation'],
        properties: {
          criterion: {
            type: 'string',
            description: 'What a Lebanese Bac examiner would award this part of the answer for.',
          },
          points: { type: 'number', description: 'Marks this criterion is worth.' },
          grounded_in: {
            type: 'string',
            description:
              'The sentence from the course material that supports this criterion, copied from it verbatim. Empty string if the course material does not cover it.',
          },
          met: { type: 'boolean' },
          justification: { type: 'string' },
          explanation: { type: 'string' },
        },
      },
    },
  },
} as const;

const proposedSchema = z.object({
  markable: z.boolean(),
  criteria: z.array(
    z.object({
      criterion: z.string(),
      points: z.number(),
      grounded_in: z.string(),
      met: z.boolean(),
      justification: z.string(),
      explanation: z.string(),
    }),
  ),
});

export type ProvisionalInput = GradeInput & {
  /** Retrieved course material. This is the check on the model's own invention. */
  courseMaterial: string;
  /** What the paper says this question is worth, where it says so. */
  statedMarks?: number | null;
};

/**
 * Marks an answer when the paper's scheme never reached the corpus.
 *
 * 868 questions have no barème and 799 have no official solution either, so
 * until now a student wrote an answer to one and was told the paper needed a
 * human. That is honest and useless, and it falls almost entirely on the Arabic
 * subjects: Falsafa 377, Adab Arabi 92, Tarikh 79, Tarbiya 68, Joghrafya 43.
 *
 * The model knows what a Lebanese Bac answer of this subject and shape has to
 * contain. The objection was never that it could not judge — it was that a
 * judgement dressed as the ministry's is a lie. So it judges, and the result is
 * `graded_provisional` all the way to the student, who is told the criteria are
 * our reading of the question rather than the examiner's.
 *
 * Two guards keep the invention honest.
 *
 *   EVERY CRITERION MUST BE GROUNDED. The model is handed the retrieved course
 *   material and must copy out the sentence supporting each criterion. The
 *   citation is then checked against the material we actually sent, not taken
 *   on trust — a criterion whose support cannot be found is the model recalling
 *   a different country's syllabus, and it is dropped before any marking. If
 *   nothing survives, the question goes to human review exactly as before.
 *
 *   IT MAY REFUSE. `markable: false` is the right answer for a question turning
 *   on a figure or a printed passage nobody handed over, and 29% of this corpus
 *   does. Inventing criteria for a graph it cannot see would be the worst
 *   version of this feature, not the most useful one.
 *
 * Marks are scaled to what the paper says the question is worth, where it says
 * so, and a provisional score then sits on the same scale as an official one
 * instead of inviting a conversion nobody performs.
 */
export async function gradeWithoutBareme(input: ProvisionalInput): Promise<GradingOutcome> {
  if (input.studentAnswer.trim().length === 0) {
    return { status: 'graded', results: [], totalScore: 0, maxScore: 0, modelUsed: null };
  }

  const style = markingStyle(input.subject ?? '');
  const system = [
    'You are a Lebanese Baccalaureate examiner. This question reached us without its official',
    'marking scheme, so you must first say what the marks are for, and then award them.',
    '',
    ...(STYLE_RULES[style].length ? [...STYLE_RULES[style], ''] : []),
    'Rules:',
    '- Propose the criteria a Lebanese examiner would actually use for this question, in the order',
    '  the question asks for them. One criterion per thing being assessed.',
    '- GROUND EACH ONE. Copy into grounded_in the sentence from the course material below that',
    '  supports it. Where the course material does not support a criterion, return an empty string:',
    '  do not paraphrase and do not invent a citation. Ungrounded criteria are discarded.',
    '- Then mark the student against your own criteria. Each is MET or NOT MET, never in between.',
    '- Set markable to false if the question depends on a figure, document or printed passage you',
    '  were not given. Do not guess at what it showed.',
    `- Write justification and explanation in ${LANGUAGE_NAME[input.language]}, addressed to the student.`,
    '',
    'You are proposing a scheme, not reciting one. Be the examiner this paper should have had.',
  ].join('\n');

  const userPrompt = [
    '# Question',
    input.questionText,
    ...(input.statedMarks ? ['', `# The paper says this question is worth ${input.statedMarks} marks`] : []),
    ...(input.officialSolution ? ['', '# Official solution (reference only)', input.officialSolution] : []),
    '',
    '# Course material',
    input.courseMaterial || '(none retrieved)',
    '',
    '# The answer the student wrote',
    input.studentAnswer,
  ].join('\n');

  try {
    const provider = ai();
    const response = await provider.completeJson({
      system,
      messages: [{ role: 'user', content: userPrompt }],
      schema: PROPOSED_SCHEMA as unknown as Record<string, unknown>,
      schemaName: 'provisional_marking',
      effort: 'high',
      model: provider.verifyModel,
      parse: (value) => proposedSchema.parse(value),
    });

    if (!response.data.markable) {
      return {
        status: 'needs_human_review',
        results: [],
        totalScore: 0,
        maxScore: 0,
        modelUsed: response.modelUsed,
        reason: 'The question depends on a figure or passage that is not stored with it.',
      };
    }

    const grounded = response.data.criteria.filter((c) => groundedIn(c.grounded_in, input.courseMaterial));

    if (grounded.length === 0) {
      return {
        status: 'needs_human_review',
        results: [],
        totalScore: 0,
        maxScore: 0,
        modelUsed: response.modelUsed,
        reason: 'No proposed criterion could be grounded in the course material.',
      };
    }

    const rawTotal = grounded.reduce((sum, c) => sum + Math.max(c.points, 0), 0) || 1;
    const scale = input.statedMarks && input.statedMarks > 0 ? input.statedMarks / rawTotal : 1;

    const bareme: Bareme = grounded.map((c) => ({
      criterion: c.criterion,
      points: round2(Math.max(c.points, 0) * scale),
    }));

    const results: BaremeResultItem[] = grounded.map((c, i) => {
      const possible = bareme[i]!.points;
      const awarded = pointsFor(bareme[i]!, c.met);
      return {
        criterion: c.criterion,
        points_awarded: round2(awarded),
        points_possible: possible,
        justification: c.justification,
        explanation: awarded < possible ? c.explanation : '',
        provisional: true,
      };
    });

    return {
      status: 'graded_provisional',
      results,
      totalScore: round2(results.reduce((s, r) => s + r.points_awarded, 0)),
      maxScore: round2(bareme.reduce((s, c) => s + c.points, 0)),
      modelUsed: response.modelUsed,
      provisionalBareme: bareme,
    };
  } catch {
    return {
      status: 'needs_human_review',
      results: [],
      totalScore: 0,
      maxScore: 0,
      modelUsed: null,
      reason: 'The marker could not be reached, or returned an unusable response.',
    };
  }
}

/**
 * Is this citation actually in the material we sent?
 *
 * Whitespace-folded on both sides and matched on a prefix, because a model
 * copying a sentence out of a passage reliably reproduces its words and does
 * not reliably reproduce the line breaks a PDF put through the middle of it.
 * Short strings are refused outright: "the cell" appears in any biology
 * chapter and grounds nothing.
 */
export function groundedIn(citation: string, material: string): boolean {
  const fold = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const cite = fold(citation);
  if (cite.length < 20) return false;
  return fold(material).includes(cite.slice(0, 60));
}
