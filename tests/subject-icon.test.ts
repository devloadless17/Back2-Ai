import { describe, expect, it } from 'vitest';

import { subjectIcon } from '@/lib/subject-icon';

/**
 * Every subject in this corpus gets the right icon.
 *
 * The names are the real ones — the same subject appears in French, English and
 * Arabic across sixty rows — and the ordering traps are what this pins. A wrong
 * icon is not a crash; it is a student scanning a grid for physics and finding
 * a test tube.
 */
describe('the sciences, where the names overlap', () => {
  it('gives life sciences its own icon, not the generic science one', () => {
    // "Sciences de la vie" contains "Sciences"; order in the table decides this.
    expect(subjectIcon('Sciences de la vie')).toBe('🧬');
    expect(subjectIcon('Life Sciences')).toBe('🧬');
    expect(subjectIcon('علوم الحياة')).toBe('🧬');
  });

  it('separates physics and chemistry in all three languages', () => {
    expect(subjectIcon('Physique')).toBe('⚛️');
    expect(subjectIcon('Physics')).toBe('⚛️');
    expect(subjectIcon('فيزياء')).toBe('⚛️');
    expect(subjectIcon('Chimie')).toBe('🧪');
    expect(subjectIcon('Chemistry')).toBe('🧪');
    expect(subjectIcon('كيمياء')).toBe('🧪');
  });

  it('matches maths however it is spelled', () => {
    expect(subjectIcon('Mathematiques')).toBe('📐');
    expect(subjectIcon('Mathematics')).toBe('📐');
    expect(subjectIcon('الرياضيات')).toBe('📐');
  });
});

describe('the humanities, where Arabic is both a language and a literature', () => {
  it('gives أدب عربي the writing icon rather than the language one', () => {
    // Both patterns contain "عربي"; the literature entry is tested first.
    expect(subjectIcon('أدب عربي')).toBe('✍️');
  });

  it('separates the three Arabic-medium social subjects', () => {
    expect(subjectIcon('تاريخ')).toBe('🏛️');
    expect(subjectIcon('جغرافيا')).toBe('🗺️');
    expect(subjectIcon('تربية وطنية')).toBe('⚖️');
  });

  it('separates economics and sociology, which share a track', () => {
    expect(subjectIcon('اقتصاد')).toBe('📊');
    expect(subjectIcon('اجتماع')).toBe('👥');
  });

  it('knows philosophy in both scripts', () => {
    expect(subjectIcon('فلسفة عامة')).toBe('💭');
    expect(subjectIcon('Philosophie')).toBe('💭');
  });
});

describe('languages', () => {
  it('separates French and English', () => {
    expect(subjectIcon('Francais')).toBe('📖');
    expect(subjectIcon('English')).toBe('📚');
  });
});

describe('an unknown subject', () => {
  it('gets a book rather than nothing', () => {
    // An empty slot in a grid of icons reads as a loading failure.
    expect(subjectIcon('Something Nobody Has Added Yet')).toBe('📘');
    expect(subjectIcon('')).toBe('📘');
  });
});
