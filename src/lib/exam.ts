import 'server-only';

import type { ExamSourceMode, Prisma } from '@prisma/client';

import { AuditAction, recordAudit } from '@/lib/audit';
import { db } from '@/lib/db';
import { PUBLISHED_FILTER } from '@/lib/generation';
import {
  baremeMaxScore,
  checkOcrConsistency,
  gradeAgainstBareme,
  gradeWithoutBareme,
  parseBareme,
  statedMarksOf,
  type Bareme,
} from '@/lib/grading';
import type { Locale } from '@/lib/i18n/config';
import { recomputeChapterMastery } from '@/lib/queries/progress';
import { rescaleBaremes } from '@/lib/rescale-bareme';
import { retrieveGrounding } from '@/lib/retrieval';

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
    await submitSimulation({ simulationId: existing.id, userId: input.userId, auto: true });
  }

  if (input.sourceMode === 'real_cycle') return startFromRealCycle(input);
  if (input.sourceMode === 'real_mixed') return startFromRealPool(input);
  return startFromGeneratedPool(input);
}

/**
 * How long a mock paper runs.
 *
 * A fixed two hours, because an assembled paper is always worth the same twenty
 * marks and a real paper's duration is a property of the paper rather than of
 * how many pieces it was cut into. This used to be twenty minutes a question,
 * which made a four-question paper shorter than a five-question one of exactly
 * the same weight.
 *
 * `TUNABLE` — `src/lib/exam.ts`.
 */
const ASSEMBLED_PAPER_MINUTES = 120;

/**
 * A mock paper built from real questions the student has not met.
 *
 * The mode that should have existed all along. `real_cycle` can only offer a
 * paper once — after that the student has seen it — and `ai_generated` waits on
 * a review queue that has approved one problem in the life of the database.
 * Meanwhile the corpus holds thousands of real past-exam questions with real
 * barèmes, every one of them already vetted by having been printed by the
 * ministry. This arranges those into a paper.
 *
 * Three rules decide what goes in.
 *
 * Nothing they have already attempted, so a mock paper measures recall rather
 * than memory of last week's practice. It is a preference and not a hard filter:
 * a student who has worked through most of a subject should still be given a
 * paper, and being asked a question a second time is a far smaller problem than
 * being told there is nothing to sit.
 *
 * Only questions carrying a barème, because a paper that cannot be marked is
 * not a paper. That drops the extracted rows whose marks the extractor could
 * not read, which is the honest thing to do with them here.
 *
 * Then `chooseQuestions`, the same rule the generated papers use: spread across
 * chapters, and never two large exercises from one chapter.
 */
