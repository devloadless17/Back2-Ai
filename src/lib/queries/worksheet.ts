import 'server-only';

import { db } from '@/lib/db';

/**
 * A worksheet assembled from real past-exam questions.
 *
 * WHY REAL QUESTIONS AND NOT GENERATED ONES. The generator exists, produces
 * good problems, and is the wrong tool here. A teacher setting homework wants
 * to be able to say "this is the 2019 question" — that is the authority they
 * are borrowing, and it is the only thing in this product a photocopied
 * textbook cannot match. A generated sheet costs a model call per question,
 * needs a solver check before anyone sees it, and a teacher cannot defend it to
 * a parent. This costs nothing and is defensible by construction.
 *
 * DIFFICULTY IS NOT AN OPTION, and deliberately so: 26 of 4,798 questions carry
 * a difficulty rating. Offering the filter would produce a form that returns
 * nothing for almost every choice a teacher makes, which reads as a broken
 * product rather than as missing data. The axes that DO have data are chapter,
 * year, and whether the question has a marking scheme behind it.
 *
 * ORDERED BY YEAR, NEWEST FIRST. A teacher assembling a sheet is usually
 * working towards the next paper, and recent questions are the ones their
 * students will recognise the shape of.
 */

export type WorksheetQuestion = {
  id: string;
  chapterName: string;
  year: number | null;
  contentText: string;
  contentLatex: string | null;
  officialSolution: string | null;
  /** The paper's extract, for a comprehension question. */
  passage: string | null;
  bareme: { criterion: string; points: number }[];
  /** Marks the whole question carries, when the barème says. */
  totalMarks: number | null;
};

export type Worksheet = {
  subjectName: string;
  /** What the paper was printed in, so the sheet sets in the right direction. */
  subjectLanguage: string;
  chapterNames: string[];
  questions: WorksheetQuestion[];
  /** How many were available before the cap, so the form can say "of 47". */
  available: number;
};

/** More than this on one sheet stops being homework. */
export const MAX_QUESTIONS = 20;

export async function buildWorksheet(input: {
  subjectId: string;
  chapterIds: string[];
  count: number;
  /** Only questions with a marking scheme, so the sheet can carry an answer key. */
  withSchemeOnly: boolean;
  trackId: string | null;
}): Promise<Worksheet | null> {
  // The subject is re-checked against the teacher's own track rather than
  // trusted from the query string, the same rule every other id-taking page
  // follows here.
  const subject = await db.subject.findFirst({
    where: { id: input.subjectId, trackId: input.trackId ?? undefined },
    select: { id: true, name: true, language: true },
  });
  if (!subject) return null;

  const chapterIds = input.chapterIds.length > 0 ? input.chapterIds : null;
  const count = Math.min(Math.max(1, input.count), MAX_QUESTIONS);

  const rows = await db.$queryRaw<
    {
      id: string;
      chapter_name: string;
      year: number | null;
      content_text: string;
      content_latex: string | null;
      official_solution: string | null;
      source_passage: string | null;
      bareme: unknown;
      total: bigint;
    }[]
  >`
    WITH pool AS (
      SELECT DISTINCT ON (q.id)
             q.id, c.name AS chapter_name, ec.year,
             q.content_text, q.content_latex, q.official_solution, q.source_passage, q.bareme
        FROM questions q
        -- question_chapters, not chapter_id: what a chapter may SERVE, which is
        -- what the quiz uses and what the chapter counts show. Filing is a
        -- different question and would silently drop most of the pool.
        JOIN question_chapters qc ON qc.question_id = q.id
        JOIN chapters c ON c.id = qc.chapter_id
        LEFT JOIN exam_cycles ec ON ec.id = q.source_exam_id
       WHERE c.subject_id = ${subject.id}::uuid
         AND q.verified_status <> 'rejected'
         AND length(q.content_text) BETWEEN 80 AND 4000
         AND (${chapterIds}::uuid[] IS NULL OR qc.chapter_id = ANY(${chapterIds}::uuid[]))
         AND (${input.withSchemeOnly} = false
              OR (q.bareme IS NOT NULL AND jsonb_array_length(q.bareme) > 0))
    )
    SELECT *, (SELECT count(*) FROM pool) AS total
      FROM pool
     ORDER BY year DESC NULLS LAST, id
     LIMIT ${count}`;

  const chapterNames = [...new Set(rows.map((r) => r.chapter_name))];

  return {
    subjectName: subject.name,
    subjectLanguage: String(subject.language),
    chapterNames,
    available: rows.length > 0 ? Number(rows[0]!.total) : 0,
    questions: rows.map((row) => {
      const bareme = Array.isArray(row.bareme)
        ? (row.bareme as { criterion?: unknown; points?: unknown }[])
            .filter((b) => typeof b?.criterion === 'string' && String(b.criterion).trim().length > 2)
            .map((b) => ({ criterion: String(b.criterion), points: Number(b.points ?? 0) }))
        : [];

      return {
        id: row.id,
        chapterName: row.chapter_name,
        year: row.year,
        contentText: row.content_text,
        contentLatex: row.content_latex,
        officialSolution: row.official_solution,
        passage: row.source_passage,
        bareme,
        // Summed rather than read from a field: these papers print the total on
        // the exercise header and the extractor does not always catch it, but
        // the criteria always carry their own marks.
        totalMarks:
          bareme.length > 0 ? bareme.reduce((sum, b) => sum + (b.points || 0), 0) || null : null,
      };
    }),
  };
}
