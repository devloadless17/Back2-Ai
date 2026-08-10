import 'server-only';

import type { ExamSourceMode, Prisma } from '@prisma/client';

import { AuditAction, recordAudit } from '@/lib/audit';
import { db } from '@/lib/db';
import { PUBLISHED_FILTER } from '@/lib/generation';
import {
  baremeMaxScore,
  checkOcrConsistency,
  gradeAgainstBareme,
  parseBareme,
  type Bareme,
} from '@/lib/grading';
import type { Locale } from '@/lib/i18n/config';
import { recomputeChapterMastery } from '@/lib/queries/progress';

/**
 * Exam simulation: composition, submission, marking.
 *
 * The timer is server-authoritative. `expires_at` is written when the paper is
 * started and every write is checked against it. The countdown in the browser
 * is a display of that deadline, not the deadline itself — a client-trusted
 * timer in an examination product is not a bug, it is the absence of the
 * feature.
 *
 * Barèmes are snapshotted onto `exam_simulation_questions` at composition time.
 * Editing a question afterwards must not silently re-mark a paper that was
 * already sat under the old scheme.
 */

/** Questions in a composed paper. Enough to be a real sitting, few enough to mark. */
const AI_PAPER_QUESTION_COUNT = 5;

/** Fallback duration when a paper carries none. */
export const DEFAULT_DURATION_MINUTES = 180;

export class ExamError extends Error {
  constructor(
    readonly code:
      | 'NO_CONTENT'
      | 'NOT_FOUND'
      | 'ALREADY_SUBMITTED'
      | 'EXPIRED'
      | 'IN_PROGRESS_EXISTS'
      | 'NO_BAREME',
    message: string,
  ) {
    super(message);
    this.name = 'ExamError';
  }
}

export type StartInput = {
  userId: string;
  subjectId: string;
  sourceMode: ExamSourceMode;
  examCycleId?: string | null;
};

export async function startSimulation(input: StartInput): Promise<{ id: string }> {
  const existing = await db.examSimulation.findFirst({
    where: { userId: input.userId, status: 'in_progress' },
    select: { id: true, expiresAt: true },
  });

  if (existing) {
    // A live paper is a live paper. Starting a second one would let a student
    // shop for an easier draw while the first clock runs.
    if (existing.expiresAt.getTime() > Date.now()) {
      throw new ExamError('IN_PROGRESS_EXISTS', 'You already have a simulation in progress.');
    }
    await submitSimulation({ simulationId: existing.id, userId: input.userId, auto: true, locale: 'fr' });
  }

  return input.sourceMode === 'real_cycle'
    ? startFromRealCycle(input)
    : startFromGeneratedPool(input);
}

async function startFromRealCycle(input: StartInput): Promise<{ id: string }> {
  if (!input.examCycleId) throw new ExamError('NOT_FOUND', 'No paper was chosen.');

  const cycle = await db.examCycle.findFirst({
    where: { id: input.examCycleId, subjectId: input.subjectId },
    select: { id: true, durationMinutes: true },
  });
  if (!cycle) throw new ExamError('NOT_FOUND', 'That paper does not exist for this subject.');

  const questions = await db.question.findMany({
    where: { sourceExamId: cycle.id, verifiedStatus: { not: 'rejected' } },
    select: { id: true, bareme: true, orderIndex: true },
    orderBy: [{ orderIndex: 'asc' }, { createdAt: 'asc' }],
  });

  if (questions.length === 0) {
    throw new ExamError('NO_CONTENT', 'This paper has no questions ingested yet.');
  }

  const startedAt = new Date();
  const duration = cycle.durationMinutes || DEFAULT_DURATION_MINUTES;

  const simulation = await db.examSimulation.create({
    data: {
      userId: input.userId,
      subjectId: input.subjectId,
      sourceMode: 'real_cycle',
      examCycleId: cycle.id,
      durationMinutes: duration,
      expiresAt: new Date(startedAt.getTime() + duration * 60_000),
      maxScore: totalOf(questions.map((q) => parseBareme(q.bareme))),
      questions: {
        create: questions.map((question, index) => ({
          questionId: question.id,
          orderIndex: index,
          baremeSnapshot: (question.bareme as Prisma.InputJsonValue) ?? undefined,
          maxScore: scoreOf(parseBareme(question.bareme)),
        })),
      },
    },
    select: { id: true },
  });

  await recordAudit({
    actorUserId: input.userId,
    action: AuditAction.EXAM_SIM_STARTED,
    targetType: 'exam_simulation',
    targetId: simulation.id,
    metadata: { mode: 'real_cycle', examCycleId: cycle.id, durationMinutes: duration },
  });

  return simulation;
}