async function startFromRealPool(input: StartInput): Promise<{ id: string }> {
  const [subject, seen] = await Promise.all([
    db.subject.findUnique({ where: { id: input.subjectId }, select: { name: true } }),
    db.attempt.findMany({
      where: { userId: input.userId, questionId: { not: null } },
      select: { questionId: true },
    }),
  ]);
  const seenIds = new Set(seen.flatMap((a) => (a.questionId ? [a.questionId] : [])));
  const isLanguageArts = LANGUAGE_ARTS_SUBJECTS.has(subject?.name ?? '');

  const pool = await db.question.findMany({
    where: {
      chapter: { subjectId: input.subjectId },
      sourceType: 'past_exam',
      verifiedStatus: { not: 'rejected' },
    },
    select: {
      id: true,
      chapterId: true,
      bareme: true,
      difficulty: true,
      contentText: true,
      questionType: true,
    },
    take: 400,
  });

  /*
   * A paper that cannot be marked is not a paper.
   *
   * Filtered through `parseBareme` rather than by a `bareme IS NOT NULL` clause
   * in the query, because a row can carry an empty array — a barème the
   * extractor started and could not read marks for. That passes a null check
   * and still totals zero, which would put an unmarkable question on a real
   * sitting and score the student out of less than the paper is worth.
   */
  const markable = pool.filter((q) => (scoreOf(parseBareme(q.bareme)) ?? 0) > 0);

  if (markable.length === 0) {
    throw new ExamError(
      'NO_CONTENT',
      'This subject has no marked past-exam questions to assemble a paper from yet.',
    );
  }

  // Unseen first, then the rest — `chooseQuestions` walks the pool in order, so
  // ordering it is how the preference is expressed.
  const unseen = markable.filter((q) => !seenIds.has(q.id));
  const ordered = [...shuffle(unseen), ...shuffle(markable.filter((q) => seenIds.has(q.id)))];

  /*
   * Exact first, rescaled only if that fails.
   *
   * When the pool can make exactly 20 out of the marks the ministry printed,
   * that is the better paper by a distance: every mark on it is the official
   * one, and composing it costs nothing. Only when no subset reaches 20 —
   * physics, whose exercises the extractor merges, so its marks are lumpy — is
   * a paper assembled near the target and its marks redistributed.
   *
   * English, Francais and Arabic literature skip this search entirely.
   * `assemblePaper` looks for three to six exercises that sum to twenty
   * because that is the shape a maths or physics paper has; a language-arts
   * paper has two — one reading/comprehension block and one writing block,
   * each worth ten or so marks on its own. Two is below the search's own
   * floor, so it always failed for these subjects, and the generic fallback
   * then favoured the many small essay prompts over the few large reading
   * ones — which is how mock English papers went essay-only even though the
   * comprehension questions were sitting in the same pool.
   */
  let chosen = isLanguageArts ? (assembleLanguageArtsPaper(ordered) ?? []) : assemblePaper(ordered);
  let rescaled = false;

  if (chosen.length === 0 && !isLanguageArts) {
    /*
     * The same shape rule the exact search enforces.
     *
     * `chooseQuestions` fills slots and stops; it has no opinion about how few
     * is too few. Without this floor a subject holding one question produced a
     * "paper" of that one question, rescaled to be worth all twenty marks —
     * which is not a Bac paper, and is a worse answer than saying there is none.
     */
    const near = chooseQuestions(ordered, AI_PAPER_QUESTION_COUNT);
    if (near.length >= MIN_PAPER_QUESTIONS) {
      chosen = near;
      rescaled = true;
    }
  }

  if (chosen.length === 0) {
    throw new ExamError(
      'NO_CONTENT',
      isLanguageArts
        ? 'This subject does not have both a reading and a writing past-exam question to build a paper from yet.'
        : `This subject does not have enough marked past-exam questions to build a paper — ` +
          `at least ${MIN_PAPER_QUESTIONS} are needed.`,
    );
  }

  /*
   * The marks this paper is actually sat under.
   *
   * Written to `bareme_snapshot`, which is the copy marking reads and the only
   * thing that changes — every question keeps the barème the ministry printed,
   * so the corpus is untouched and a second paper drawn from the same questions
   * starts from the official marks again.
   */
  const officialBaremes = chosen.map((q) => parseBareme(q.bareme) ?? []);
  // A language-arts pair is the paper's real shape even when its two halves
  // do not happen to total twenty themselves — `rescaleBaremes` is a no-op
  // when they already do, so this only ever adjusts the pairs that need it.
  if (isLanguageArts) rescaled = Math.abs(totalOf(officialBaremes) - PAPER_TOTAL_MARKS) > 0.001;
  const baremes = rescaled
    ? await rescaleBaremes(officialBaremes, PAPER_TOTAL_MARKS)
    : officialBaremes;

  const startedAt = new Date();
  const duration = ASSEMBLED_PAPER_MINUTES;

  const simulation = await db.examSimulation.create({
    data: {
      userId: input.userId,
      subjectId: input.subjectId,
      sourceMode: 'real_mixed',
      durationMinutes: duration,
      expiresAt: new Date(startedAt.getTime() + duration * 60_000),
      maxScore: totalOf(baremes),
      questions: {
        create: chosen.map((question, index) => ({
          questionId: question.id,
          orderIndex: index,
          baremeSnapshot: (baremes[index] as Prisma.InputJsonValue) ?? undefined,
          maxScore: scoreOf(baremes[index] ?? null),
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
    metadata: {
      mode: 'real_mixed',
      questionCount: chosen.length,
      unseenInPool: unseen.length,
      durationMinutes: duration,
      // Whether this paper carries the ministry's marks or redistributed ones.
      // Worth recording: it is the difference between a mark a student can
      // quote and one that is ours.
      rescaled,
      paperShape: isLanguageArts ? 'reading_writing' : 'assembled',
    },
  });

  return simulation;
}

/**
 * Fisher-Yates, so two students of the same subject on the same day do not sit
 * the same paper. Without it the pool comes back in insertion order and the
 * selection is deterministic — which would also mean a student who abandons a
 * paper and starts another gets the identical one.
 */
function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
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
/**
 * What a problem is worth, from its own barème.
 *
 * The marks rather than the character count, because the marks are the paper's
 * own statement of weight and the length is a proxy for it. They agree in this
 * corpus — the three-mark integrals run to about 110 characters and the
 * twelve-mark pharmacology exercises to about 2,300 — but a terse question
 * carrying half the paper is exactly the case the proxy would get wrong.
 *
 * Falls back to length only where no barème was written, since a problem with
 * no scheme still has to be placed somewhere.
 */
function weightOf(problem: { bareme: unknown; contentText?: string }): number {
  if (Array.isArray(problem.bareme)) {
    const total = problem.bareme.reduce(
      (sum, criterion) => sum + Number((criterion as { points?: unknown })?.points ?? 0),
      0,
    );
    if (total > 0) return total;
  }
  // ~1 mark per 250 characters, calibrated against the pairs above.
  return Math.round((problem.contentText?.length ?? 0) / 250);
}

/**
 * The mark from which an exercise is a major one.
 *
 * A Lebanese paper is out of 20 across four or five exercises, so anything
 * carrying five marks or more is a quarter of the sitting. Two of those drawn
 * from one chapter is the failure this guards against: a candidate can lose
 * half the paper to a single topic they happened not to revise, which measures
 * their luck rather than their preparation.
 *
 * `TUNABLE` — `src/lib/exam.ts`.
 */
const LARGE_QUESTION_MARKS = 5;

/**
 * Picks the problems for a generated paper.
 *
 * Three passes, and the order matters.
 *
 * The first takes at most one problem per chapter, which is the spread a real
 * paper has. The second tops up when the subject has fewer chapters with
 * approved problems than the paper needs slots — and it is the one that used to
 * undo the first, because it accepted anything left in the pool. A subject with
 * two well-covered chapters could produce a five-question paper in which three
 * questions, and most of the marks, came from one of them.
 *
 * So the top-up now keeps one rule: **never a second large exercise from a
 * chapter that has already contributed one.** Small questions may double up —
 * two three-mark integrals from the same chapter cost a candidate very little —
 * but two twelve-mark exercises decide the paper between them.
 *
 * The rule is absolute rather than best-effort. If it cannot be satisfied the
 * paper comes back short, because a four-question paper that samples four
 * chapters is a better measurement than a five-question paper that samples
 * three and weights one of them double.
 */
/** The shape the selection rule needs. Anything else on a problem is irrelevant to it. */
export type SelectableProblem = {
  id: string;
  chapterId: string;
  bareme: unknown;
  difficulty: unknown;
  contentText?: string;
};

/**
 * Subjects examined as a reading/comprehension part plus a writing part,
 * rather than several small exercises — the exact names `subjects.name`
 * holds for them in the corpus. `assemblePaper`'s three-to-six-exercise
 * search can never fit this shape, so these subjects use
 * `assembleLanguageArtsPaper` instead. See the comment at its call site in
 * `startFromRealPool`.
 */
const LANGUAGE_ARTS_SUBJECTS = new Set(['English', 'Francais', 'أدب عربي']);

/**
 * A language-arts paper's real shape: one reading/comprehension question and
 * one writing question, unseen ones preferred — `pool` is already ordered
 * that way by the caller. Returns `null` only when the subject's pool is
 * missing one of the two halves outright.
 */
function assembleLanguageArtsPaper<T extends SelectableProblem & { questionType: string }>(
  pool: T[],
): T[] | null {
  const reading = pool.find((q) => q.questionType === 'problem');
  const writing = pool.find((q) => q.questionType === 'open');
  return reading && writing ? [reading, writing] : null;
}

/**
 * The selection rule, separated from the query so it can be tested.
 *
 * It is the part with the judgement in it — which chapters a paper samples and
 * how its marks are spread — and it needs no database to decide any of that.
 */
export function chooseQuestions<T extends SelectableProblem>(pool: T[], count: number): T[] {
  const chosen: T[] = [];
  const usedChapters = new Set<string>();
  /** Chapters that have already supplied a major exercise. */
  const chaptersWithLarge = new Set<string>();

  const take = (problem: T) => {
    chosen.push(problem);
    usedChapters.add(problem.chapterId);
    if (weightOf(problem) >= LARGE_QUESTION_MARKS) chaptersWithLarge.add(problem.chapterId);
  };

  // One per chapter — the spread a real paper has.
  for (const problem of pool) {
    if (chosen.length >= count) break;
    if (usedChapters.has(problem.chapterId)) continue;
    take(problem);
  }

  // Top up from the remainder, but never a second large exercise from a chapter
  // that already carries one.
  for (const problem of pool) {
    if (chosen.length >= count) break;
    if (chosen.some((c) => c.id === problem.id)) continue;
    if (weightOf(problem) >= LARGE_QUESTION_MARKS && chaptersWithLarge.has(problem.chapterId)) {
      continue;
    }
    take(problem);
  }

  return chosen;
}

/**
 * What a Lebanese Baccalaureate paper is marked out of.
 *
 * Not a convention this product invented — 396 of the official papers in this
 * corpus total exactly 20, more than any other value by a wide margin. Every
 * figure in the product is expressed on this scale (`markOutOf20`, the
 * predicted mark, readiness, the dashboard), so a paper that totals anything
 * else feeds a number into all of them that does not mean the same thing. A
 * student seeing `14 / 22` is not seeing a Bac mark.
 */
export const PAPER_TOTAL_MARKS = 20;

/**
 * How many exercises a paper of that size is made of.
 *
 * Twenty marks reached as twenty one-mark questions is arithmetically a paper
 * and nothing like one. The real papers run to three to five exercises, so the
 * search refuses a solution outside that band even when its marks are right.
 */
const MIN_PAPER_QUESTIONS = 3;
const MAX_PAPER_QUESTIONS = 6;

/**
 * Bounds the search so an awkward pool cannot hang a request.
 *
 * Reaching exactly 20 from a pool of a hundred questions is normally found in
 * the first few dozen steps; the cap exists for the pool where it cannot be
 * reached at all, which would otherwise be explored exhaustively.
 */
const MAX_SEARCH_STEPS = 50_000;

/**
 * Assembles a paper that totals exactly `target` marks.
 *
 * This is a subset-sum with side conditions, not a top-N selection, and the
 * difference is the whole point. Taking the best five questions and accepting
 * whatever they add up to produced papers marked out of 22 — arithmetically
 * fine, and not a Bac mark, which is the only scale anything in this product
 * can be compared on.
 *
 * The side conditions are the ones a real paper satisfies:
 *
 *   Three to six exercises, so twenty marks are not reached as twenty
 *   one-mark questions.
 *
 *   Never two large exercises from one chapter, the rule `chooseQuestions`
 *   already applies — a candidate should not be able to lose half a paper to a
 *   single topic they happened not to revise.
 *
 * Depth-first over the pool in the order given, so the caller expresses its
 * preferences by ordering — unseen questions first, shuffled — and the first
 * exact solution found inherits them. Returns an empty array when the pool
 * cannot make the target, which the caller must treat as "no paper", never as
 * "a shorter paper": a paper out of 17 is the bug this function exists to
 * remove.
 */
export function assemblePaper<T extends SelectableProblem>(
  pool: T[],
  target: number = PAPER_TOTAL_MARKS,
): T[] {
  const weighted = pool
    .map((problem) => ({ problem, marks: weightOf(problem) }))
    .filter((entry) => entry.marks > 0 && entry.marks <= target);

  let steps = 0;

  function search(
    from: number,
    chosen: { problem: T; marks: number }[],
    total: number,
    chaptersWithLarge: Set<string>,
  ): T[] | null {
    if (total === target) {
      return chosen.length >= MIN_PAPER_QUESTIONS ? chosen.map((c) => c.problem) : null;
    }
    if (total > target || chosen.length >= MAX_PAPER_QUESTIONS) return null;

    for (let i = from; i < weighted.length; i += 1) {
      if ((steps += 1) > MAX_SEARCH_STEPS) return null;

      const entry = weighted[i]!;
      if (total + entry.marks > target) continue;

      const isLarge = entry.marks >= LARGE_QUESTION_MARKS;
      if (isLarge && chaptersWithLarge.has(entry.problem.chapterId)) continue;

      const nextLarge = isLarge
        ? new Set(chaptersWithLarge).add(entry.problem.chapterId)
        : chaptersWithLarge;

      const found = search(i + 1, [...chosen, entry], total + entry.marks, nextLarge);
      if (found) return found;
    }

    return null;
  }

  return search(0, [], 0, new Set()) ?? [];
}

export async function selectGeneratedQuestions(subjectId: string) {
  const pool = await db.generatedProblem.findMany({
    where: { chapter: { subjectId }, ...PUBLISHED_FILTER },
    select: { id: true, chapterId: true, bareme: true, difficulty: true, contentText: true },
    orderBy: { publishedAt: 'desc' },
    take: 60,
  });

  if (pool.length === 0) {
    throw new ExamError(
      'NO_CONTENT',
      'No approved generated problems are available for this subject yet.',
    );
  }

  const chosen = chooseQuestions(pool, AI_PAPER_QUESTION_COUNT);

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
  examCycle: {
    select: {
      id: true,
      title: true,
      year: true,
      session: true,
      /*
       * Carried so the sitting can say whether its clock is the paper's own.
       * `duration_minutes` defaults to 180 and the corpus loader sets nothing,
       * so without this the timer on a four-hour Mathematics paper looked
       * exactly like a timer we had a source for.
       */
      durationIsOfficial: true,
      durationMinutes: true,
    },
  },
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
          /* Whether the solution is an examiner's. See `slotContent`. */
          sourceType: true,
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

/**
 * Whether a sitting is genuinely under way, as opposed to merely unfinished.
 *
 * `status` alone is the wrong test and the difference is not academic: a paper
 * whose deadline has passed keeps `in_progress` until the sweep reaches it.
 * `startSimulation` already knows this — it refuses a second paper only while
 * the first is live, and auto-submits a stale one before starting the next —
 * but the index page was reading status on its own, hiding "new simulation"
 * and offering Resume against a timer at zero. Two places deciding the same
 * thing differently is how a UI ends up withholding an action the server would
 * have allowed.
 */
export function isLiveSitting(
  simulation: { expiresAt: Date; status: string } | null,
  now: Date = new Date(),
): boolean {
  if (!simulation) return false;
  return simulation.status === 'in_progress' && simulation.expiresAt.getTime() > now.getTime();
}

export function remainingSeconds(simulation: { expiresAt: Date; status: string }): number {
  if (simulation.status !== 'in_progress') return 0;
  return Math.max(0, Math.floor((simulation.expiresAt.getTime() - Date.now()) / 1000));
}

/** Question text for a slot, whichever kind of question fills it. */
/**
 * What a slot shows, and whether its solution is an examiner's.
 *
 * `officialSolution` is a column name, not a claim. A slot can hold a real
 * past-exam question, a textbook question, or a model-written problem, and all
 * three arrive through the same field — so the results page was heading every
 * one of them "Official solution", including the generated ones. Practice
 * fixed exactly this and carries `solutionIsOfficial` for it; the exam had its
 * own reader and missed the fix.
 *
 * Official means: a stored question that came off a past paper. Nothing else.
 */
export function slotContent(slot: LoadedSimulation['questions'][number]): {
  contentText: string;
  contentLatex: string | null;
  contentImages: string[];
  chapterName: string | null;
  officialSolution: string | null;
  solutionIsOfficial: boolean;
} {
  if (slot.question) {
    return {
      contentText: slot.question.contentText,
      contentLatex: slot.question.contentLatex,
      contentImages: slot.question.contentImages,
      chapterName: slot.question.chapter?.name ?? null,
      officialSolution: slot.question.officialSolution,
      solutionIsOfficial: slot.question.sourceType === 'past_exam',
    };
  }
  if (slot.generatedProblem) {
    return {
      contentText: slot.generatedProblem.contentText,
      contentLatex: slot.generatedProblem.contentLatex,
      contentImages: [],
      chapterName: slot.generatedProblem.chapter?.name ?? null,
      officialSolution: slot.generatedProblem.generatedSolution,
      // Model-written. Never an examiner's, whatever the column is called.
      solutionIsOfficial: false,
    };
  }
  return {
    contentText: '',
    contentLatex: null,
    contentImages: [],
    chapterName: null,
    officialSolution: null,
    solutionIsOfficial: false,
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
};

/**
 * Submits and marks a paper.
 *
 * Marking is sequential rather than parallel: it runs on the verify model at
 * high effort, and firing twenty of those at once is how you get rate-limited
 * halfway through a student's paper and leave it half-marked.
 */
/**
 * Closes the paper. Fast, and deliberately does no marking.
 *
 * Marking used to run in this call — a serial model call per question, inside
 * the HTTP request. On a five-question paper that is a minute or more of held
 * connection, and in an exam-season window where a few hundred students submit
 * inside the same ten minutes it fails three ways at once: handlers occupied for
 * minutes, gateways cutting the request at their own timeout, and provider rate
 * limits landing partway through the loop.
 *
 * So submission now records that the sitting happened and returns. `markSimulation`
 * does the marking, driven by the cron runner, and the results page already
 * renders "awaiting marking" per criterion — a student lands on their results and
 * watches the marks arrive.
 */
export async function submitSimulation(
  input: SubmitInput,
): Promise<{ status: 'submitted' | 'graded'; questionCount: number }> {
  const simulation = await db.examSimulation.findFirst({
    where: { id: input.simulationId, userId: input.userId },
    select: { id: true, status: true, _count: { select: { questions: true } } },
  });

  if (!simulation) throw new ExamError('NOT_FOUND', 'Simulation not found.');

  if (simulation.status === 'graded' || simulation.status === 'submitted') {
    // Idempotent: a retried submit must not reopen a closed paper.
    return { status: simulation.status, questionCount: simulation._count.questions };
  }

  await db.examSimulation.update({
    where: { id: simulation.id },
    data: { status: 'submitted', submittedAt: new Date() },
  });

  await recordAudit({
    actorUserId: input.userId,
    action: input.auto ? AuditAction.EXAM_SIM_AUTO_SUBMITTED : AuditAction.EXAM_SIM_SUBMITTED,
    targetType: 'exam_simulation',
    targetId: simulation.id,
    metadata: { questionCount: simulation._count.questions },
  });

  return { status: 'submitted', questionCount: simulation._count.questions };
}

/**
 * Marks a submitted paper. Runs off the request path, and is safe to re-run.
 *
 * Re-runnability is the point. A marking pass can die halfway — a timeout, a
 * deploy, a 429 from the provider — and before this was separated that left a
 * paper stuck at `submitted` with half its answers marked and nothing able to
 * see it again. Slots that already carry `gradedAt` are skipped, so a second
 * pass finishes the job rather than double-marking it or starting over.
 */
export async function markSimulation(
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

  const marks: MarkEntry[] = [];
  const touchedChapters = new Set<string>();

  for (const slot of simulation.questions) {
    // Already marked on an earlier pass. Carry its result into the tally so the
    // totals are whole, and do not pay for the model call again.
    if (slot.answer?.gradedAt) {
      marks.push(
        slot.answer.totalScore === null
          ? { status: 'needs_human_review', totalScore: 0, maxScore: 0 }
          : {
              status: 'graded',
              totalScore: Number(slot.answer.totalScore),
              maxScore: Number(slot.answer.maxScore ?? 0),
            },
      );
      continue;
    }

    const bareme = parseBareme(slot.baremeSnapshot);
    const content = slotContent(slot);
    const studentAnswer = answerTextOf(slot.answer);

    /*
     * No official scheme is not the same as no mark.
     *
     * 868 questions reached the corpus without a barème, and until now every
     * one of them told the student their paper needed a human — honest, and
     * useless, and falling almost entirely on the Arabic subjects. So the
     * marker proposes the criteria instead, grounded in retrieved course
     * material and labelled `graded_provisional` all the way to the results
     * screen, where the student is told these are our reading of the question
     * rather than the examiner's.
     *
     * The retrieval is deliberately NOT anchored on this question: anchoring
     * returns the question and its own solution as context, and a criterion
     * "grounded" in the question it was invented for is grounded in nothing.
     */
    const outcome = bareme
      ? await gradeAgainstBareme({
          questionText: content.contentText,
          officialSolution: content.officialSolution,
          bareme,
          studentAnswer,
          language: simulation.subject.language,
          subject: simulation.subject.name,
        })
      : await gradeWithoutBareme({
          questionText: content.contentText,
          officialSolution: content.officialSolution,
          bareme: [],
          studentAnswer,
          language: simulation.subject.language,
          subject: simulation.subject.name,
          statedMarks: statedMarksOf(content.contentText),
          courseMaterial: (
            await retrieveGrounding({
              query: content.contentText,
              subjectIds: [simulation.subject.id],
              userId: input.userId,
            })
          ).context,
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
  /**
   * 'needs_human_review' means the marker could not mark it — never a zero.
   *
   * 'graded_provisional' is a mark against criteria we proposed because the
   * paper's own scheme is not in the corpus. It travels as its own status the
   * whole way rather than collapsing into 'graded', so nothing downstream can
   * present it with the authority of an official barème by accident.
   */
  status: 'graded' | 'graded_provisional' | 'needs_human_review';
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
    select: { id: true, userId: true },
    take: limit,
  });

  let count = 0;
  for (const simulation of expired) {
    try {
      await submitSimulation({
        simulationId: simulation.id,
        userId: simulation.userId,
        auto: true,
      });
      count += 1;
    } catch (err) {
      console.error('[exam] auto-submit failed', simulation.id, err);
    }
  }
  return count;
}

/**
 * Marks papers waiting to be marked, including ones a previous pass abandoned.
 *
 * The abandoned case is the one that matters. Before marking was moved off the
 * request path, a submit that timed out left a paper at `submitted` with some
 * answers marked and some not — and the only sweep in the system looked for
 * `in_progress`, so nothing ever came back for it. The student's results page
 * showed a partial mark permanently.
 */
export async function markSubmitted(limit = 10): Promise<number> {
  /*
   * No staleness delay. An earlier version only picked up papers submitted more
   * than five minutes ago, on the reasoning that a pass still running should not
   * be restarted underneath itself — but that made every student wait five
   * minutes for marking to *begin*, which is a worse outcome than the overlap it
   * was avoiding. A freshly submitted paper is marked on the next tick.
   *
   * Overlap is handled where it should be, per slot: marking skips anything that
   * already carries `gradedAt`, so two passes meeting on the same paper cost
   * duplicate reads rather than duplicate marks. Keep the cron interval longer
   * than a typical run and the two rarely meet at all.
   *
   * Oldest first, so a backlog drains in the order students submitted rather
   * than punishing whoever finished earliest.
   */
  const pending = await db.examSimulation.findMany({
    where: { status: 'submitted' },
    select: { id: true, userId: true },
    orderBy: { submittedAt: 'asc' },
    take: limit,
  });

  let count = 0;
  for (const simulation of pending) {
    try {
      await markSimulation({ simulationId: simulation.id, userId: simulation.userId, auto: true });
      count += 1;
    } catch (err) {
      // Left at `submitted` on purpose: the next sweep retries it, and the
      // per-slot skip means it resumes rather than restarts.
      console.error('[exam] marking failed', simulation.id, err);
    }
  }
  return count;
}
