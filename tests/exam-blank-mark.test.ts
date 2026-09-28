import { describe, expect, it, vi } from 'vitest';
import { gradeAgainstBareme, gradeWithoutBareme } from '@/lib/grading';
import { tallyMarks } from '@/lib/exam';

vi.mock('@/lib/ai', () => ({ ai: { complete: vi.fn(() => { throw new Error('No paid calls allowed'); }) } }));

const input = {
  questionText: 'Explain.', officialSolution: null, bareme: [],
  studentAnswer: '  ', language: 'en' as const, courseMaterial: '',
};

describe('blank answers retain available marks', () => {
  it('counts a blank scheme-less question as zero out of its stated marks', async () => {
    const blank = await gradeWithoutBareme({ ...input, statedMarks: 5 });
    expect(blank).toMatchObject({ status: 'graded', totalScore: 0, maxScore: 5 });
    expect(tallyMarks([{ status: 'graded', totalScore: 15, maxScore: 15 }, blank]))
      .toEqual({ totalScore: 15, maxScore: 20, unmarked: 0 });
  });

  it('requires review when the available marks are unknown, never finalizes 0/0', async () => {
    expect(await gradeWithoutBareme(input)).toMatchObject({ status: 'needs_human_review' });
  });

  it('still awards zero against all official criteria without AI', async () => {
    expect(await gradeAgainstBareme({ ...input, bareme: [{ criterion: 'Correct explanation', points: 5 }] }))
      .toMatchObject({ status: 'graded', totalScore: 0, maxScore: 5 });
  });
});
