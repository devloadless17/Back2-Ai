import { describe, expect, it } from 'vitest';

import { LOCALES, STUDY_LANGUAGES, isStudyLanguage } from '../src/lib/i18n/config';
import { subjectLanguagesFor } from '../src/lib/queries/taxonomy';

/*
 * Two different languages, and only one of them is a choice.
 *
 * The interface speaks three; the exam is sat in two. A Lebanese candidate takes
 * their sciences in French or English and their humanities in Arabic either way.
 * There is no all-Arabic programme — and the signup choice is locked for good,
 * so offering one handed a student the Arabic humanities and no sciences with no
 * way back. These tests pin the distinction rather than the list.
 */
describe('the study language', () => {
  it('is offered in fewer languages than the interface', () => {
    expect(STUDY_LANGUAGES.length).toBeLessThan(LOCALES.length);
  });

  it('does not offer Arabic', () => {
    expect(isStudyLanguage('ar')).toBe(false);
    expect(STUDY_LANGUAGES).not.toContain('ar');
  });

  it('still offers Arabic as an interface language', () => {
    expect(LOCALES).toContain('ar');
  });

  it('gives a student their own language and the Arabic subjects', () => {
    // This is why Arabic is not a study language: en and fr each carry ar with
    // them, so nothing is lost by removing the third option.
    expect(subjectLanguagesFor('en')).toEqual(expect.arrayContaining(['en', 'ar']));
    expect(subjectLanguagesFor('fr')).toEqual(expect.arrayContaining(['fr', 'ar']));
  });

  it('would have given an Arabic student no sciences, which is the whole reason', () => {
    // Kept as a live check rather than a comment: if this ever returns more than
    // Arabic, the reason for the restriction has changed and someone should say
    // so deliberately.
    expect(subjectLanguagesFor('ar')).toEqual(['ar']);
    for (const language of STUDY_LANGUAGES) {
      expect(subjectLanguagesFor(language).length).toBeGreaterThan(1);
    }
  });
});
