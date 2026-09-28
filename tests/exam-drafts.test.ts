import { describe, expect, it, vi } from 'vitest';
import { ExamDrafts } from '@/lib/client/exam-drafts';

describe('exam draft persistence', () => {
  it('saves the previous question as well as the current one', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const drafts = new ExamDrafts(write);
    drafts.set('first', 'last seconds of typing');
    drafts.set('second', 'next answer');
    await drafts.flush();
    expect(write.mock.calls).toEqual([
      ['first', 'last seconds of typing'], ['second', 'next answer'],
    ]);
    expect(drafts.pending()).toEqual([]);
  });

  it('waits for an in-flight save and then saves newer typing before submission', async () => {
    let release!: () => void;
    const write = vi.fn().mockImplementationOnce(() => new Promise<void>((r) => { release = r; }))
      .mockResolvedValue(undefined);
    const drafts = new ExamDrafts(write);
    drafts.set('q', 'old');
    const saving = drafts.flush();
    drafts.set('q', 'new');
    const submitting = drafts.flush();
    expect(write).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([saving, submitting]);
    expect(write.mock.calls).toEqual([['q', 'old'], ['q', 'new']]);
    expect(drafts.pending()).toEqual([]);
  });

  it('retries the latest draft, never a failed stale value', async () => {
    const write = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const drafts = new ExamDrafts(write);
    drafts.set('q', 'old');
    await expect(drafts.flush()).rejects.toThrow('offline');
    drafts.set('q', 'new');
    await drafts.flush();
    expect(write.mock.calls).toEqual([['q', 'old'], ['q', 'new']]);
  });

  it('persists clearing an answer and does not resend confirmed drafts', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const drafts = new ExamDrafts(write);
    drafts.set('q', 'answer');
    await drafts.flush();
    drafts.set('q', '');
    await drafts.flush();
    await drafts.flush();
    expect(write.mock.calls).toEqual([['q', 'answer'], ['q', '']]);
  });
});
