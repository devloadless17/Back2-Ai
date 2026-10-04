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
  /** A tightly bounded crop of this part in the official answer key. */
  answerImage?: string;
};

export type PaperParts = {
  intro: string;
  parts: PaperPart[];
  /** The exercise's whole official key, kept when some part has no answer of its own. */
  fullKey?: string;
};

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
    return match ? `${match[1]!.replace(/\D/g, '')}${(match[2] ?? '').toLowerCase()}` : '';
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
    // Never trust an arbitrary URL in corpus JSON.  Official answer evidence
    // is a published crop stored with the application, not an external image
    // embedded by an OCR result.
    const answerImage = typeof p.answerImage === 'string' && /^\/answer-figures\/[a-z0-9][a-z0-9._-]*\.(?:png|jpe?g|webp)$/i.test(p.answerImage)
      ? p.answerImage
      : undefined;
    parts.push({
      ...part,
      ...(paperPartAnswerIsUsable(candidate, part) ? { answer: candidate } : {}),
      ...(answerImage ? { answerImage } : {}),
    });
  }
  const fullKey = (value as { fullKey?: unknown }).fullKey;
  return {
    intro: typeof v.intro === 'string' ? v.intro : '',
    parts,
    ...(typeof fullKey === 'string' && fullKey.trim() ? { fullKey } : {}),
  };
}

/** Parts the page shows with no answer of their own: not headings, no text, no crop. */
export function partsWithoutAnswer(parts: PaperPart[]): number {
  return parts.filter((p, i) => !p.answer && !p.answerImage && !partOnlyHeads(parts, i)).length;
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

/**
 * A part that only heads others ("2- Preliminary study" above 2.1, 2.2): its
 * sub-parts carry the answers, so its own lack of one is not a gap.
 */
export function partOnlyHeads(parts: Pick<PaperPart, 'label'>[], index: number): boolean {
  const own = parts[index]?.label;
  return Boolean(own) && parts.some((p, i) => i !== index && p.label.startsWith(`${own}.`));
}

/** "0.75", "1", "1.5" — a mark as the paper prints it, without trailing zeros. */
export function formatMarks(marks: number): string {
  return String(Math.round(marks * 100) / 100);
}
