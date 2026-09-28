import 'server-only';

import { db } from '@/lib/db';
import { visualKeysFor } from '@/lib/visual-evidence';

/**
 * A question that points at a picture printed on the paper.
 *
 * STRICT ON PURPOSE. The first version also matched "document 2", "graph",
 * "courbe" and "curve", and a hand audit of 12 flagged exercises found 3 real
 * figures: the rest asked the student to DRAW a curve ("Tracer la courbe",
 * "Plot the curve", "sa courbe représentative") or cited a "Doc. 4" that is a
 * boxed paragraph or a table already in the text. It dropped three good
 * questions for every broken one. Only words that name a printed picture are
 * kept here; the stronger signal is the figure rows themselves (below).
 */
const NAMES_A_PICTURE =
  /\bfig(?:ure)?s?\.?\s*\d|\bfigure\s+(?:ci-contre|ci-dessous|ci-dessus|suivante)|\b(?:adjacent|opposite|following|above|below)\s+(?:figure|diagram|drawing)|\bci-contre\b|\bsch[ée]ma|\bdiagram|الشكل|الخريطة|الخارطة|الرسم التخطيطي/i;

export function needsFigure(text: string): boolean {
  return NAMES_A_PICTURE.test(text);
}

/**
 * Drop the questions that need a figure the app cannot show.
 *
 * A question needs a figure when a crop of one exists for it (any status: a
 * pending crop is a figure found on the paper and not yet approved), or when
 * its text names a printed picture. It can show one when `visualKeysFor` — the
 * selector the exam screen uses — returns a key, so "can be shown" here and
 * "is shown" there cannot disagree.
 */
export async function withShowableFigures<T extends { id: string; contentText: string; contentImages?: string[] }>(
  pool: T[],
): Promise<{ kept: T[]; dropped: number }> {
  if (pool.length === 0) return { kept: pool, dropped: 0 };

  const withRows = new Set(
    (
      await db.questionVisual.findMany({
        where: {
          questionId: { in: pool.map((q) => q.id) },
          role: { not: 'solution_material' },
          status: { not: 'rejected' },
        },
        select: { questionId: true },
      })
    ).map((r) => r.questionId),
  );

  const needing = pool.filter((q) => withRows.has(q.id) || needsFigure(q.contentText));
  if (needing.length === 0) return { kept: pool, dropped: 0 };

  const keys = await visualKeysFor(
    needing.map((q) => ({ id: q.id, contentText: q.contentText, contentImages: q.contentImages ?? [] })),
  );
  const unshowable = new Set(needing.filter((q) => (keys.get(q.id) ?? []).length === 0).map((q) => q.id));
  return { kept: pool.filter((q) => !unshowable.has(q.id)), dropped: unshowable.size };
}