/**
 * Composes a paper from generated problems.
 *
 * Only approved, published problems are eligible — an AI-composed paper is not
 * a way around the review gate. Problems are drawn from distinct chapters where
 * possible, because five questions from one chapter is a chapter test, not a
 * simulation of a Bac paper.
 */
/**
 * Selects the questions for an AI-composed paper.
 *
 * Only approved, published problems are eligible — composing a paper is not a
 * way around the review gate. Problems are drawn from distinct chapters where
 * possible: five questions from one chapter is a chapter test, not a Bac paper.
 *
 * Exported because the exec plan exposes composition as its own endpoint
 * (`/exam-sim/[id]/generate`) as well as folding it into paper creation.
 */
export async function selectGeneratedQuestions(subjectId: string) {
  const pool = await db.generatedProblem.findMany({
    where: { chapter: { subjectId }, ...PUBLISHED_FILTER },
    select: { id: true, chapterId: true, bareme: true, difficulty: true },
    orderBy: { publishedAt: 'desc' },
    take: 60,
  });

  if (pool.length === 0) {
    throw new ExamError(
      'NO_CONTENT',
      'No approved generated problems are available for this subject yet.',
    );
  }

  const chosen: typeof pool = [];
  const usedChapters = new Set<string>();

  for (const problem of pool) {
    if (chosen.length >= AI_PAPER_QUESTION_COUNT) break;
    if (usedChapters.has(problem.chapterId)) continue;
    chosen.push(problem);
    usedChapters.add(problem.chapterId);
  }
  // Top up from the remainder if the subject does not have enough distinct
  // chapters with approved problems yet.
  for (const problem of pool) {
    if (chosen.length >= AI_PAPER_QUESTION_COUNT) break;
    if (chosen.some((c) => c.id === problem.id)) continue;
    chosen.push(problem);
  }

  // Easiest first, the way a real paper is ordered.
  chosen.sort((a, b) => Number(a.difficulty ?? 0.5) - Number(b.difficulty ?? 0.5));

  return chosen;
}

/**
 * Composes the question set for an AI-generated simulation that has none.
 *
 * Idempotent: a paper that already has questions is returned untouched. That
 * matters because this is reachable as its own endpoint — re-composing a live
 * paper mid-sitting would swap the questions under a student who is answering
 * them.
 */
export async function composeGeneratedPaper(
  simulationId: string,
  userId: string,
): Promise<{ composed: boolean; questionCount: number }> {
  const simulation = await db.examSimulation.findFirst({
    where: { id: simulationId, userId },
    select: {
      id: true,
      subjectId: true,
      sourceMode: true,
      status: true,
      _count: { select: { questions: true } },
    },
  });

  if (!simulation) throw new ExamError('NOT_FOUND', 'Simulation not found.');
  if (simulation.sourceMode !== 'ai_generated') {
    throw new ExamError('NOT_FOUND', 'This paper is a real cycle; there is nothing to compose.');
  }
  if (simulation.status !== 'in_progress') {
    throw new ExamError('ALREADY_SUBMITTED', 'This paper has already been submitted.');
  }
  if (simulation._count.questions > 0) {
    return { composed: false, questionCount: simulation._count.questions };
  }

  const chosen = await selectGeneratedQuestions(simulation.subjectId);

  await db.$transaction([
    db.examSimulationQuestion.createMany({
      data: chosen.map((problem, index) => ({
        examSimulationId: simulation.id,
        generatedProblemId: problem.id,
        orderIndex: index,
        baremeSnapshot: (problem.bareme as Prisma.InputJsonValue) ?? undefined,
        maxScore: scoreOf(parseBareme(problem.bareme)),
      })),
    }),
    db.examSimulation.update({
      where: { id: simulation.id },
      data: { maxScore: totalOf(chosen.map((p) => parseBareme(p.bareme))) },
    }),
  ]);

  return { composed: true, questionCount: chosen.length };
}

