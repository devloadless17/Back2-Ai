/** Regression tests replacing the original diagnostic probes. No paid AI calls. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { aiExamBlueprintSchema } from '@/lib/ai-exam-blueprint';
import { contentDigest, hasCurrentQuality, checkExerciseStructure, QUALITY_VERSION, reviewGeneratedExercise } from '@/lib/generated-exam-quality';
import { paperIsComplete, styleReferenceScope } from '@/lib/ai-exam-production';
import { startSimulation } from '@/lib/exam';

const m = vi.hoisted(() => ({ papers: vi.fn(), create: vi.fn(), complete: vi.fn() }));
vi.mock('@/lib/ai', () => ({ ai: () => ({ completeJson: m.complete, verifyModel: 'mock' }), embed: vi.fn() }));
vi.mock('@/lib/audit', () => ({ AuditAction: {}, recordAudit: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: {
  generatedExamPaper: { findMany: m.papers },
  examSimulation: { findFirst: vi.fn().mockResolvedValue(null), create: m.create },
  examSimulationQuestion: { findMany: vi.fn().mockResolvedValue([]) },
} }));
const uuid = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const blueprint = { title: 'Reviewed mathematics practice', subjectId: uuid(1), basis: 'practice',
  sourceExamId: null, durationMinutes: 120, totalMarks: 20,
  exercises: [6, 6, 8].map((marks, i) => ({ chapterId: uuid(i + 2), referenceIds: [uuid(i + 10)], marks,
    difficulty: 0.5, objective: 'Solve a multi-part exam exercise.', requiredFigure: 'none' })),
};
function completePaper() {
  return { id: 'paper', subjectId: blueprint.subjectId, title: blueprint.title, blueprint, durationMinutes: 120, totalMarks: 20,
    status: 'approved', publishedAt: new Date(), problems: blueprint.exercises.map((e, i) => {
      const content = { contentText: '1. Solve. 2. Explain.', contentLatex: null, generatedSolution: 'Worked solution',
        finalAnswer: '4', figures: [], bareme: [{ criterion: 'Method', points: e.marks }] };
      return { ...content, id: uuid(i + 20), chapterId: e.chapterId, paperOrder: i,
        verificationStatus: 'approved', publishedAt: new Date(),
        qualityReport: { version: QUALITY_VERSION, passed: true, digest: contentDigest(content) } };
    }) };
}
beforeEach(() => { vi.clearAllMocks(); m.create.mockResolvedValue({ id: 'sitting' }); });

describe('complete AI paper gates', () => {
  it('keeps style references inside the selected track and language subject', () => {
    expect(styleReferenceScope(uuid(1))).toEqual({
      OR: [
        { chapter: { subjectId: uuid(1) } },
        { alsoInChapters: { some: { chapter: { subjectId: uuid(1) } } } },
      ],
    });
  });
  it('rejects one-question and 60-mark plans', () => {
    expect(aiExamBlueprintSchema.safeParse({ ...blueprint, exercises: [blueprint.exercises[0]] }).success).toBe(false);
    expect(aiExamBlueprintSchema.safeParse({ ...blueprint, exercises: Array(6).fill({ ...blueprint.exercises[0], marks: 10 }) }).success).toBe(false);
  });
  it('does not start a legacy or incomplete paper', async () => {
    const paper = completePaper(); paper.problems.pop(); m.papers.mockResolvedValue([paper]);
    await expect(startSimulation({ userId: 'student', subjectId: uuid(1), sourceMode: 'ai_generated' })).rejects.toThrow('No complete reviewed AI paper');
    expect(m.create).not.toHaveBeenCalled();
  });
  it('uses the complete approved paper and its planned duration', async () => {
    m.papers.mockResolvedValue([completePaper()]);
    await startSimulation({ userId: 'student', subjectId: uuid(1), sourceMode: 'ai_generated', generatedPaperId: 'paper' });
    expect(m.create.mock.calls[0]![0].data).toMatchObject({ durationMinutes: 120, maxScore: 20 });
    expect(m.create.mock.calls[0]![0].data.questions.create).toHaveLength(3);
    expect(m.papers.mock.calls[0]![0].where).toMatchObject({ id: 'paper', subjectId: uuid(1), status: 'approved' });
  });
  it('rejects content changed after review, including changed figures', () => {
    const paper = completePaper(); expect(paperIsComplete(paper)).toBe(true);
    paper.problems[0]!.contentText += ' Changed'; expect(paperIsComplete(paper)).toBe(false);
  });
  it('does not depend on JSONB object key order', () => {
    const q = completePaper().problems[0]!;
    q.bareme = [{ points: q.bareme[0]!.points, criterion: 'Method' }];
    expect(hasCurrentQuality(q)).toBe(true);
  });
});

describe('exercise validation', () => {
  const part = { id: '1', answer: '4', marks: 4, figureIds: ['F1'] };
  it('rejects a reference to a missing graph before calling a model', () => {
    expect(checkExerciseStructure({ text: '1. Read F1.', figures: [], parts: [part],
      bareme: [{ partId: '1', criterion: 'Correct reading', points: 4 }], targetMarks: 4, requiredFigure: 'plot' }))
      .toEqual(expect.arrayContaining(['Part 1 refers to an absent figure.', 'Missing F1.', 'This exercise requires a plot.']));
  });
  it('rejects a rubric missing an entire subquestion', () => {
    expect(checkExerciseStructure({ text: '1. Solve.\n2. Explain.', figures: [], parts: [{ ...part, figureIds: [] }, { ...part, id: '2', figureIds: [] }],
      bareme: [{ partId: '1', criterion: 'Correct reading', points: 4 }], targetMarks: 8, requiredFigure: 'none' }))
      .toContain('Part 2 marks do not match its criteria.');
  });
  it('fails closed if the independent solver skips a part', async () => {
    m.complete.mockResolvedValue({ data: { solvable: true, issues: [], answers: [] }, modelUsed: 'mock' });
    const content = completePaper().problems[0]!;
    const report = await reviewGeneratedExercise({ content, parts: [part], referenceText: 'Exam reference', targetMarks: 4 });
    expect(report.passed).toBe(false); expect(m.complete).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(m.complete.mock.calls[0]![0].messages)).not.toContain('Worked solution');
  });
});
