/**
 * The labels printed inside a figure, read into the question as text.
 *
 * A PDF's text layer holds a diagram's labels as ordinary text, so a question
 * whose display falls back to that layer shows them one per line where the
 * figure was: "S / Laser / source / x / O / D / (E) / Doc. 7 / L / θ1". The
 * figure itself now reaches the student as a crop, so the run of labels is
 * pure noise. Measured on production 2026-09-29: ~284 live science questions.
 *
 * A LABEL LINE is tiny and says nothing on its own: one or two words, at most
 * 14 characters, not a sub-question marker ("1-3-2)", "a-", "II."), not an
 * equation, not a question, not the end of a sentence. Only a RUN of four or
 * more is removed — a single short line is often real ("Données :", "x = 2").
 */

const MAX_LEN = 14;
const MIN_RUN = 4;

const SUBQUESTION = /^\(?(\d+(?:[-–.]\d+)*|[a-hA-H]|[IVX]{1,4})\s*[-–.)]\s*/;

export function isLabelLine(line: string): boolean {
  const s = line.trim();
  if (!s || s.length > MAX_LEN) return false;
  if (SUBQUESTION.test(s) && s.length > 3) return false;
  if (/[=?]|[.!:;]$/.test(s) && !/^doc\.?\s*\d+\.?$/i.test(s)) return false;
  return s.split(/\s+/).length <= 2;
}

export function stripLabelRuns(text: string): { text: string; removed: string[] } {
  const lines = text.split('\n');
  const drop = new Set<number>();
  let i = 0;
  while (i < lines.length) {
    if (!isLabelLine(lines[i]!)) {
      i++;
      continue;
    }
    // Extend the run across blank lines between labels.
    let j = i;
    const run: number[] = [];
    while (j < lines.length && (isLabelLine(lines[j]!) || (!lines[j]!.trim() && run.length > 0))) {
      if (lines[j]!.trim()) run.push(j);
      j++;
    }
    // A run that is really content broken over lines stays: a nuclear or
    // chemical equation ("235 / 92U → / A / ZX"), a codon table ("AUC Ile"),
    // a bulleted list. The dry run on the corpus found all three.
    const protectedRun = run.some((k) => /[→⟶⇌⇒+•]|^[AUGCT]{3}\b/.test(lines[k]!.trim()));
    if (run.length >= MIN_RUN && !protectedRun) for (const k of run) drop.add(k);
    i = j;
  }
  if (!drop.size) return { text, removed: [] };
  const removed = [...drop].map((k) => lines[k]!.trim());
  const kept = lines.filter((_, k) => !drop.has(k)).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { text: kept, removed };
}
