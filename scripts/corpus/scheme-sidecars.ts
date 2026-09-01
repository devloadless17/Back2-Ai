/**
 * The marking schemes recovered by `corpus:schemes`, turned into barèmes.
 *
 * `read-schemes.ts` reads a paper's printed scheme table and writes one sidecar
 * per paper under `corpus/schemes/<sha256>.json`. Those files are inert until
 * something maps their rows onto the questions in the database, which is what
 * this does, and `load-exams.ts` calls it.
 *
 * WHY THE SCHEME WINS OVER THE EXTRACTED TEXT
 *
 * The text path infers a barème from marks printed beside the questions, and
 * where a paper prints none it falls back to ONE criterion worth the whole
 * exercise — 2,221 questions are in that state, so a six-part exercise is
 * marked as a single undifferentiated lump and a student who got four parts
 * right learns only that they lost marks somewhere.
 *
 * The scheme table is the ministry's own row-by-row breakdown of exactly that.
 * When a paper has one, it is not a better guess than the text path — it is the
 * thing the text path was trying to reconstruct.
 *
 * THE SCALE IS THE DANGEROUS PART
 *
 * A scheme is often printed on a different scale from the paper: GS maths
 * schemes total 40 for a paper marked out of 20, LH maths 20, SE maths 35.
 * `read-schemes.ts` measures that ratio per paper by requiring several
 * exercises to agree on it independently, and stores it as `scaleRatio`.
 *
 * Every mark here is divided by it. Skipping that division shows a student 2.5
 * marks for a question worth 1.25, under an official barème's authority — the
 * exact failure the ratio was measured to prevent. It is applied in one place,
 * below, for that reason.
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

export type SchemeRow = {
  exercise: string;
  label: string;
  answer: string;
  marks: number | null;
};

export type Sidecar = {
  path: string;
  sha256: string;
  subject: string | null;
  track: string;
  scaleRatio: number;
  illegible: boolean;
  droppedExercises?: string[];
  rows: SchemeRow[];
};

/** Longest a single criterion may run. Matches the text path's own cap. */
const CRITERION_MAX = 300;

/** Longest a rebuilt official solution may run, to keep one paper out of a prompt budget. */
const SOLUTION_MAX = 8000;

export function loadSidecars(dir: string): Map<string, Sidecar> {
  const out = new Map<string, Sidecar>();
  if (!existsSync(dir)) return out;

  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    try {
      const sidecar = JSON.parse(readFileSync(path.join(dir, file), 'utf8')) as Sidecar;
      if (sidecar.sha256 && Array.isArray(sidecar.rows)) out.set(sidecar.sha256, sidecar);
    } catch {
      // A half-written sidecar is skipped rather than failing the load. The
      // paper simply falls back to the text path, which is where it was before.
    }
  }
  return out;
}

/**
 * An exercise token reduced to its number, so a scheme's own numbering can be
 * matched against `exams.json`'s `exercise.index`.
 *
 * Kept identical in behaviour to `read-schemes.ts`'s version — the two have to
 * agree or a paper verified under one numbering is stored under another.
 */
export function exerciseKey(token: string): string {
  const trimmed = String(token ?? '').trim();

  const arabicOrdinals: [string, number][] = [
    ['الأول', 1], ['الاول', 1], ['الثاني', 2], ['الثالث', 3],
    ['الرابع', 4], ['الخامس', 5], ['السادس', 6],
  ];
  for (const [word, value] of arabicOrdinals) if (trimmed.includes(word)) return String(value);

  const digit = trimmed.match(/(\d{1,2})/);
  if (digit) return digit[1]!;

  const roman = trimmed.match(/\b([IVX]+)\b/i);
  if (roman) {
    const map: Record<string, number> = { I: 1, V: 5, X: 10 };
    const s = roman[1]!.toUpperCase();
    let total = 0;
    for (let i = 0; i < s.length; i += 1) {
      const here = map[s[i]!] ?? 0;
      const next = map[s[i + 1]!] ?? 0;
      total += here < next ? -here : here;
    }
    return String(total);
  }

  return trimmed.slice(0, 3);
}

export type SchemeGrounding = {
  /** Per-part criteria, already on the PAPER's scale. */
  bareme: { criterion: string; points: number }[];
  /** The official answers, row by row. */
  solution: string | null;
  /** True when the reader flagged anything unreadable on this paper. */
  illegible: boolean;
};

/**
 * What the scheme says about one exercise.
 *
 * Returns null when this paper's scheme has nothing for it — a paper whose
 * scheme was only partly readable still contributes the exercises it covered,
 * and the rest fall back to the text path rather than being blanked.
 */
export function schemeFor(sidecar: Sidecar, exerciseIndex: number | string | undefined, position: number): SchemeGrounding | null {
  const key = exerciseKey(String(exerciseIndex ?? position));
  const rows = sidecar.rows.filter((r) => exerciseKey(r.exercise) === key);
  if (rows.length === 0) return null;

  /*
   * A dropped exercise is one `read-schemes.ts` could not reconcile against the
   * paper's stated total. Its rows are not written to the sidecar, but the
   * check is repeated here so that a sidecar produced by an older version — or
   * hand-edited — cannot reintroduce them.
   */
  if (sidecar.droppedExercises?.some((d) => exerciseKey(d) === key)) return null;

  const ratio = sidecar.scaleRatio > 0 ? sidecar.scaleRatio : 1;

  const bareme = rows
    .filter((r) => typeof r.marks === 'number' && r.marks > 0)
    .map((r) => ({
      criterion: `${r.label} ${r.answer}`.replace(/\s+/g, ' ').trim().slice(0, CRITERION_MAX),
      // THE division. See the header note on scale.
      points: Math.round((r.marks! / ratio) * 100) / 100,
    }))
    .filter((c) => c.points > 0);

  const answered = rows.filter((r) => r.answer.trim());
  const solution = answered.length
    ? answered
        .map((r) => `${r.label} ${r.answer}`.trim())
        .join('\n')
        .slice(0, SOLUTION_MAX)
    : null;

  if (bareme.length === 0 && !solution) return null;

  return { bareme, solution, illegible: sidecar.illegible };
}
