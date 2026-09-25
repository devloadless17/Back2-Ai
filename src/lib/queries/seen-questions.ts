import 'server-only';

import { db } from '@/lib/db';

/**
 * A question's identity for "has this student seen it", which is its text,
 * not its row.
 *
 * The same exercise is stored more than once: GS and LS sit the same paper and
 * the corpus files a copy under each track, and a paper sometimes sits twice
 * in one folder under two filenames. Every "never repeat" rule in the product
 * checked attempts by id, so a student who answered the GS copy was offered
 * the LS copy as new. Whitespace is dropped because the copies differ in line
 * breaks and nothing else.
 */
export function questionKey(contentText: string): string {
  return contentText.replace(/\s+/g, '');
}

/** The keys of every question this student has attempted, in any copy. */
export async function seenQuestionKeys(userId: string): Promise<Set<string>> {
  const rows = await db.attempt.findMany({
    where: { userId, questionId: { not: null } },
    select: { question: { select: { contentText: true } } },
  });
  return new Set(rows.flatMap((r) => (r.question ? [questionKey(r.question.contentText)] : [])));
}

/** One row per question, in the order given; the first copy wins. */
export function oneCopyEach<T extends { contentText: string }>(rows: T[]): T[] {
  const kept = new Map<string, T>();
  for (const row of rows) {
    const key = questionKey(row.contentText);
    if (!kept.has(key)) kept.set(key, row);
  }
  return [...kept.values()];
}
