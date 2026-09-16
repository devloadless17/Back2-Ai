import 'server-only';

import { db } from '@/lib/db';
import { baremeResultSchema, type BaremeResultItem } from '@/lib/grading';

/**
 * The marks a student keeps losing for the same reason.
 *
 * "You scored 11/20 in this chapter" is a fact a student cannot act on. "You
 * have now lost marks three times for not stating the problematic, here are the
 * three questions" is the same data turned into the next hour of revision.
 *
 * BOTH SOURCES, ONE READER. Practice attempts and exam answers are graded by the
 * same marker against the same barème and store the same shape, so a weakness
 * that shows up in practice and again under exam conditions is one weakness, not
 * two. They are read together deliberately.
 *
 * WHAT COUNTS AS LOSING A MARK. Zero awarded where points were possible. A
 * criterion scored 1 of 2 is a partial answer and a different problem — it means
 * the student knows the move and executes it incompletely, which is worth
 * saying but is not this. Counting partials here would bury the criteria they
 * miss ENTIRELY under the ones they nearly get.
 *
 * WHY CRITERIA ARE GROUPED BY THEIR TEXT, NORMALISED. A Lebanese barème repeats
 * its wording across years almost verbatim — "Expliquez ce texte en dégageant la
 * problématique qu'il soulève" appears on 25 papers — which is what makes this
 * feature possible at all. It is also OCR'd, so the same criterion arrives with
 * different whitespace, stray numbering and occasional kashida. Normalising is
 * what makes three occurrences look like three rather than one each.
 *
 * It is NOT semantic grouping. Two criteria that mean the same thing in
 * different words stay separate, and that is the conservative failure: it
 * understates a weakness rather than inventing one. Telling a student they keep
 * failing at something they have failed once would be worse than saying nothing.
 */

export type RecurringLoss = {
  /** The criterion as the examiner wrote it, from the most recent occurrence. */
  criterion: string;
  /** How many times marks were lost entirely on it. */
  times: number;
  /** Marks forgone across those occasions. */
  pointsLost: number;
  subjectName: string;
  /** The questions it happened on, newest first, for "show me". */
  occasions: { questionId: string | null; chapterName: string; when: Date }[];
};

/**
 * Below this a repetition is a coincidence.
 *
 * Two is the smallest number that can be called a pattern, and it is still a
 * weak one — a student who missed the same criterion twice may simply have met
 * the same question twice. Three is where a student recognises it themselves,
 * so three is what the UI leads with; two is reported and ranked beneath.
 */
const MIN_OCCURRENCES = 2;

type Row = {
  bareme_result: unknown;
  question_id: string | null;
  chapter_name: string;
  subject_name: string;
  attempted_at: Date;
};

/** Same criterion, whatever the OCR did to its whitespace and numbering. */
function normalise(criterion: string): string {
  return criterion
    .replace(/[ـ]/g, '') // kashida: decorative, carries no meaning
    .replace(/^[\s\d.\-–—)(]+/, '') // "1 1-", "2)", "– " and friends
    .replace(/\s+/g, ' ')
    .replace(/[.:;،,]+$/, '')
    .trim()
    .toLowerCase();
}

export async function recurringLosses(
  userId: string,
  options: { subjectId?: string; limit?: number } = {},
): Promise<RecurringLoss[]> {
  const limit = options.limit ?? 5;

  /*
   * Practice and exam, unioned in SQL rather than merged in TypeScript, so the
   * ordering and the subject filter are applied once to both.
   */
  const rows = await db.$queryRaw<Row[]>`
    SELECT a.bareme_result, a.question_id::text AS question_id,
           c.name AS chapter_name, s.name AS subject_name, a.attempted_at
      FROM attempts a
      JOIN chapters c ON c.id = COALESCE(a.chapter_id, (SELECT chapter_id FROM questions WHERE id = a.question_id))
      JOIN subjects s ON s.id = c.subject_id
     WHERE a.user_id = ${userId}::uuid
       AND a.bareme_result IS NOT NULL
       AND (${options.subjectId ?? null}::uuid IS NULL OR s.id = ${options.subjectId ?? null}::uuid)

    UNION ALL

    SELECT ea.bareme_result, q.id::text AS question_id,
           c.name AS chapter_name, s.name AS subject_name, ea.submitted_at AS attempted_at
      FROM exam_answers ea
      JOIN exam_simulation_questions esq ON esq.id = ea.exam_simulation_question_id
      JOIN exam_simulations sim ON sim.id = esq.exam_simulation_id
      JOIN questions q ON q.id = esq.question_id
      JOIN chapters c ON c.id = q.chapter_id
      JOIN subjects s ON s.id = c.subject_id
     WHERE sim.user_id = ${userId}::uuid
       AND ea.bareme_result IS NOT NULL
       AND (${options.subjectId ?? null}::uuid IS NULL OR s.id = ${options.subjectId ?? null}::uuid)

     ORDER BY attempted_at DESC`;

  const grouped = new Map<string, RecurringLoss>();

  for (const row of rows) {
    const parsed = baremeResultSchema.safeParse(row.bareme_result);
    if (!parsed.success) continue;

    for (const item of parsed.data as BaremeResultItem[]) {
      const possible = Number(item.points_possible ?? 0);
      const awarded = Number(item.points_awarded ?? 0);
      // Lost entirely. See the note above on why partials are excluded.
      if (!(possible > 0 && awarded === 0)) continue;

      const key = `${row.subject_name}::${normalise(item.criterion)}`;
      if (key.endsWith('::')) continue; // criterion normalised to nothing

      const existing = grouped.get(key);
      if (existing) {
        existing.times += 1;
        existing.pointsLost += possible;
        if (existing.occasions.length < 5) {
          existing.occasions.push({
            questionId: row.question_id,
            chapterName: row.chapter_name,
            when: row.attempted_at,
          });
        }
      } else {
        grouped.set(key, {
          // Rows arrive newest first, so the first occurrence seen is the most
          // recent wording — which is the one the student just read.
          criterion: item.criterion.replace(/\s+/g, ' ').trim(),
          times: 1,
          pointsLost: possible,
          subjectName: row.subject_name,
          occasions: [
            { questionId: row.question_id, chapterName: row.chapter_name, when: row.attempted_at },
          ],
        });
      }
    }
  }

  return [...grouped.values()]
    .filter((loss) => loss.times >= MIN_OCCURRENCES)
    // Marks forgone, not occurrences: losing 9 points twice matters more than
    // losing 1 point three times, and a student revising has finite hours.
    .sort((a, b) => b.pointsLost - a.pointsLost || b.times - a.times)
    .slice(0, limit);
}
