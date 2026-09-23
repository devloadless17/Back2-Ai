import { describe, expect, it } from 'vitest';

import { OWN_EDITION_ONLY } from '../src/lib/queries/taxonomy';

/*
 * A paper is offered in the edition its subject is sat in, and in no other.
 *
 * `subjectLanguagesFor` says which editions a student can READ; this says which
 * editions the programme CONTAINS. Conflating the two is how an English-track
 * candidate came to be offered "Philosophy LH 2018" in English next to the
 * Arabic paper they will actually sit, and how a French chemistry paper came to
 * appear under `Chemistry`, which is the English course.
 *
 * The filter is a Prisma `where`, so the test reads its shape rather than
 * running it. What it is pinning is the decision, not the syntax: every branch
 * must fix the cycle's language to the subject's own, with no branch that lets
 * the two differ. A branch that named only one side would quietly re-admit the
 * translations.
 */
describe('OWN_EDITION_ONLY', () => {
  const branches = OWN_EDITION_ONLY.OR as Array<{
    subject: { language: string };
    language: string;
  }>;

  it('covers every language a subject can be taught in', () => {
    expect(branches.map((b) => b.subject.language).sort()).toEqual(['ar', 'en', 'fr']);
  });

  it('never lets a paper differ in language from its subject', () => {
    for (const branch of branches) {
      expect(branch.language).toBe(branch.subject.language);
    }
  });

  it('constrains both sides in every branch', () => {
    // A branch naming only the subject, or only the cycle, would match every
    // edition of the other — which is exactly the bug this replaced.
    for (const branch of branches) {
      expect(branch.subject?.language).toBeDefined();
      expect(branch.language).toBeDefined();
    }
  });
});
