import { describe, expect, it } from 'vitest';

import { lossScope } from '@/lib/queries/recurring-losses';

/**
 * Where a recurring loss is allowed to send a student.
 *
 * An insight with a button feels more useful than one without, which is
 * precisely why this needs pinning down. "You keep losing marks on
 * justification" across six chapters has no chapter to open, and picking one
 * would be manufacturing a recommendation to fill a space in a layout. The
 * rule is that the destination has to be true of every occurrence.
 */

const ids = (...v: string[]) => new Set(v);

describe('every occurrence in one chapter', () => {
  it('offers that chapter', () => {
    const scope = lossScope({
      chapterIds: ids('ch-integrals'),
      subjectIds: ids('sub-maths'),
      chapterName: 'Integrals',
      subjectName: 'Mathematics',
    });
    expect(scope).toEqual({
      kind: 'chapter',
      chapterId: 'ch-integrals',
      subjectId: 'sub-maths',
      chapterName: 'Integrals',
    });
  });
});

describe('occurrences spanning chapters inside one subject', () => {
  it('falls back to the subject and names no chapter', () => {
    const scope = lossScope({
      chapterIds: ids('ch-a', 'ch-b', 'ch-c'),
      subjectIds: ids('sub-maths'),
      chapterName: 'Integrals',
      subjectName: 'Mathematics',
    });
    expect(scope).toEqual({ kind: 'subject', subjectId: 'sub-maths', subjectName: 'Mathematics' });
  });

  it('does not leak the most recent chapter into the result', () => {
    // The chapter name is passed in regardless, because the caller does not
    // know which branch will be taken. It must not survive into a subject
    // scope, or the UI could render "practise Integrals" for a criterion lost
    // across three chapters.
    const scope = lossScope({
      chapterIds: ids('ch-a', 'ch-b'),
      subjectIds: ids('sub-maths'),
      chapterName: 'Integrals',
      subjectName: 'Mathematics',
    });
    expect(JSON.stringify(scope)).not.toContain('Integrals');
  });
});

describe('occurrences spanning subjects', () => {
  it('offers nothing at all', () => {
    const scope = lossScope({
      chapterIds: ids('ch-a', 'ch-b'),
      subjectIds: ids('sub-maths', 'sub-physics'),
      chapterName: 'Integrals',
      subjectName: 'Mathematics',
    });
    expect(scope).toEqual({ kind: 'none' });
  });

  it('offers nothing even when they happen to share a chapter id', () => {
    // Defensive: a shared chapter across two subjects would be a data fault,
    // and the answer to a data fault is not a confident link.
    const scope = lossScope({
      chapterIds: ids('ch-a'),
      subjectIds: ids('sub-maths', 'sub-physics'),
      chapterName: 'Integrals',
      subjectName: 'Mathematics',
    });
    expect(scope.kind).toBe('none');
  });
});

describe('degenerate input', () => {
  it('offers nothing when no subject was recorded', () => {
    expect(
      lossScope({ chapterIds: ids(), subjectIds: ids(), chapterName: '', subjectName: '' }).kind,
    ).toBe('none');
  });

  it('offers the subject when a subject is known but no chapter is', () => {
    const scope = lossScope({
      chapterIds: ids(),
      subjectIds: ids('sub-maths'),
      chapterName: '',
      subjectName: 'Mathematics',
    });
    expect(scope).toEqual({ kind: 'subject', subjectId: 'sub-maths', subjectName: 'Mathematics' });
  });
});
