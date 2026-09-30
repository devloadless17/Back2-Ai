import { beforeEach, describe, expect, it, vi } from 'vitest';
import { markSimulation } from '@/lib/exam';

const mocks = vi.hoisted(() => ({
  findSimulation: vi.fn(), findAnswer: vi.fn(), saveAnswer: vi.fn(),
  finish: vi.fn(), lock: vi.fn(), grade: vi.fn(), attempt: vi.fn(),
  review: vi.fn(), locked: false,
}));

vi.mock('@/lib/db', () => {
  const tx = {
    $queryRaw: mocks.lock,
    examAnswer: { findUnique: mocks.findAnswer, upsert: mocks.saveAnswer },
    attempt: { create: mocks.attempt }, reviewQueueItem: { create: mocks.review },
  };
  return { db: {
    examSimulation: { findFirst: mocks.findSimulation, updateMany: mocks.finish },
    user: { findUnique: vi.fn().mockResolvedValue({ trackId: null }) },
    $transaction: async (run: (client: typeof tx) => Promise<void>) => {
      // Model SKIP LOCKED: a competing transaction receives no row.
      const owns = !mocks.locked;
      if (owns) mocks.locked = true;
      try {
        return await run({ ...tx, $queryRaw: vi.fn(async () => owns ? [{ id: 'slot' }] : []) });
      } finally {
        if (owns) mocks.locked = false;
      }
    },
  } };
});
vi.mock('@/lib/grading', async (original) => ({
  ...await original<typeof import('@/lib/grading')>(), gradeAgainstBareme: mocks.grade,
}));
vi.mock('@/lib/audit', () => ({ AuditAction: {}, recordAudit: vi.fn() }));
vi.mock('@/lib/queries/progress', () => ({ recomputeChapterMastery: vi.fn(), resolveCreditChapter: vi.fn() }));

const input = { simulationId: 'paper', userId: 'student', auto: false };
const success = { status: 'graded', totalScore: 4, maxScore: 5, results: [], modelUsed: 'mock' };

function simulation(status = 'submitted') {
  return {
    id: 'paper', status, totalScore: null, maxScore: 5,
    subject: { id: 'subject', name: 'Math', language: 'en' },
    questions: [{
      id: 'slot', questionId: 'q', generatedProblemId: null,
      baremeSnapshot: [{ criterion: 'Correct work', points: 5 }], maxScore: 5,
      question: { contentText: 'Solve', contentLatex: null, contentImages: [],
        chapter: { id: 'chapter', name: 'Algebra' }, officialSolution: null },
      answer: null,
    }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.locked = false;
  mocks.findSimulation.mockResolvedValue(simulation());
  mocks.findAnswer.mockResolvedValue({ typedAnswer: 'working', ocrExtractedText: null,
    ocrConsistencyPassed: null, gradedAt: null });
  mocks.grade.mockResolvedValue(success);
  mocks.saveAnswer.mockImplementation(async ({ update }: { update: object }) => {
    mocks.findAnswer.mockResolvedValue({ typedAnswer: 'working', ocrExtractedText: null,
      ocrConsistencyPassed: null, ...update });
  });
});

describe('marking ownership and recovery', () => {
  it('allows only one overlapping worker to call the marker and create an attempt', async () => {
    let release!: (result: typeof success) => void;
    let entered!: () => void;
    const started = new Promise<void>((r) => { entered = r; });
    mocks.grade.mockImplementationOnce(() => { entered(); return new Promise((r) => { release = r; }); });
    const first = markSimulation(input);
    await started;
    await expect(markSimulation(input)).rejects.toThrow('already being marked');
    release(success);
    await first;
    expect(mocks.grade).toHaveBeenCalledTimes(1);
    expect(mocks.attempt).toHaveBeenCalledTimes(1);
  });

  it('retries a failed AI response, then reuses the stored grade on later passes', async () => {
    mocks.grade.mockResolvedValueOnce({ status: 'needs_human_review', totalScore: 0,
      maxScore: 0, results: [], retryable: true, reason: 'Provider unavailable' });
    await markSimulation(input);
    expect(mocks.saveAnswer.mock.calls[0]?.[0].update.gradedAt).toBeNull();
    expect(mocks.finish).not.toHaveBeenCalled();
    expect(mocks.attempt).not.toHaveBeenCalled();
    expect(mocks.review).not.toHaveBeenCalled();
    await markSimulation(input);
    expect(mocks.finish).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'graded', totalScore: 4, maxScore: 5 }),
    }));
    await markSimulation(input);
    expect(mocks.grade).toHaveBeenCalledTimes(2);
    expect(mocks.attempt).toHaveBeenCalledTimes(1);
  });

  it('never marks an active sitting', async () => {
    mocks.findSimulation.mockResolvedValueOnce({ status: 'in_progress' });
    await expect(markSimulation(input)).rejects.toThrow('Only a submitted paper');
    expect(mocks.grade).not.toHaveBeenCalled();
  });

  it('repairs an unfinished slot even when the paper was already finalized', async () => {
    mocks.findSimulation.mockResolvedValue(simulation('graded'));
    await markSimulation(input);
    expect(mocks.grade).toHaveBeenCalledTimes(1);
    expect(mocks.finish).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'paper', status: { in: ['submitted', 'graded'] } },
      data: expect.objectContaining({ status: 'graded', totalScore: 4, maxScore: 5 }),
    }));
  });

  it('repairs an old optional-question denominator without another AI call', async () => {
    const base = simulation('graded');
    const complete = {
      ...base,
      sourceMode: 'real_cycle',
      totalScore: 20,
      maxScore: 30,
      questions: [{
        ...base.questions[0]!,
        answer: {
          typedAnswer: 'working', ocrExtractedText: null, ocrConsistencyPassed: null,
          gradedAt: new Date(), totalScore: 20, maxScore: 20,
        },
      }],
    };
    mocks.findSimulation.mockResolvedValue(complete);

    await expect(markSimulation(input)).resolves.toEqual({ totalScore: 20, maxScore: 20, unmarked: 0 });
    expect(mocks.grade).not.toHaveBeenCalled();
    expect(mocks.finish).toHaveBeenCalledWith({
      where: { id: 'paper', status: 'graded' },
      data: { totalScore: 20, maxScore: 20 },
    });
  });
});
