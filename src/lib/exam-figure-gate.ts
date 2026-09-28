import 'server-only';

import { visualKeysFor } from '@/lib/visual-evidence';

/**
 * A question that points at something printed on the paper: a figure, a
 * graph, a curve, a diagram, a map.
 *
 * Measured 2026-09-28 on the local corpus: 1,764 past-exam questions point at
 * a figure and 965 of them have none the app can show, because only the
 * physics crops have passed their audit. On a timed, marked mock paper, "use
 * the graph in figure 2" with no figure is a question the student cannot do
 * and is still scored on.
 *
 * "document" and المستند are left out on purpose. In the language subjects and
 * in civics they name the reading text, which is shown with the question from
 * `source_passage`, not a picture. "Document 2" with a number is kept: in the
 * sciences that is a figure.
 */
const NEEDS_FIGURE =
  /\b(?:fig(?:ure)?s?\.?\s*\d|figure|doc(?:ument)?\.?\s*\d|graph(?:e|ique)?|courbe|curve|diagram(?:me)?|sch[ée]ma|ci-contre|opposite)\b|الشكل|الرسم البياني|المنحنى|الخريطة|الخارطة/i;

export function needsFigure(text: string): boolean {
  return NEEDS_FIGURE.test(text);
}

/**
 * Drop the questions that need a figure the app cannot show.
 *
 * Decided by `visualKeysFor`, the same selector the exam screen uses to show
 * figures, so "can be shown" here and "is shown" there cannot disagree.
 */
export async function withShowableFigures<T extends { id: string; contentText: string; contentImages?: string[] }>(
  pool: T[],
): Promise<{ kept: T[]; dropped: number }> {
  const needing = pool.filter((q) => needsFigure(q.contentText));
  if (needing.length === 0) return { kept: pool, dropped: 0 };

  const keys = await visualKeysFor(
    needing.map((q) => ({ id: q.id, contentText: q.contentText, contentImages: q.contentImages ?? [] })),
  );
  const unshowable = new Set(needing.filter((q) => (keys.get(q.id) ?? []).length === 0).map((q) => q.id));
  return { kept: pool.filter((q) => !unshowable.has(q.id)), dropped: unshowable.size };
}
