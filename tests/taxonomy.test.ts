import { describe, expect, it } from 'vitest';

import { cleanChapterTitle, looksUnparsed, parseCsv } from '../prisma/taxonomy-loader';

/*
 * The curriculum is the spine everything else hangs off — every question and
 * every chunk is filed under a chapter — so the two functions that decide what
 * counts as a chapter are worth pinning down.
 */

describe('cleanChapterTitle', () => {
  it('unwraps the Greek letters Mathpix leaves in LaTeX', () => {
    expect(cleanChapterTitle('Amines and $\\alpha$-amino acids')).toBe('Amines and α-amino acids');
  });

  it('strips the footnote marker a book uses for optional material', () => {
    expect(cleanChapterTitle('Special Relativity ( ${ }^{*}$ )')).toBe('Special Relativity');
    expect(cleanChapterTitle('Electromagnetic Oscillations (*)')).toBe('Electromagnetic Oscillations');
  });

  it('leaves an ordinary title untouched', () => {
    expect(cleanChapterTitle('Regulation of glycemia')).toBe('Regulation of glycemia');
  });

  it('leaves maths it does not recognise alone rather than mangling it', () => {
    // Better a title with a stray dollar in it than a title silently truncated.
    const odd = 'Curves of $y = f(x)$ form';
    expect(cleanChapterTitle(odd)).toBe(odd);
  });

  it('collapses the double spaces OCR introduces', () => {
    expect(cleanChapterTitle('Rate   of  Reactions')).toBe('Rate of Reactions');
  });
});

/** The loader takes {title, unit}; these helpers keep the tests readable. */
const flat = (titles: string[]) => titles.map((title) => ({ title, unit: null }));

describe('looksUnparsed', () => {
  it('accepts a real contents page', () => {
    expect(
      looksUnparsed(
        flat([
          'Basic mechanisms of sexual reproduction',
          'Transmission of genes and genetic recombination',
          'Genetic variation and polymorphism',
          'Human Genetics',
          'The immune response',
        ]),
      ),
    ).toBe(false);
  });

  it('accepts a book that repeats chapter names across its units', () => {
    // The English "Themes" textbook really is built this way: three thematic
    // units, each containing the same three chapter titles. Judging titles
    // alone declared a correctly-parsed contents page unreadable.
    expect(
      looksUnparsed([
        { title: 'The World Within Us', unit: 'Natural Phenomena' },
        { title: 'The World Around Us', unit: 'Natural Phenomena' },
        { title: 'New Worlds', unit: 'Natural Phenomena' },
        { title: 'The World Within Us', unit: 'Technology' },
        { title: 'The World Around Us', unit: 'Technology' },
        { title: 'New Worlds', unit: 'Technology' },
        { title: 'The World Within Us', unit: 'Current Concerns' },
        { title: 'The World Around Us', unit: 'Current Concerns' },
        { title: 'New Worlds', unit: 'Current Concerns' },
      ]),
    ).toBe(false);
  });

  it('rejects the structural furniture the English book produced', () => {
    expect(
      looksUnparsed(
        flat([
          'The Authors',
          'Part D',
          'Writing Topics',
          'Chapter 2 The World Around Us',
          'Part A',
          'Part C',
          'Language Conventions: Comma Splices and Fused',
          'Writing Topics',
        ]),
      ),
    ).toBe(true);
  });

  it('rejects a list too short to be a Grade 12 textbook', () => {
    expect(looksUnparsed(flat(['The Authors']))).toBe(true);
    expect(looksUnparsed(flat(['ACTIVITY', 'Study the imagery in the poem']))).toBe(true);
  });

  it('rejects an empty list rather than seeding a subject with nothing', () => {
    expect(looksUnparsed([])).toBe(true);
  });

  it('tolerates a single legitimate part heading among real chapters', () => {
    expect(
      looksUnparsed(
        flat(['Part 1', 'The Gaseous State', 'Rate of Reactions', 'Kinetic Factors', 'Chemical Equilibrium']),
      ),
    ).toBe(false);
  });

  it('catches duplicated titles, which a real contents page does not have', () => {
    expect(looksUnparsed(flat(['Writing Topics', 'Writing Topics', 'Writing Topics', 'Something real']))).toBe(true);
  });
});

describe('parseCsv', () => {
  it('reads the catalog shape, including a quoted field with a comma', () => {
    const rows = parseCsv(
      'book_name,folder,subject,tracks,note\n' +
        'svt-ls-en,biology-en__695aa091,Life Sciences,LS,"Cover: Life Sciences Section, New edition."\n',
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.subject).toBe('Life Sciences');
    expect(rows[0]?.note).toBe('Cover: Life Sciences Section, New edition.');
  });

  it('strips the byte-order mark Excel writes onto the first header', () => {
    const rows = parseCsv('﻿book_name,folder\nsvt-ls-en,biology-en__695aa091\n');
    expect(rows[0]?.book_name).toBe('svt-ls-en');
  });

  it('splits multi-track books on the semicolon convention', () => {
    const rows = parseCsv('book_name,folder,tracks\nchimie-gsls-en,chemistry-en__852933a0,GS;LS\n');
    expect(rows[0]?.tracks.split(';')).toEqual(['GS', 'LS']);
  });
});
