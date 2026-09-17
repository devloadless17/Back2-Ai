/**
 * Where an old `/todos` link should land.
 *
 * A todo has no date. It is capture; a study session is commitment. The two
 * are different things and both are kept, but they are two answers to one
 * question — "what am I meant to be doing" — and splitting them across two
 * top-level routes meant a todo went into a drawer nobody opened. It appeared
 * on `/todos` and nowhere else: not on the Dashboard, not in Today, not in any
 * count.
 *
 * Kept out of the route file so it can be tested without a Next.js request.
 */
export function todosRedirectTarget(
  searchParams: Record<string, string | string[] | undefined>,
): string {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(searchParams)) {
    if (value === undefined) continue;
    for (const one of Array.isArray(value) ? value : [value]) query.append(key, one);
  }

  const suffix = query.toString();
  return suffix ? `/schedule?${suffix}` : '/schedule';
}
