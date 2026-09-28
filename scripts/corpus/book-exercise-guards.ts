/**
 * Whether an extracted exercise is fit to load.
 *
 * Kept apart from `load-book-exercises.ts` so it can be tested without a
 * database, the same way `paper-language-rules.ts` is.
 */

/**
 * A reply that came back with a NUL byte where a letter should be.
 *
 * Twelve exercises carry U+0000 in place of an accented character: chimie-fr
 * reads "pr<NUL>sente" for "présente" and "2-ph<NUL>nyl<NUL>thanol" for
 * "2-phényléthanol". Postgres refuses the byte outright — `invalid byte sequence
 * for encoding "UTF8": 0x00` — so the first one aborted the whole load and not a
 * single exercise was written.
 *
 * STRIPPING THE BYTE WOULD BE WORSE THAN HOLDING. It loads cleanly and gives the
 * student "prsente", a misspelt question nobody would notice was damaged. So a
 * corrupted exercise is held like any other unusable one, and re-reading those
 * five pages — a paid run — can recover them later.
 *
 * IT WALKS THE VALUES RATHER THAN THE JSON, after two wrong attempts. Comparing
 * `JSON.stringify(e)` against a literal NUL never matches, because stringify
 * escapes the byte into six characters. Searching that stringified text for
 * those six characters instead matches too much: an exercise that merely SPELLS
 * the escape — a question about encodings — has its backslash escaped too, and
 * still contains them. Looking at each string for the real character is both
 * simpler and exact.
 */
export function hasCorruptByte(value: unknown): boolean {
  if (typeof value === 'string') return value.includes('\u0000');
  if (Array.isArray(value)) return value.some(hasCorruptByte);
  if (value && typeof value === 'object') return Object.values(value).some(hasCorruptByte);
  return false;
}
