import { z } from 'zod';

import { ai } from '@/lib/ai';
import { db } from '@/lib/db';
import { isAiConfigured } from '@/lib/env';
import { LOCALES, type Locale } from '@/lib/i18n/config';

/**
 * An announcement, in the language the student reads.
 *
 * An announcement is free text an admin typed once, and this cohort reads
 * three languages. A French notice reached the English students in French —
 * which is how somebody misses a moved exam date, and what a student sees is
 * not something to leave to whichever language the admin happened to be
 * thinking in.
 *
 * TRANSLATED WHEN POSTED, NOT WHEN READ. A translation on read would put a
 * model call in front of the dashboard for every student, and translate the
 * same notice again for each of them. Posting is one admin action; translating
 * there costs one call per language and is done before anybody opens the page.
 *
 * NOTHING BLOCKS THE POST. If the model is not configured, or the call fails,
 * the announcement still exists in its own language and students see it as
 * they did before this file. A notice in the wrong language is worse than one
 * in the right language and better than no notice at all.
 */

const ARABIC = /[؀-ۿ]/g;
const LETTER = /\p{L}/gu;

/*
 * Function words, not subject vocabulary.
 *
 * The same approach `extract_exams.py` uses on exam papers, for the same
 * reason: an announcement is two sentences, and two sentences carry enough
 * "the"/"les" to separate English from French but not enough topic words to
 * classify by vocabulary. Arabic is decided by script before either list is
 * consulted, because it shares no alphabet with the other two.
 */
const FRENCH = /\b(les|des|dans|pour|avec|est|sont|une|cette|vos|votre|sera|aux|du|de la)\b/gi;
const ENGLISH = /\b(the|and|with|for|are|this|your|will|from|has|have|been|that)\b/gi;

/** Which language a piece of text is written in. */
export function detectLanguage(text: string, fallback: Locale = 'en'): Locale {
  const letters = (text.match(LETTER) ?? []).length;
  if (letters === 0) return fallback;
  if ((text.match(ARABIC) ?? []).length > letters * 0.3) return 'ar';

  const french = (text.match(FRENCH) ?? []).length;
  const english = (text.match(ENGLISH) ?? []).length;
  if (french === 0 && english === 0) return fallback;
  return french > english ? 'fr' : 'en';
}

const LANGUAGE_NAME: Record<Locale, string> = {
  en: 'English',
  fr: 'French',
  ar: 'Arabic',
};

const TRANSLATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'body'],
  properties: {
    title: { type: 'string' },
    body: { type: 'string' },
  },
} as const;

/**
 * Translates one announcement into every language it is not already in.
 *
 * Returns how many translations were written. Idempotent: a language that
 * already has a row is left alone, so re-running after a partial failure
 * fills only the gaps.
 */
export async function translateAnnouncement(announcementId: string): Promise<number> {
  if (!isAiConfigured()) return 0;

  const announcement = await db.announcement.findUnique({
    where: { id: announcementId },
    select: {
      title: true,
      body: true,
      language: true,
      translations: { select: { locale: true } },
    },
  });
  if (!announcement) return 0;

  const have = new Set<string>([announcement.language, ...announcement.translations.map((t) => t.locale)]);
  const wanted = LOCALES.filter((locale) => !have.has(locale));
  if (wanted.length === 0) return 0;

  let written = 0;
  for (const locale of wanted) {
    try {
      const response = await ai().completeJson({
        system: [
          `You translate short notices for Lebanese Baccalaureate students into ${LANGUAGE_NAME[locale]}.`,
          '',
          'Translate the title and the body. Keep the meaning exactly, including every date,',
          'subject name and number. Keep it as short as the original — a notice is read in a',
          'glance. Do not add a greeting, a sign-off or an explanation, and do not translate a',
          'proper name that a student would look for in its original form.',
        ].join('\n'),
        messages: [
          {
            role: 'user',
            content: `TITLE: ${announcement.title}\n\nBODY:\n${announcement.body}`,
          },
        ],
        schema: TRANSLATION_SCHEMA as unknown as Record<string, unknown>,
        schemaName: 'announcement_translation',
        effort: 'low',
        maxTokens: 2000,
        parse: (value) => z.object({ title: z.string(), body: z.string() }).parse(value),
      });

      const title = response.data.title.trim().slice(0, 200);
      const body = response.data.body.trim().slice(0, 5000);
      if (!title || !body) continue;

      await db.announcementTranslation.upsert({
        where: { announcementId_locale: { announcementId, locale } },
        create: { announcementId, locale, title, body },
        update: { title, body },
      });
      written += 1;
    } catch (error) {
      // One language failing must not cost the others. The student sees the
      // original in that language, which is the behaviour without this file.
      console.error(`[announcements] could not translate into ${locale}`, error);
    }
  }

  return written;
}

/** The announcement as this student should read it. */
export function inLocale<T extends { title: string; body: string; language: string; translations: { locale: string; title: string; body: string }[] }>(
  announcement: T,
  locale: Locale,
): { title: string; body: string; translated: boolean } {
  if (announcement.language === locale) {
    return { title: announcement.title, body: announcement.body, translated: false };
  }
  const match = announcement.translations.find((t) => t.locale === locale);
  return match
    ? { title: match.title, body: match.body, translated: true }
    : { title: announcement.title, body: announcement.body, translated: false };
}
