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
  /** The questions it happened on, newest first, for "show me". CAPPED AT 5. */
  occasions: { questionId: string | null; chapterName: string; when: Date }[];
  /**
   * Where, truthfully, this can send a student.
   *
   * Decided over EVERY occurrence, not over `occasions` — that list stops at
   * five, and a criterion lost eight times whose first five happen to share a
   * chapter would otherwise offer a chapter link that the other three
   * contradict. The sets are counted during aggregation and discarded.
   */
  scope: LossScope;
};

/**
 * A recurring loss is only allowed to offer a destination it can justify.
 *
 * The temptation is to link every insight to a practice page, because an
 * insight with a button feels more useful than one without. But "you keep
 * losing marks on justification" spanning six chapters has no chapter to send
 * anyone to, and picking one — the most recent, the worst, the first — would
 * be inventing a recommendation out of a presentation problem. An insight the
 * student can act on themselves is better than a link that is wrong.
 */
export type LossScope =
  | { kind: 'chapter'; chapterId: string; subjectId: string; chapterName: string }
  | { kind: 'subject'; subjectId: string; subjectName: string }
  | { kind: 'none' };

/**
 * NOTE: the cross-subject branch is currently unreachable from
 * `recurringLosses`, because the grouping key includes the subject, so one
 * criterion can never span two of them. It is implemented and tested anyway —
 * the rule belongs to the idea, not to today's grouping key, and a future
 * change to that key must not silently start inventing destinations.
 */
export function lossScope(input: {
  chapterIds: Set<string>;
  subjectIds: Set<string>;
  chapterName: string;
  subjectName: string;
}): LossScope {
  const { chapterIds, subjectIds, chapterName, subjectName } = input;

  if (subjectIds.size !== 1) return { kind: 'none' };
  const subjectId = [...subjectIds][0]!;

  if (chapterIds.size === 1) {
    return { kind: 'chapter', chapterId: [...chapterIds][0]!, subjectId, chapterName };
  }
  return { kind: 'subject', subjectId, subjectName };
}

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
  chapter_id: string;
  chapter_name: string;
  subject_id: string;
  subject_name: string;
  attempted_at: Date;
};

/**
 * Same criterion, whatever the OCR did to its whitespace and numbering.
 *
 * KNOWN LIMITATION, understood and deliberately not solved here.
 *
 * Criterion identity is the raw examiner string, normalised for whitespace,
 * leading numbering, kashida, case and trailing punctuation, and keyed with
 * the subject. Anything beyond that splits. "Justifier la reponse" and
 * "Justifie la reponse" are one criterion to a reader and two to this
 * function; so are a criterion the examiner abbreviated on one paper and wrote
 * out on another.
 *
 * The effect is always the same direction: a real pattern is UNDER-counted and
 * may fall below the two-occurrence floor, so it is not shown. It cannot
 * invent a pattern that does not exist, and it cannot merge two criteria that
 * are genuinely different.
 *
 * Fuzzy matching would fix the splitting and introduce the opposite failure —
 * two distinct criteria merged into one confident insight, shown to a student
 * as a pattern in their work. Under-reporting a true pattern is a missed
 * opportunity; reporting a false one is a lie. Not the trade to make without
 * data, and there is none yet.
 */
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
           c.id::text AS chapter_id, c.name AS chapter_name,
           s.id::text AS subject_id, s.name AS subject_name, a.attempted_at
      FROM attempts a
      JOIN chapters c ON c.id = COALESCE(a.chapter_id, (SELECT chapter_id FROM questions WHERE id = a.question_id))
      JOIN subjects s ON s.id = c.subject_id
     WHERE a.user_id = ${userId}::uuid
       AND a.bareme_result IS NOT NULL
       AND (${options.subjectId ?? null}::uuid IS NULL OR s.id = ${options.subjectId ?? null}::uuid)

    UNION ALL

    SELECT ea.bareme_result, q.id::text AS question_id,
           c.id::text AS chapter_id, c.name AS chapter_name,
           s.id::text AS subject_id, s.name AS subject_name, ea.submitted_at AS attempted_at
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
  /*
   * Every chapter and subject a criterion was lost in, counted separately from
   * `occasions` because that list is capped at five. Routing is decided from
   * these and they are thrown away afterwards.
   */
  const seen = new Map<string, { chapterIds: Set<string>; subjectIds: Set<string> }>();

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

      const where = seen.get(key) ?? { chapterIds: new Set<string>(), subjectIds: new Set<string>() };
      where.chapterIds.add(row.chapter_id);
      where.subjectIds.add(row.subject_id);
      seen.set(key, where);

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
          // Replaced below, once every row has been read.
          scope: { kind: 'none' },
        });
      }
    }
  }

  for (const [key, loss] of grouped) {
    const where = seen.get(key);
    if (!where) continue;
    loss.scope = lossScope({
      chapterIds: where.chapterIds,
      subjectIds: where.subjectIds,
      // The most recent occurrence's chapter, which is only ever used when
      // every occurrence shares it.
      chapterName: loss.occasions[0]?.chapterName ?? '',
      subjectName: loss.subjectName,
    });
  }

  return [...grouped.values()]
    .filter((loss) => loss.times >= MIN_OCCURRENCES)
    // Marks forgone, not occurrences: losing 9 points twice matters more than
    // losing 1 point three times, and a student revising has finite hours.
    .sort((a, b) => b.pointsLost - a.pointsLost || b.times - a.times)
    .slice(0, limit);
}
