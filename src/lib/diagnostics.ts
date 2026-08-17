import 'server-only';

import type { Language } from '@prisma/client';
import { z } from 'zod';

import { ai } from '@/lib/ai';
import { db } from '@/lib/db';
import { isAiConfigured } from '@/lib/env';

/**
 * Reading a student's own marks back into the syllabus.
 *
 * A student uploads a report card or a corrected paper. This turns it into
 * "which chapters is this evidence about, and does it show strength or
 * weakness" — the one call that seeds the weakness picture before the student
 * has answered a single question in the app.
 *
 * Three things it deliberately does not do.
 *
 * It does not score. It emits evidence, and `chapter_mastery` decides what that
 * evidence is worth: mastery here is recency- and difficulty-weighted with a
 * 14-day half-life, and a diagnostic that wrote scores directly would bypass
 * the model the rest of the product is built on.
 *
 * It does not invent chapters. The model is handed the student's own chapter
 * list and must copy a name from it; anything unmatched is dropped rather than
 * guessed at, the same rule `autoTag` follows when filing questions. A weakness
 * filed under a chapter the student does not study is worse than a gap.
 *
 * It does not resolve ambiguity. A grade line reading "Sciences 12/20" is
 * evidence about a subject, not a chapter, and an illegible one is evidence
 * about nothing. Both come back `unclear` and stay out of the mastery model.
 * The alternative — spreading a subject grade evenly across its chapters —
 * invents a per-chapter signal the document never contained.
 */

const EXTRACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items', 'summary'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['chapter_ref', 'evidence', 'performance'],
        properties: {
          chapter_ref: { type: 'number' },
          evidence: { type: 'string' },
          performance: { type: 'string', enum: ['weak', 'ok', 'strong', 'unclear'] },
        },
      },
    },
    summary: { type: 'string' },
  },
} as const;

const extractionSchema = z.object({
  items: z.array(
    z.object({
      chapter_ref: z.number(),
      evidence: z.string(),
      performance: z.enum(['weak', 'ok', 'strong', 'unclear']),
    }),
  ),
  summary: z.string(),
});

export type DiagnosticItem = {
  chapterId: string;
  chapterName: string;
  subjectName: string;
  /** The line of the document this was read from, quoted back for the student. */
  evidence: string;
  performance: 'weak' | 'ok' | 'strong';
};

export type DiagnosticResult = {
  items: DiagnosticItem[];
  /** Read as being about a chapter, but the reference did not resolve to one. */
  unmatched: { chapterRef: number; evidence: string }[];
  /** Read but too ambiguous to file — a subject-level grade, or illegible. */
  unclear: { evidence: string }[];
  summary: string;
  status: 'ok' | 'not_configured' | 'no_curriculum' | 'unreadable';
};

function normalize(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9؀-ۿ]+/g, ' ')
    .trim();
}

const LANGUAGE_NAME = { fr: 'French', en: 'English', ar: 'Arabic' } as const;

/**
 * The chapters this student could possibly be graded on.
 *
 * Scoped to their own track and subjects rather than the whole corpus — a
 * thousand chapters across four tracks is both a waste of context and an
 * invitation to file a weakness under another track's syllabus, since chapter
 * names repeat across tracks that share a textbook.
 */
async function curriculumFor(userId: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { trackId: true, preferredLanguage: true },
  });
  if (!user?.trackId) return { language: 'en' as Language, chapters: [] };

  const chapters = await db.chapter.findMany({
    where: { subject: { trackId: user.trackId } },
    select: {
      id: true,
      name: true,
      unit: { select: { name: true } },
      subject: { select: { name: true, language: true } },
    },
    orderBy: [{ subject: { name: 'asc' } }, { orderIndex: 'asc' }],
  });

  return { language: user.preferredLanguage, chapters };
}

export async function extractWeaknesses(input: {
  userId: string;
  /** Text of the report card or corrected paper, already OCR'd. */
  documentText: string;
}): Promise<DiagnosticResult> {
  const empty = { items: [], unmatched: [], unclear: [], summary: '' };

  if (!isAiConfigured()) return { ...empty, status: 'not_configured' };
  if (input.documentText.trim().length < 30) return { ...empty, status: 'unreadable' };

  const { language, chapters } = await curriculumFor(input.userId);
  if (chapters.length === 0) return { ...empty, status: 'no_curriculum' };

  /*
   * Chapters are referenced by number, not by name.
   *
   * The first version listed them as "Name — Subject (Unit)" and asked the
   * model to copy the name exactly. It copied the whole line, suffix included,
   * and every single item failed to match. Asking for a number removes the
   * ambiguity rather than trying to parse back out of it.
   */
  const numbered = chapters.map((chapter, index) => ({ ref: index + 1, chapter }));
  const byRef = new Map(numbered.map((n) => [n.ref, n.chapter]));

  const response = await ai().completeJson({
    system: [
      'You read a Lebanese Baccalaureate student\'s report card or corrected examination paper and',
      'say which parts of their own syllabus it is evidence about.',
      '',
      'Rules:',
      '- chapter_ref: the number of the chapter from the list you are given. Only numbers from that',
      '  list. Never invent one.',
      '- Emit one item per line of the document that carries a mark or a correction, including the',
      '  whole-subject grades. Do not silently skip a line because it is hard to place.',
      '- performance: "weak" if the mark or correction shows they struggled, "strong" if it shows',
      '  they did well, "ok" for a middling result.',
      '- Use "unclear" — do not guess — when a line is a whole-subject grade with no indication of',
      '  which chapter, when the text is illegible, or when you cannot tell which chapter is meant.',
      '  A subject grade is not evidence about any particular chapter.',
      '- evidence: quote the line of the document you read it from, so the student can check you.',
      `- summary: two or three sentences addressed to the student, in ${LANGUAGE_NAME[language]}.`,
      '  Say what the document shows. Do not offer encouragement you have no basis for.',
    ].join('\n'),
    messages: [
      {
        role: 'user',
        content: [
          '# Chapters this student studies (use the number)',
          ...numbered.map(
            ({ ref, chapter }) =>
              `${ref}. ${chapter.name}  [${chapter.subject.name}${chapter.unit?.name ? ` / ${chapter.unit.name}` : ''}]`,
          ),
          '',
          '# Document',
          input.documentText.slice(0, 24_000),
        ].join('\n'),
      },
    ],
    schema: EXTRACTION_SCHEMA as unknown as Record<string, unknown>,
    schemaName: 'weakness_extraction',
    effort: 'high',
    parse: (value) => extractionSchema.parse(value),
  });

  const items: DiagnosticItem[] = [];
  const unmatched: DiagnosticResult['unmatched'] = [];
  const unclear: DiagnosticResult['unclear'] = [];

  for (const item of response.data.items) {
    if (item.performance === 'unclear') {
      unclear.push({ evidence: item.evidence });
      continue;
    }
    const chapter = byRef.get(item.chapter_ref);
    if (!chapter) {
      // Reported rather than dropped silently: a reference that resolves to
      // nothing is worth seeing, not hiding.
      unmatched.push({ chapterRef: item.chapter_ref, evidence: item.evidence });
      continue;
    }
    items.push({
      chapterId: chapter.id,
      chapterName: chapter.name,
      subjectName: chapter.subject.name,
      evidence: item.evidence,
      performance: item.performance,
    });
  }

  return { items, unmatched, unclear, summary: response.data.summary, status: 'ok' };
}
