/**
 * Pure rules of the visual-evidence backfill, kept apart from the script so
 * they can be tested without running it.
 */

/** Containers repeating an earlier run of >= 3 marks with >= 2 distinct values: a scheme or a second copy. */
export function secondPassOrdinals(exercises: Array<{ marks?: number | null }>): Set<number> {
  const marks = exercises.map((e) => e.marks ?? null);
  const out = new Set<number>();
  const n = marks.length;
  for (let len = Math.floor(n / 2); len >= 3; len -= 1) {
    for (let i = 0; i + len <= n; i += 1) {
      const run = marks.slice(i, i + len);
      if (run.includes(null) || new Set(run).size < 2) continue;
      for (let j = i + len; j + len <= n; j += 1) {
        if (marks.slice(j, j + len).every((m, k) => m === run[k])) {
          for (let k = j + 1; k <= j + len; k += 1) out.add(k);
        }
      }
    }
  }
  return out;
}

/**
 * JSON with object keys sorted. Postgres `jsonb` stores keys in its own order,
 * so comparing a stored locator with a planned one by plain `JSON.stringify`
 * reports a change on every run — the second apply "updated" all 357 relations
 * that carry locators. Compared this way, identical content is identical.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>).sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

