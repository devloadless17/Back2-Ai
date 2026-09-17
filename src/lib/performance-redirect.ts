/**
 * Where an old `/performance` link should land.
 *
 * Kept out of the route file so it can be tested without a Next.js request:
 * `permanentRedirect` works by throwing, which is awkward to assert against,
 * and the part worth testing is the target, not the throw.
 *
 * Query context is carried across. A bookmark of
 * `/performance?subject=<id>` came from a student who was looking at one
 * subject, and dropping that on the way through is a small, avoidable loss.
 * Nothing is invented: unknown parameters are passed on untouched rather than
 * filtered against a list this file would then have to keep up to date.
 */
export function performanceRedirectTarget(
  searchParams: Record<string, string | string[] | undefined>,
): string {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(searchParams)) {
    if (value === undefined) continue;
    // A repeated parameter arrives as an array and must stay repeated.
    for (const one of Array.isArray(value) ? value : [value]) query.append(key, one);
  }

  const suffix = query.toString();
  return suffix ? `/progress?${suffix}` : '/progress';
}
