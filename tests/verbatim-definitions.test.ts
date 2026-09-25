import { describe, expect, it } from 'vitest';

import { definitionsAreVerbatim, systemPrompt } from '@/lib/chat';

/**
 * The Arabic humanities are marked on the textbook' exact wording.
 *
 * The rule belongs to the SUBJECT, so the tests are about which subject is in
 * scope rather than about how a question is phrased — and the negative half
 * matters as much: told to quote the book verbatim in maths, the tutor would be
 * forbidden from doing the algebra the student actually asked for.
 */

const concept = { kind: 'concept', confidence: 'high', signal: 'test' } as const;
const essay = { kind: 'essay', confidence: 'high', signal: 'test' } as const;

const has = (prompt: string) => prompt.includes('marked on the WORDING');

// `kind` is widened deliberately: with the default alone TypeScript narrows the
// parameter to the literal type of `concept`, and the essay case below — the
// one asserting this is a property of the SUBJECT, not of the question — will
// not type-check.
const forSubject = (name: string | null, kind: typeof concept | typeof essay = concept) =>
  systemPrompt('concept_level', kind, 'ar', 'ar', 'ما هو التضخم؟', name);

describe('the four subjects it applies to', () => {
  it('fires on each of them, by the name the taxonomy actually stores', () => {
    // These four strings are matched exactly against `subjects.name`. If the
    // taxonomy is renamed, this test is the thing that notices.
    for (const name of ['تاريخ', 'جغرافيا', 'تربية وطنية', 'فلسفة عامة']) {
      expect(definitionsAreVerbatim(name)).toBe(true);
      expect(has(forSubject(name))).toBe(true);
    }
  });

  it('fires whatever the question was classified as', () => {
    // A property of the subject, not of the question. A philosophy essay is
    // marked on its terms just as a one-line definition is.
    expect(has(forSubject('فلسفة عامة', essay))).toBe(true);
  });

  it('survives surrounding whitespace on the stored name', () => {
    expect(definitionsAreVerbatim(' تاريخ ')).toBe(true);
  });

  it('asks for the explanation as well as the quotation', () => {
    // Without this the block turns the tutor into a photocopier, which is a
    // different way of being useless to a student.
    expect(forSubject('تاريخ')).toContain('The explanation is yours');
  });
});

describe('the subjects it must stay out of', () => {
  it('stays out of the sciences and of maths', () => {
    for (const name of ['Mathematics', 'Physics', 'Chemistry', 'Life Sciences']) {
      expect(definitionsAreVerbatim(name)).toBe(false);
      expect(has(forSubject(name))).toBe(false);
    }
  });

  it('stays out of أدب عربي, which is examined by comprehension', () => {
    expect(definitionsAreVerbatim('أدب عربي')).toBe(false);
  });

  it('stays out when no single subject is in scope', () => {
    // Across a whole track this would assert one subject' marking convention
    // over every other subject the student is revising.
    expect(definitionsAreVerbatim(null)).toBe(false);
    expect(definitionsAreVerbatim(undefined)).toBe(false);
    expect(has(forSubject(null))).toBe(false);
  });

  it('does not fire on a name that merely contains one', () => {
    expect(definitionsAreVerbatim('تاريخ الفن')).toBe(false);
  });

  it('leaves the prompt alone when the argument is not passed at all', () => {
    // Every existing caller omits it, so omitting it must change nothing.
    expect(has(systemPrompt('concept_level', concept, 'ar', 'ar', 'ما هو التضخم؟'))).toBe(false);
  });
});
