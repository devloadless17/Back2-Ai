/**
 * An exercise as its printed parts, read from `questions.paper_parts`.
 *
 * Written by scripts/corpus/load-paper-parts.ts. The column is JSON, so it is
 * checked here rather than trusted: a malformed value reads as "no parts" and
 * the page shows the exercise as one block, the way it always did.
 */

export type PaperPart = {
  label: string;
  /** Markdown with LaTeX, starting with the part's own printed label. */
  text: string;
  /** The scheme's marks for this part, on the paper's own scale. */
  marks?: number;
  /** The scheme's answer for this part, verbatim. */
  answer?: string;
};

export type PaperParts = { intro: string; parts: PaperPart[] };

/**
 * An official answer is evidence, not merely non-empty text.
 *
 * Some legacy answer-key rows contain a table cell ("& 1"), the printed
 * question copied from a bad range, or a line for another numbered part.  It
 * is safer to say that an answer has not been recorded than to put a confident
 * but unrelated ministry answer under a student's question.
 */
export function paperPartAnswerIsUsable(answer: string, part: Pick<PaperPart, 'label' | 'text'>): boolean {
  const value = answer.trim();
  if (!value || /[\uFFFD]|Ã[\x80-\xBF]|Â[\x80-\xBF]|â(?:€™|€œ|€|€“|€”)/u.test(value)) return false;

  // A bare table row or mark does not answer the question. A compact equation
  // such as "x = 2" is allowed because it includes a mathematical relation.
  const words = value.match(/[\p{L}]{3,}/gu) ?? [];
  const hasMath = /[=+\-*/^]|\\(?:frac|sqrt|mathrm|left|right)\b/u.test(value);
  if (words.length === 0 && !hasMath) return false;
  if (words.length === 0 && value.replace(/[\d\s.,()\[\]{}$\\=&;:—–\-]/g, '').length === 0) return false;

  const compact = (text: string) => text
    .replace(/^\s*[A-ZIVX]+[.\-]?\s*\d*(?:[.\-][a-z\d]+)?\s*[.)\-:]?\s*/i, '')
    .replace(/[\W_]/g, '')
    .toLocaleLowerCase();
  const question = compact(part.text);
  const candidate = compact(value);
  // A short key range that is really the question itself has no answer in it.
  if (question.length >= 24 && candidate.length >= 24 &&
      (candidate.includes(question) || question.includes(candidate))) return false;

  const keyOf = (text: string) => {
    const match = text.match(/^\s*(?:[A-Z]+\s*[.\-]\s*)?(\d+(?:\s*[.\-]\s*\d+)*)(?:\s*([a-z]))?\b/i);
    return match ? `${match[1].replace(/\D/g, '')}${(match[2] ?? '').toLowerCase()}` : '';
  };
  const expected = keyOf(part.label);
  const actual = keyOf(value);
  if (expected && actual && actual !== expected && !actual.startsWith(expected) && !expected.startsWith(actual)) return false;

  return true;
}

export function paperPartsOf(value: unknown): PaperParts | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as { intro?: unknown; parts?: unknown };
  if (!Array.isArray(v.parts) || v.parts.length === 0) return null;
  const parts: PaperPart[] = [];
  for (const raw of v.parts) {
    if (!raw || typeof raw !== 'object') return null;
    const p = raw as Record<string, unknown>;
    if (typeof p.label !== 'string' || typeof p.text !== 'string') return null;
    const candidate = typeof p.answer === 'string' ? p.answer : '';
    const part = {
      label: p.label,
      text: p.text,
      ...(typeof p.marks === 'number' && Number.isFinite(p.marks) ? { marks: p.marks } : {}),
    } satisfies Omit<PaperPart, 'answer'>;
    parts.push({
      ...part,
      ...(paperPartAnswerIsUsable(candidate, part) ? { answer: candidate } : {}),
    });
  }
  return { intro: typeof v.intro === 'string' ? v.intro : '', parts };
}

/**
 * A part's text, with its printed label kept as text.
 *
 * "1) Redraw the circuit" is an ordered list item to Markdown, which renders
 * the number as a list marker — and the page sets lists without markers, so
 * the part lost its number. The bracket is written as a character reference,
 * which Markdown prints as ")" but does not read as a list. Not `\)`: the
 * viewer turns `\( … \)` into maths, and "3\)" opened a formula.
 */
export function partMarkdown(text: string): string {
  return text.replace(/^(\s*)(\d{1,2})([.)])(?=\s)/, (_, space: string, n: string, mark: string) =>
    `${space}${n}${mark === ')' ? '&#41;' : '&#46;'}`,
  );
}

/** "0.75", "1", "1.5" — a mark as the paper prints it, without trailing zeros. */
export function formatMarks(marks: number): string {
  return String(Math.round(marks * 100) / 100);
}
