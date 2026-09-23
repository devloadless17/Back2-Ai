import { describe, expect, it } from 'vitest';

import { detectLanguage, inLocale } from '@/lib/announcements';

/**
 * An announcement is free text an admin typed, and the cohort reads three
 * languages. Getting this wrong is not cosmetic: the notice a student misses
 * is the one about a moved exam date.
 */
describe('detectLanguage', () => {
  it('reads Arabic from the script, not from a word list', () => {
    expect(detectLanguage('تم تغيير موعد امتحان الفيزياء إلى 12 حزيران.')).toBe('ar');
  });

  it('separates French from English on function words', () => {
    expect(
      detectLanguage('Cette instance contient un contenu de démonstration. Le programme sera chargé.'),
    ).toBe('fr');
    expect(
      detectLanguage('The ministry calendar for the June session is out, and your countdown is updated.'),
    ).toBe('en');
  });

  it('keeps Arabic even when a date or a Latin subject name is mixed in', () => {
    expect(detectLanguage('امتحان Physics يوم 12 June 2026 في القاعة الكبرى للطلاب')).toBe('ar');
  });

  it('falls back rather than guessing when there is nothing to read', () => {
    expect(detectLanguage('12/06/2026')).toBe('en');
    expect(detectLanguage('', 'fr')).toBe('fr');
  });
});

describe('inLocale', () => {
  const announcement = {
    title: 'Bienvenue',
    body: 'Le programme officiel sera chargé.',
    language: 'fr',
    translations: [
      { locale: 'en', title: 'Welcome', body: 'The official programme will be loaded.' },
    ],
  };

  it('gives a student the translation in their own language', () => {
    expect(inLocale(announcement, 'en')).toEqual({
      title: 'Welcome',
      body: 'The official programme will be loaded.',
      translated: true,
    });
  });

  it('gives the original to a student who reads the language it was written in', () => {
    expect(inLocale(announcement, 'fr')).toEqual({
      title: 'Bienvenue',
      body: 'Le programme officiel sera chargé.',
      translated: false,
    });
  });

  it('shows the original rather than nothing when a translation is missing', () => {
    // Arabic was never written: a notice in the wrong language still has to be
    // readable. Hiding it would be the one outcome worse than showing it.
    expect(inLocale(announcement, 'ar')).toEqual({
      title: 'Bienvenue',
      body: 'Le programme officiel sera chargé.',
      translated: false,
    });
  });
});