async function startFromGeneratedPool(input: StartInput): Promise<{ id: string }> {
  const chosen = await selectGeneratedQuestions(input.subjectId);

  const startedAt = new Date();
  const duration = DEFAULT_DURATION_MINUTES;

  const simulation = await db.examSimulation.create({
    data: {
      userId: input.userId,
      subjectId: input.subjectId,
      sourceMode: 'ai_generated',
      durationMinutes: duration,
      expiresAt: new Date(startedAt.getTime() + duration * 60_000),
      maxScore: totalOf(chosen.map((p) => parseBareme(p.bareme))),
      questions: {
        create: chosen.map((problem, index) => ({
          generatedProblemId: problem.id,
          orderIndex: index,
          baremeSnapshot: (problem.bareme as Prisma.InputJsonValue) ?? undefined,
          maxScore: scoreOf(parseBareme(problem.bareme)),
        })),
      },
    },
    select: { id: true },
  });

  await recordAudit({
    actorUserId: input.userId,
    action: AuditAction.EXAM_SIM_STARTED,
    targetType: 'exam_simulation',
    targetId: simulation.id,
    metadata: { mode: 'ai_generated', questionCount: chosen.length },
  });

  return simulation;
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

const SIMULATION_INCLUDE = {
  subject: { select: { id: true, name: true, language: true } },
  examCycle: { select: { id: true, title: true, year: true, session: true } },
  questions: {
    orderBy: { orderIndex: 'asc' },
    include: {
      question: {
        select: {
          id: true,
          contentText: true,
          contentLatex: true,
          contentImages: true,
          questionType: true,
          options: true,
          officialSolution: true,
          chapter: { select: { id: true, name: true } },
        },
      },
      generatedProblem: {
        select: {
          id: true,
          contentText: true,
          contentLatex: true,
          generatedSolution: true,
          chapter: { select: { id: true, name: true } },
        },
      },
      answer: true,
    },
  },
} satisfies Prisma.ExamSimulationInclude;

export type LoadedSimulation = Prisma.ExamSimulationGetPayload<{ include: typeof SIMULATION_INCLUDE }>;

/** Loads a simulation, scoped to its owner. A student can only ever load their own. */
export async function loadSimulation(simulationId: string, userId: string): Promise<LoadedSimulation | null> {
  return db.examSimulation.findFirst({
    where: { id: simulationId, userId },
    include: SIMULATION_INCLUDE,
  });
}

export function remainingSeconds(simulation: { expiresAt: Date; status: string }): number {
  if (simulation.status !== 'in_progress') return 0;
  return Math.max(0, Math.floor((simulation.expiresAt.getTime() - Date.now()) / 1000));
}

/** Question text for a slot, whichever kind of question fills it. */
export function slotContent(slot: LoadedSimulation['questions'][number]): {
  contentText: string;
  contentLatex: string | null;
  contentImages: string[];
  chapterName: string | null;
  officialSolution: string | null;
} {
  if (slot.question) {
    return {
      contentText: slot.question.contentText,
      contentLatex: slot.question.contentLatex,
      contentImages: slot.question.contentImages,
      chapterName: slot.question.chapter?.name ?? null,
      officialSolution: slot.question.officialSolution,
    };
  }
  if (slot.generatedProblem) {
    return {
      contentText: slot.generatedProblem.contentText,
      contentLatex: slot.generatedProblem.contentLatex,
      contentImages: [],
      chapterName: slot.generatedProblem.chapter?.name ?? null,
      officialSolution: slot.generatedProblem.generatedSolution,
    };
  }
  return {
    contentText: '',
    contentLatex: null,
    contentImages: [],
    chapterName: null,
    officialSolution: null,
  };
}

// ---------------------------------------------------------------------------
// Answering
// ---------------------------------------------------------------------------

export type SaveAnswerInput = {
  simulationId: string;
  userId: string;
  slotId: string;
  typedAnswer?: string;
  photo?: { url: string; extractedText: string };
};

export type SaveAnswerResult =
  | { status: 'saved' }
  | { status: 'photo_rejected'; notes: string };

/**
 * Records an answer during the sitting. Nothing is marked here — marking runs
 * at submission, once, so a student cannot use per-question feedback to work
 * out the answer while the clock is still running.
 */
export async function saveAnswer(input: SaveAnswerInput): Promise<SaveAnswerResult> {
  const simulation = await db.examSimulation.findFirst({
    where: { id: input.simulationId, userId: input.userId },
    select: { id: true, status: true, expiresAt: true },
  });

  if (!simulation) throw new ExamError('NOT_FOUND', 'Simulation not found.');
  if (simulation.status !== 'in_progress') {
    throw new ExamError('ALREADY_SUBMITTED', 'This paper has already been submitted.');
  }
  if (simulation.expiresAt.getTime() <= Date.now()) {
    throw new ExamError('EXPIRED', 'Time is up for this paper.');
  }

  const slot = await db.examSimulationQuestion.findFirst({
    where: { id: input.slotId, examSimulationId: simulation.id },
    select: { id: true, question: { select: { contentText: true } }, generatedProblem: { select: { contentText: true } } },
  });
  if (!slot) throw new ExamError('NOT_FOUND', 'That question is not part of this paper.');

  if (input.photo) {
    const questionText = slot.question?.contentText ?? slot.generatedProblem?.contentText ?? '';
    const consistency = await checkOcrConsistency(questionText, input.photo.extractedText);

    await db.examAnswer.upsert({
      where: { examSimulationQuestionId: slot.id },
      create: {
        examSimulationQuestionId: slot.id,
        submissionType: 'photo',
        photoUrl: input.photo.url,
        ocrExtractedText: input.photo.extractedText,
        ocrConsistencyChecked: true,
        ocrConsistencyPassed: consistency.passed,
        ocrConsistencyNotes: consistency.notes,
      },
      update: {
        submissionType: 'photo',
        photoUrl: input.photo.url,
        ocrExtractedText: input.photo.extractedText,
        ocrConsistencyChecked: true,
        ocrConsistencyPassed: consistency.passed,
        ocrConsistencyNotes: consistency.notes,
        typedAnswer: null,
      },
    });

    if (!consistency.passed) {
      await recordAudit({
        actorUserId: input.userId,
        action: AuditAction.EXAM_ANSWER_REJECTED_OCR,
        targetType: 'exam_simulation_question',
        targetId: slot.id,
        metadata: { confidence: consistency.confidence, notes: consistency.notes },
      });
      return { status: 'photo_rejected', notes: consistency.notes };
    }

    return { status: 'saved' };
  }

  await db.examAnswer.upsert({
    where: { examSimulationQuestionId: slot.id },
    create: {
      examSimulationQuestionId: slot.id,
      submissionType: 'typed',
      typedAnswer: input.typedAnswer ?? '',
    },
    update: {
      submissionType: 'typed',
      typedAnswer: input.typedAnswer ?? '',
      photoUrl: null,
      ocrExtractedText: null,
      ocrConsistencyChecked: false,
      ocrConsistencyPassed: null,
      ocrConsistencyNotes: null,
    },
  });

  return { status: 'saved' };
}

// ---------------------------------------------------------------------------
// Submission and marking
// ---------------------------------------------------------------------------

export type SubmitInput = {
  simulationId: string;
  userId: string;
  auto: boolean;
  locale: Locale;
};

/**
 * Submits and marks a paper.
 *
 * Marking is sequential rather than parallel: it runs on the verify model at
 * high effort, and firing twenty of those at once is how you get rate-limited
 * halfway through a student's paper and leave it half-marked.
 */
export async function submitSimulation(
  input: SubmitInput,
): Promise<{ totalScore: number; maxScore: number; unmarked: number }> {
  const simulation = await db.examSimulation.findFirst({
    where: { id: input.simulationId, userId: input.userId },
    include: SIMULATION_INCLUDE,
  });

  if (!simulation) throw new ExamError('NOT_FOUND', 'Simulation not found.');
  if (simulation.status === 'graded') {
    return {
      totalScore: Number(simulation.totalScore ?? 0),
      maxScore: Number(simulation.maxScore ?? 0),
      unmarked: simulation.questions.filter((slot) => slot.answer?.gradedAt && slot.answer.totalScore === null)
        .length,
    };
  }

  const submittedAt = new Date();
  await db.examSimulation.update({
    where: { id: simulation.id },
    data: { status: 'submitted', submittedAt },
  });

  await recordAudit({
    actorUserId: input.userId,
    action: input.auto ? AuditAction.EXAM_SIM_AUTO_SUBMITTED : AuditAction.EXAM_SIM_SUBMITTED,
    targetType: 'exam_simulation',
    targetId: simulation.id,
    metadata: { questionCount: simulation.questions.length },
  });

  const marks: MarkEntry[] = [];
  const touchedChapters = new Set<string>();

  for (const slot of simulation.questions) {
    const bareme = parseBareme(slot.baremeSnapshot);
    const content = slotContent(slot);

    if (!bareme) {
      // No marking scheme means no defensible mark. Recorded as unmarked
      // rather than as a zero.
      marks.push({ status: 'needs_human_review', totalScore: 0, maxScore: 0 });
      continue;
    }

    const studentAnswer = answerTextOf(slot.answer);
    const outcome = await gradeAgainstBareme({
      questionText: content.contentText,
      officialSolution: content.officialSolution,
      bareme,
      studentAnswer,
      language: simulation.subject.language,
    });

    /*
     * A question the marker could not mark is NOT a zero.
     *
     * It is excluded from both the awarded total and the available total, and
     * its score is stored as null so the results screen can say "awaiting
     * marking" rather than showing a 0 the student will read as a fail. The
     * failure here is ours — the provider was unreachable, or returned
     * something unusable — and presenting it as their mark would be a lie the
     * student has no way to see through.
     */
    const needsHuman = outcome.status === 'needs_human_review';

    marks.push({
      status: outcome.status,
      totalScore: outcome.totalScore,
      maxScore: outcome.maxScore,
    });

    await db.examAnswer.upsert({
      where: { examSimulationQuestionId: slot.id },
      create: {
        examSimulationQuestionId: slot.id,
        submissionType: 'typed',
        typedAnswer: '',
        baremeResult: outcome.results as unknown as Prisma.InputJsonValue,
        totalScore: needsHuman ? null : outcome.totalScore,
        maxScore: needsHuman ? null : outcome.maxScore,
        gradedAt: new Date(),
      },
      update: {
        baremeResult: outcome.results as unknown as Prisma.InputJsonValue,
        totalScore: needsHuman ? null : outcome.totalScore,
        maxScore: needsHuman ? null : outcome.maxScore,
        gradedAt: new Date(),
      },
    });

    // Marking failures reach a human rather than sitting silently in a
    // student's result. One item per paper, not one per question.
    if (needsHuman && marks.filter((m) => m.status === 'needs_human_review').length === 1) {
      await db.reviewQueueItem.create({
        data: {
          itemType: 'flagged_content',
          itemId: simulation.id,
          flagReason:
            `Automatic marking failed on a submitted paper (${simulation.subject.name}). ` +
            `Reason: ${outcome.reason ?? 'unknown'}. This paper needs marking by hand.`,
          flaggedByUserId: null,
        },
      });
    }

    // Exam-sim answers count towards mastery, exactly like practice — this is
    // the same student demonstrating the same knowledge.
    const chapterId = slot.question?.chapter?.id ?? slot.generatedProblem?.chapter?.id ?? null;
    if (chapterId) {
      touchedChapters.add(chapterId);
      await db.attempt.create({
        data: {
          userId: input.userId,
          questionId: slot.questionId,
          generatedProblemId: slot.generatedProblemId,
          isCorrect: null,
          submittedAnswer: studentAnswer.slice(0, 20_000),
          // An unmarked answer contributes to the attempt count but carries no
          // score, so the mastery formula skips it instead of reading it as a
          // failure the student never made.
          score: needsHuman ? null : outcome.totalScore,
          maxScore: needsHuman ? null : outcome.maxScore,
          context: 'exam_sim',
        },
      });
    }
  }

  const { totalScore, maxScore, unmarked } = tallyMarks(marks);

  await db.examSimulation.update({
    where: { id: simulation.id },
    data: {
      status: 'graded',
      totalScore,
      maxScore,
      gradedAt: new Date(),
    },
  });

  for (const chapterId of touchedChapters) {
    await recomputeChapterMastery(input.userId, chapterId);
  }

  await recordAudit({
    actorUserId: input.userId,
    action: AuditAction.EXAM_SIM_GRADED,
    targetType: 'exam_simulation',
    targetId: simulation.id,
    metadata: { totalScore, maxScore, unmarked },
  });

  return { totalScore, maxScore, unmarked };
}

/**
 * What the marker is given.
 *
 * A photo whose OCR failed the consistency gate contributes nothing rather than
 * being marked on unreadable text — the student is told to re-shoot during the
 * sitting, and if they never did, the answer is treated as not submitted.
 *
 * Exported for tests: this decides what a marker sees, and getting it wrong
 * means marking a student on OCR noise.
 */
export function answerTextOf(
  answer: {
    typedAnswer: string | null;
    ocrExtractedText: string | null;
    ocrConsistencyPassed: boolean | null;
  } | null,
): string {
  if (!answer) return '';
  if (answer.ocrExtractedText !== null) {
    return answer.ocrConsistencyPassed === false ? '' : answer.ocrExtractedText;
  }
  return answer.typedAnswer ?? '';
}

export type MarkEntry = {
  /** 'needs_human_review' means the marker could not mark it — never a zero. */
  status: 'graded' | 'needs_human_review';
  totalScore: number;
  maxScore: number;
};

/**
 * Totals a marked paper.
 *
 * The rule this encodes, and the reason it is a separate pure function rather
 * than an accumulator inside the submit loop: a question the marker could not
 * mark is excluded from BOTH sides of the fraction. Counting it as 0/n would
 * report our outage as the student's failure; counting it as n/n would invent
 * marks they did not earn. It is simply not part of the total yet.
 */
export function tallyMarks(entries: MarkEntry[]): {
  totalScore: number;
  maxScore: number;
  unmarked: number;
} {
  let totalScore = 0;
  let maxScore = 0;
  let unmarked = 0;

  for (const entry of entries) {
    if (entry.status === 'needs_human_review') {
      unmarked += 1;
      continue;
    }
    totalScore += entry.totalScore;
    maxScore += entry.maxScore;
  }

  return { totalScore: round2(totalScore), maxScore: round2(maxScore), unmarked };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function scoreOf(bareme: Bareme | null): number | null {
  return bareme ? baremeMaxScore(bareme) : null;
}

function totalOf(baremes: (Bareme | null)[]): number {
  return baremes.reduce<number>((sum, b) => sum + (b ? baremeMaxScore(b) : 0), 0);
}

/**
 * Sweeps papers whose deadline passed without a submit.
 *
 * A student who closes the tab must still get a marked paper — the clock ran,
 * so the sitting happened. Called by the cron handler.
 */
export async function autoSubmitExpired(limit = 20): Promise<number> {
  const expired = await db.examSimulation.findMany({
    where: { status: 'in_progress', expiresAt: { lte: new Date() } },
    select: { id: true, userId: true, subject: { select: { language: true } } },
    take: limit,
  });

  let count = 0;
  for (const simulation of expired) {
    try {
      await submitSimulation({
        simulationId: simulation.id,
        userId: simulation.userId,
        auto: true,
        locale: simulation.subject.language,
      });
      count += 1;
    } catch (err) {
      console.error('[exam] auto-submit failed', simulation.id, err);
    }
  }
  return count;
}
