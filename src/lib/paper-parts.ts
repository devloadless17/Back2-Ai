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

export function paperPartsOf(value: unknown): PaperParts | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as { intro?: unknown; parts?: unknown };
  if (!Array.isArray(v.parts) || v.parts.length === 0) return null;
  const parts: PaperPart[] = [];
  for (const raw of v.parts) {
    if (!raw || typeof raw !== 'object') return null;
    const p = raw as Record<string, unknown>;
    if (typeof p.label !== 'string' || typeof p.text !== 'string') return null;
    parts.push({
      label: p.label,
      text: p.text,
      ...(typeof p.marks === 'number' && Number.isFinite(p.marks) ? { marks: p.marks } : {}),
      ...(typeof p.answer === 'string' && p.answer.trim() ? { answer: p.answer } : {}),
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
