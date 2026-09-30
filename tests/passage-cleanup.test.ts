import { describe, expect, it } from 'vitest';

import { arabicHeaderLines, cleanPassage, collapseBlankRuns, gutterLines } from '../scripts/corpus/passage-cleanup';

/*
 * These passages are what a student reads before answering. Removing something
 * the author wrote is worse than leaving the paper's furniture in, so every rule
 * here is written to refuse when it is not sure, and the cases it must refuse
 * are pinned alongside the ones it must clean.
 */

const REAL_FRENCH_PASSAGE = [
  'المدّة : ساعتان ',
  '',
  'Une génération sans père',
  '         Jacques Duquesne, journaliste et auteur de nombreux essais, préside',
  "qui dirige l'ensemble du groupe de presse « Ouest-France ».",
  '',
  '',
  '',
  '5',
  '',
  '',
  '',
  '10',
  '',
  '',
  '15',
  "       Quand on a connu tout et le contraire de tout, on est tenté de ne rien lui dire.",
].join('\n');

describe('the line-number gutter the paper prints down the margin', () => {
  it('takes a rising run of bare numbers', () => {
    const marks = gutterLines(REAL_FRENCH_PASSAGE);
    expect(marks.size).toBe(3);
  });

  it('leaves a lone number alone, because it may be the passage', () => {
    // A passage that prints a number on its own line — a date, a count, a verse
    // number — has no gutter, and taking it would delete the author's text.
    expect(gutterLines('Il partit.\n\n1962\n\nIl ne revint jamais.').size).toBe(0);
  });

  it('leaves two numbers alone', () => {
    expect(gutterLines('a\n5\nb\n10\nc').size).toBe(0);
  });

  it('does not join two separate runs across a reset', () => {
    // The gutter only ever counts upward. A drop means a new run began, and
    // neither half reaches three on its own.
    expect(gutterLines('5\n10\n1\n5').size).toBe(0);
  });
});

describe('the ministry cover line at the top of a French passage', () => {
  it('removes the Arabic duration from a Latin passage', () => {
    expect(arabicHeaderLines(REAL_FRENCH_PASSAGE)).toBe(1);
  });

  it('never touches an Arabic passage', () => {
    // THE RULE THAT PROTECTS THE ARABIC SUBJECTS. Stripping leading Arabic from
    // a passage that IS Arabic would delete its opening paragraph.
    const arabic = 'المدّة : ساعتان\n\nقال الكاتب إن الحياة رحلة طويلة.\nوفي ذلك عبرة.';
    expect(arabicHeaderLines(arabic)).toBe(0);
    expect(cleanPassage(arabic)).toBe(arabic.trim());
  });

  it('stops at the first line of the passage itself', () => {
    const text = 'المدّة : ساعتان\nUne génération sans père\nالمدّة : ساعتان';
    expect(arabicHeaderLines(text)).toBe(1);
  });
});

describe('cleaning a passage end to end', () => {
  it('leaves the author’s words exactly as they were', () => {
    const cleaned = cleanPassage(REAL_FRENCH_PASSAGE);
    expect(cleaned).toContain('Une génération sans père');
    expect(cleaned).toContain('Quand on a connu tout et le contraire de tout');
    expect(cleaned).not.toContain('المدّة');
    expect(cleaned).not.toMatch(/^\s*\d+\s*$/m);
  });

  it('collapses the blank space the layout left behind', () => {
    expect(collapseBlankRuns('a\n\n\n\n\nb')).toBe('a\n\nb');
    expect(collapseBlankRuns('a   \nb\t\n')).toBe('a\nb');
  });

  it('keeps the original rather than returning an empty passage', () => {
    // A passage that is nothing but a gutter would clean away to nothing, and a
    // damaged passage is worth more to a student than none at all.
    const onlyGutter = '1\n\n5\n\n10\n\n15';
    expect(cleanPassage(onlyGutter)).toBe(onlyGutter);
  });

  it('does nothing to a passage that was read correctly', () => {
    const good = 'Une génération sans père\n\nJacques Duquesne écrit que les jeunes sont perdus.';
    expect(cleanPassage(good)).toBe(good);
  });
});
