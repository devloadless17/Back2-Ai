import { describe, expect, it, vi } from 'vitest';

/*
 * Which chapter a mark is posted to.
 *
 * GS and LS sit the same chemistry from the same book, so a GS student
 * practising Alcohols is offered LS exercises on alcohols. Crediting the chapter
 * the exercise is FILED under would post that student's marks to the other
 * track's copy of their chapter, where their progress page never looks — they
 * would answer twenty questions and watch nothing move. That failure is silent,
 * which is why it is pinned here.
 */
const findMany = vi.fn();
vi.mock('@/lib/db', () => ({ db: { questionChapter: { findMany: (...a: unknown[]) => findMany(...a) } } }));

const { resolveCreditChapter } = await import('../src/lib/queries/progress');

const GS_ALCOHOLS = 'aaaaaaaa-0000-0000-0000-000000000001';
const GS_ALDEHYDES = 'aaaaaaaa-0000-0000-0000-000000000002';
const LS_ALCOHOLS = 'bbbbbbbb-0000-0000-0000-000000000001';

const call = (claimed?: string, offered: string[] = [GS_ALCOHOLS, GS_ALDEHYDES]) => {
  findMany.mockResolvedValueOnce(offered.map((chapterId) => ({ chapterId })));
  return resolveCreditChapter({
    userTrackId: 'gs',
    questionId: 'q',
    // Filed in the LS copy of the chapter — the shared case.
    questionChapterId: LS_ALCOHOLS,
    claimed,
    isGenerated: false,
  });
};

describe('crediting a shared exercise', () => {
  it('posts to the chapter the student says they are practising', async () => {
    await expect(call(GS_ALDEHYDES)).resolves.toBe(GS_ALDEHYDES);
  });

  it('ignores a claimed chapter that does not offer the question', async () => {
    // The claim is checked against what the student's track actually offers, so
    // a forged body cannot move a mark somewhere it does not belong.
    await expect(call(LS_ALCOHOLS)).resolves.toBe(GS_ALCOHOLS);
  });

  it('falls back to the track’s own chapter when nothing is claimed', async () => {
    await expect(call(undefined)).resolves.toBe(GS_ALCOHOLS);
  });

  it('refuses when no chapter of the student’s track offers it', async () => {
    await expect(call(undefined, [])).resolves.toBeNull();
  });

  it('keeps the question’s own chapter when that is already the student’s', async () => {
    findMany.mockResolvedValueOnce([{ chapterId: GS_ALDEHYDES }, { chapterId: GS_ALCOHOLS }]);
    await expect(
      resolveCreditChapter({
        userTrackId: 'gs',
        questionId: 'q',
        questionChapterId: GS_ALDEHYDES,
        isGenerated: false,
      }),
    ).resolves.toBe(GS_ALDEHYDES);
  });

  it('never queries for a generated problem, which is filed once and not shared', async () => {
    findMany.mockClear();
    await expect(
      resolveCreditChapter({
        userTrackId: 'gs',
        questionId: 'g',
        questionChapterId: GS_ALCOHOLS,
        isGenerated: true,
      }),
    ).resolves.toBe(GS_ALCOHOLS);
    expect(findMany).not.toHaveBeenCalled();
  });
});
