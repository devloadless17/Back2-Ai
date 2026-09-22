/**
 * Reads the marking schemes the papers already carry.
 *
 *   npm run corpus:schemes -- --dry                     # worklist only, no calls
 *   npm run corpus:schemes -- --subject maths --limit 5 # a pilot
 *   npm run corpus:schemes -- --track GS
 *
 * WHY THIS EXISTS
 *
 * 770 of the 891 papers in the MVP subjects have a marking scheme printed on
 * them, and the text pipeline recovers almost nothing from any of them. On
 * `gs/2004 1/2004 gs math_en 1.pdf` the scheme runs six pages under the headers
 * `Q | Short answers | M` — every answer, every mark — and `exams.json` records
 * `answersFound: 0`. Across all four tracks, maths has ZERO official answers
 * extracted from 4,046 parts.
 *
 * That is a reader failure, not a gap in the corpus, and the reason is written
 * down in `extract_exams.py`: a scheme is a ruled table, pypdf flattening
 * interleaves the columns, and the answer's own mathematics sheds bare digits
 * that a line-based reader turns into phantom rows. Page 5 of that maths paper
 * extracts as `f '(x) = 2x93 x2` — a fraction with its bar gone. No regex
 * recovers that, because the information is destroyed before the regex runs.
 *
 * `scheme_table.py` addressed this geometrically with pdfplumber and accepts
 * about 30% of papers, because it needs clean ruling lines. This reads the page
 * as an IMAGE instead, which is the one representation where the column a mark
 * sits in is still visible.
 *
 * WHAT KEEPS IT HONEST
 *
 * This writes an official-looking barème, so the guard has to be more than "the
 * model said so". Two checks, both mechanical, both in `verify()`:
 *
 *   The marks must reconcile with what the paper says about itself. Every
 *   exercise header states its own total, and the scheme's rows for that
 *   exercise are summed against it. Several exercises landing on ONE ratio is
 *   the evidence — a misread mark column moves one exercise, not all of them by
 *   the same factor — and the ratio is often not 1: GS maths schemes are printed
 *   on 40 for a paper marked out of 20, LH on 20, SE maths on 35, each agreeing
 *   with itself across every exercise. So agreement decides, not a list of
 *   ratios this tool expected to see.
 *
 *   Where a minority of exercises dissent, THEIR ROWS ARE DROPPED and the rest
 *   are kept. The dissenter is more often the paper's fault than the scheme's —
 *   520 exercises here are scored out of less than their own header states —
 *   and refusing the paper outright discarded five sound exercises to avoid one
 *   doubtful one. Nothing doubtful is stored either way.
 *
 *   Nothing is accepted that carries neither a mark nor an answer. An empty row
 *   is the model padding the table to the shape it was asked for.
 *
 * TWO SHAPES, NOT ONE
 *
 * The arithmetic above only applies to schemes that HAVE marks. A chemistry or
 * physics scheme is commonly printed as `Réponses attendues | Remarques` — the
 * expected answer and the examiner's notes, with no mark column at all, the
 * total living in the exercise heading. The first cut required marks and so
 * refused every one of those papers, discarding official answers in the subjects
 * where answers are scarcest: chemistry has barèmes for 96% of its questions and
 * answers for 25%.
 *
 * Those papers are accepted on a STRUCTURAL check instead — they must name no
 * exercise the paper lacks, and must cover at least half of the ones it has —
 * and they contribute answers only, leaving the paper's existing barème alone.
 *
 * THE SCHEME ALSO AUDITS THE QUESTION EXTRACTION
 *
 * When a scheme names an exercise the parse does not have, the paper's own total
 * says which side is wrong. Twenty means the scheme misread; well under twenty
 * means the parse missed an exercise and the scheme just found it. 150 of the
 * 891 MVP papers total under 19.5 at a median of 7, which is roughly a third of
 * a paper never extracted — a question-extraction bug this tool can see and
 * therefore reports in those words.
 *
 * A refusal here is cheap and a wrong barème is not: it marks a student against
 * criteria the ministry did not write, while looking exactly like criteria the
 * ministry did write.
 *
 * WHAT IT DOES NOT DO
 *
 * It never writes `corpus/exams.json`. Output goes to `corpus/schemes/<sha>.json`,
 * one sidecar per paper, and `load-exams.ts` picks them up on the next load. A
 * `--limit` run that rewrote the shared file would retire every question from
 * the papers it did not visit; that has happened once already and the comparator
 * was moved to its own snapshot directory because of it.
 */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

import { ai } from '@/lib/ai';
import { env } from '@/lib/env';
import { toAiImage } from '@/lib/ocr';
import { AiError } from '@/lib/ai/types';
import type { AiImage } from '@/lib/ai';

const run = promisify(execFile);

const EXAMS_DIR = path.resolve('corpus/exams');
const EXAMS_JSON = path.resolve('corpus/exams.json');
const OUT_DIR = path.resolve('corpus/schemes');

/**
 * Render resolution.
 *
 * 200 is enough to read a printed mark column and a typeset fraction, and keeps
 * an A4 page around 300-500KB as PNG. 150 loses subscripts on the maths papers;
 * 300 triples the payload for nothing a mark column needs.
 */
const DPI = 200;

/** Scheme pages sent in one call. More than this and the model starts merging rows across pages. */
const PAGES_PER_CALL = 2;

/**
 * Papers read at once.
 *
 * The work is entirely provider latency — rendering a page is milliseconds and
 * reading it is tens of seconds — so this is bounded by the account's rate
 * limit rather than by this machine.
 *
 * Measured downwards, twice. Six lost 32 of 195 papers to 429s. Four then
 * managed one acceptance in eleven papers against 43 retries, which is worse
 * than serial: every request that trips the limit still costs its tokens, so
 * over-parallelising here does not merely fail to help, it spends the budget on
 * calls that return nothing.
 *
 * The binding limit is tokens per minute rather than requests. Each call
 * carries two rendered pages, and an A4 page at 200 DPI is a large image; two
 * workers is roughly four page-images in flight, which this account sustains.
 */
const CONCURRENCY = 2;

/**
 * Retries for a rate-limited call.
 *
 * The first full maths run lost 32 of 195 papers to 429s — a fifth of the run,
 * reported as `refused` alongside genuine quality refusals, which is the worst
 * possible place to put them: a transport failure and a scheme this tool does
 * not trust look identical in the summary, and the 32 would have been read as
 * "the reader cannot handle these papers".
 *
 * The provider client already retries three times internally; these are the
 * ones that exhausted that. Backing off in seconds rather than milliseconds is
 * the point — a rate limit clears on the provider's clock, not ours.
 */
const RETRIES = 6;
const BACKOFF_MS = [10_000, 30_000, 60_000, 120_000, 180_000, 240_000];

/**
 * Reading effort.
 *
 * `medium`, not `high`, and the distinction is real here: this is transcription
 * of a printed table, not a judgement about it. The model is told never to
 * infer a mark that is not printed, so there is nothing for extra reasoning to
 * be right about — and the verification that follows is arithmetic, which does
 * not care how hard the reader thought. Measured at `high` this ran roughly
 * four minutes per paper, which is 50 hours across the MVP subjects.
 */
const EFFORT = 'medium' as const;

// ---------------------------------------------------------------------------
// The papers this runs on
// ---------------------------------------------------------------------------

/**
 * Subject from the filename, handling both naming eras.
 *
 * The pre-2021 files are `gs math_en 1.pdf`; from 2021 they are
 * `SVSG_Bio_2021_1_Ar.pdf`, where the leading token is the TRACK PAIR and the
 * subject is second. A classifier that reads the first token calls every 2021
 * paper `svsg` and silently drops a year from every subject.
 */
const SUBJECT_RULES: [RegExp, string][] = [
  [/\b(math|maths|mathematiques?)\b/i, 'maths'],
  [/\b(chem|chim|chemistry|chimie)\b/i, 'chemistry'],
  [/\b(phy|phys|physics|physique)\b/i, 'physics'],
  [/\b(bio|biology|biologie|svt|sv)\b/i, 'biology'],
  [/\b(ektesad|ektisad|eco|econ|economie|economics)\b/i, 'economics'],
  [/\b(ejteme3?|ejtm3|socio|sociologie)\b/i, 'sociology'],
];

const TRACK_PREFIX = /^(svsg|selh|se|gs|ls|lh)[_\s-]+/i;

export function subjectOf(file: string): string | null {
  const cleaned = file.replace(/\.pdf$/i, '').replace(/[_\-.]/g, ' ').replace(TRACK_PREFIX, ' ');
  for (const [pattern, name] of SUBJECT_RULES) if (pattern.test(cleaned)) return name;
  return null;
}

type Part = { label?: string; marks?: number; answer?: string; text?: string };
type Exercise = { index?: number | string; marks?: number; parts?: Part[] };
type Paper = {
  path: string;
  sha256: string;
  track: string;
  file: string;
  pages: number;
  paperPages: number;
  schemePages: number;
  language: string;
  totalMarks?: number;
  answersFound: number;
  marksFound: number;
  exercises?: Exercise[];
  error?: string;
};

// ---------------------------------------------------------------------------
// What the model is asked for
// ---------------------------------------------------------------------------

/**
 * One row of the scheme, as printed.
 *
 * `label` is the paper's own numbering — "I.1", "2b", "أ" — not a position.
 * Positional numbering is what attaches an answer key to the wrong sub-question,
 * and an answer key on the wrong sub-question is a confident wrong answer shown
 * to an exam candidate.
 *
 * `marks` is null when the row's mark cell is empty, which is common: a scheme
 * often marks the exercise once and lists its steps unmarked underneath.
 */
const ROW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['rows', 'pageIsScheme', 'illegible'],
  properties: {
    pageIsScheme: { type: 'boolean' },
    illegible: { type: 'boolean' },
    rows: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['exercise', 'label', 'answer', 'marks'],
        properties: {
          exercise: { type: 'string' },
          label: { type: 'string' },
          answer: { type: 'string' },
          marks: { type: ['number', 'null'] },
        },
      },
    },
  },
} as const;

type SchemeRow = { exercise: string; label: string; answer: string; marks: number | null };
type SchemeRead = { rows: SchemeRow[]; pageIsScheme: boolean; illegible: boolean };

const SYSTEM = [
  'You read the official marking scheme printed on a Lebanese Baccalaureate exam paper.',
  '',
  'The scheme is a table, and Lebanese papers print it in two different shapes.',
  '',
  '  MARKED   columns like "Q | Short answers | M" — a mark against each row.',
  '  ANSWERS  columns like "Réponses attendues | Remarques" — that is, the',
  '           expected answer and the remarks, and NO mark column. The marks appear only in',
  '           the exercise heading ("Troisième exercice (6 points)"). Common in chemistry',
  '           and physics.',
  '',
  'Both are valid and both must be read. On an ANSWERS-shaped scheme every `marks` is null;',
  'do NOT take a number out of the exercise heading, out of the remarks column, or out of the',
  'arithmetic inside an answer, and report it as a mark. A mark is a mark only by sitting in a',
  'mark column, and inventing one attaches an award to a row the examiner never awarded.',
  '',
  'Read it ROW BY ROW and return one entry per row.',
  '',
  'Rules:',
  '- Transcribe what is printed. Do not solve, correct, complete, extend or comment on it.',
  '- `exercise` is the EXERCISE this row belongs to — the number in the table\'s own heading,',
  '  printed as "Q 1", "Q1", "Exercise II", "التمرين الأول" and usually spanning the whole table.',
  '  Give the bare number ("1", "2", "3"). Every row of the same table shares it. This is NOT',
  '  the row\'s own number: in a table headed "Q 1" whose rows run 1, 2a, 2b, 3, every one of',
  '  those rows has exercise "1".',
  '- `label` is the row\'s own number within that exercise, exactly as printed ("1", "2a", "أ").',
  '  If a row continues the previous one and prints no number, repeat that number.',
  '- `answer` is the answer/criterion cell. Mathematics in LaTeX: inline $...$, display $$...$$.',
  '  Preserve fractions, integrals, vectors, subscripts and units exactly as printed.',
  '- `marks` is the number in the mark column for that row, or null if that cell is empty.',
  '  Never infer a mark that is not printed. Never distribute a mark across rows yourself.',
  '- Set `illegible` true if any part of the mark column or the numbering could not be read.',
  '- Set `pageIsScheme` false if this page is the question paper rather than a marking scheme.',
  '- Return rows only for what is on these pages. Do not carry over from a page you cannot see.',
].join('\n');

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * Scheme pages as PNGs.
 *
 * `paperPages` and `schemePages` partition the file — every record in
 * `exams.json` has `paperPages + schemePages === pages` — so the scheme is the
 * tail, and pdftoppm's page numbers are 1-based.
 */
async function renderSchemePages(pdf: string, paper: Paper): Promise<{ dir: string; files: string[] }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'bac2-scheme-'));
  const first = paper.paperPages + 1;
  const last = paper.paperPages + paper.schemePages;

  await run('pdftoppm', ['-png', '-r', String(DPI), '-f', String(first), '-l', String(last), pdf, path.join(dir, 'p')]);

  const files = (await readdir(dir)).filter((f) => f.endsWith('.png')).sort();
  return { dir, files };
}

async function imageOf(file: string): Promise<AiImage> {
  return toAiImage(await readFile(file), 'image/png');
}

/** Retries a call the provider said was worth retrying, and nothing else. */
async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      const retryable = err instanceof AiError && err.retryable;
      if (!retryable || attempt >= RETRIES) throw err;
      const wait = BACKOFF_MS[attempt] ?? BACKOFF_MS[BACKOFF_MS.length - 1]!;
      process.stderr.write(`      ${label}: ${(err as Error).message} — retrying in ${wait / 1000}s\n`);
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

/**
 * Which of the two shapes a Lebanese scheme is printed in.
 *
 *   marked   `Q | Short answers | M` — a mark column. The maths papers.
 *   answers  `Réponses attendues | Remarques` — expected answers and remarks,
 *            and NO per-row mark. The marks live only in the exercise header
 *            ("Troisième exercice (6 points)"). Common in chemistry and physics.
 */
export type SchemeShape = 'marked' | 'answers';

export type Verdict =
  | { ok: true; ratio: number; reason: string; shape: SchemeShape; dropExercises?: string[] }
  | { ok: false; reason: string };

/**
 * Does this reading agree with what the paper says about itself?
 *
 * Each exercise header states its own total. Compare the scheme's rows for that
 * exercise against it, and require every exercise on the paper to land on the
 * SAME ratio. One consistent ratio across several independent exercises is very
 * strong evidence both readings are right, including when the ratio is not 1 —
 * schemes on twice the paper's scale are real and common, and storing one raw
 * shows a student 2.5 marks for a question worth 1.25.
 *
 * A single disagreeing exercise fails the whole paper. A scheme that is right
 * about five exercises and wrong about one is not five-sixths of a barème; it is
 * a barème with an unknown wrong row in it, and there is no way from here to
 * tell which one.
 */
export function verify(rows: SchemeRow[], exercises: Exercise[]): Verdict {
  if (rows.length === 0) return { ok: false, reason: 'no rows' };
  if (rows.every((r) => !r.answer.trim())) return { ok: false, reason: 'no answer text in any row' };

  const stated = exercises.filter((e) => typeof e.marks === 'number' && e.marks > 0);
  if (stated.length === 0) return { ok: false, reason: 'paper states no exercise totals to check against' };

  /*
   * No exercise the scheme names may be absent from the paper.
   *
   * Applied to BOTH shapes and before anything else, because it is the one
   * check that does not depend on there being marks. A scheme claiming an
   * exercise 7 on a paper with three of them has been misread — most likely a
   * page of the question paper read as a scheme — and every row it produced is
   * suspect regardless of how well the numbers add up.
   */
  const paperKeys = new Set(stated.map((e, i) => exerciseOf(String(e.index ?? i + 1))));
  const schemeKeys = [...new Set(rows.map((r) => exerciseOf(r.exercise)))];
  const phantom = schemeKeys.filter((k) => !paperKeys.has(k));
  if (phantom.length > 0) {
    /*
     * Two very different faults wear the same symptom, and saying which is the
     * useful part.
     *
     * A Lebanese paper is marked out of twenty. If the exercises we parsed sum
     * to twenty and the scheme still names another one, the SCHEME is wrong —
     * most likely a page of the question paper read as a marking table.
     *
     * If they sum to well under twenty, the scheme is right and the PARSE is
     * short: `extract_exams.py` missed an exercise, and the scheme is what
     * reveals it. On gs/2004 2/chem_fr.pdf the parse found two exercises worth
     * 6.5 and 7.5, and the scheme printed "Troisième exercice (6 points)" —
     * 14 + 6 = 20, so the paper has three exercises and one was never
     * extracted. 150 of the 891 MVP papers total under 19.5, at a median of 7.
     *
     * Both are refused, because a scheme cannot be attached to questions that
     * do not exist. But the second is a question-extraction bug wearing a
     * scheme-reader's error message, and reporting it as one is how it gets
     * found rather than absorbed.
     */
    const parsedTotal = stated.reduce((a, e) => a + (e.marks as number), 0);
    const shortOfTwenty = parsedTotal < 19.5;
    return {
      ok: false,
      reason: shortOfTwenty
        ? `paper appears under-parsed: it totals ${parsedTotal}/20 and the scheme names exercise(s) ${phantom.join(', ')}`
        : `scheme names exercise(s) the paper does not have: ${phantom.join(', ')}`,
    };
  }

  const marked = rows.filter((r) => r.marks !== null && r.marks > 0);

  /*
   * --- The answers-only shape ---------------------------------------------
   *
   * A chemistry or physics scheme is often printed as two columns — the
   * expected answer and the examiner's remarks — with no mark column at all.
   * The exercise header carries the total and nothing subdivides it.
   *
   * The first cut of this gate required marks and so REFUSED every one of
   * those papers, discarding a complete set of official answers because they
   * arrived without a barème. That is the wrong trade twice over: the answers
   * are the scarcer half of what this corpus lacks, and in chemistry the
   * barèmes are already at 96% while the answers sit at 25%.
   *
   * There is no arithmetic to check here, so the check is structural: the
   * scheme must name no exercise the paper lacks (above) and must cover enough
   * of the ones it has. A two-row reading of a six-exercise paper is a scheme
   * the reader mostly failed at, whatever the rows say.
   *
   * These papers contribute their ANSWERS and no barème. `schemeFor` builds the
   * barème only from rows carrying marks, so an answers-only sidecar leaves the
   * paper's existing barème untouched rather than replacing it with nothing.
   */
  if (marked.length === 0) {
    const covered = schemeKeys.filter((k) => paperKeys.has(k)).length;
    if (covered / paperKeys.size < 0.5) {
      return {
        ok: false,
        reason: `answers-only scheme covers ${covered}/${paperKeys.size} exercises`,
      };
    }
    return {
      ok: true,
      ratio: 1,
      shape: 'answers',
      reason: `answers only, no mark column; ${covered}/${paperKeys.size} exercises covered`,
    };
  }

  // Group the scheme's rows by the exercise their label starts with. A label is
  // the paper's own, so "I.2" and "2-b" both begin with their exercise's mark.
  const ratios: { key: string; ratio: number }[] = [];
  for (const [i, exercise] of stated.entries()) {
    const key = String(exercise.index ?? i + 1);
    const mine = marked.filter((r) => exerciseOf(r.exercise) === key);
    if (mine.length === 0) continue;
    const sum = mine.reduce((a, r) => a + (r.marks ?? 0), 0);
    ratios.push({ key, ratio: sum / (exercise.marks as number) });
  }

  if (ratios.length === 0) return { ok: false, reason: 'no scheme row matched any exercise number' };
  if (ratios.length < 2 && stated.length > 1) {
    return { ok: false, reason: `only ${ratios.length} of ${stated.length} exercises matched a scheme row` };
  }

  /*
   * The ratio is decided by AGREEMENT, not by being a number we expected.
   *
   * The first cut only accepted 0.5, 1 and 2, and seven SE maths papers were
   * refused for landing — independently, across every exercise on each paper —
   * on 1.75. That is 35/20, a real scale this corpus uses, and rejecting it was
   * this tool asserting it knew the Lebanese mark scales better than seven
   * ministry papers agreeing with each other.
   *
   * Several exercises converging on ONE ratio is itself the evidence, and it is
   * strong: a misread mark column moves one exercise, not all of them by the
   * same factor. So with three or more exercises agreeing, any ratio inside a
   * sane band is accepted. With only two, the agreement is weak enough that the
   * known scales still have to vouch for it.
   */
  const grouped = new Map<string, { ratio: number; keys: string[] }>();
  for (const { key, ratio } of ratios) {
    const bucket = [...grouped.keys()].find((r) => Math.abs(Number(r) - ratio) < 0.02);
    if (bucket) grouped.get(bucket)!.keys.push(key);
    else grouped.set(String(ratio), { ratio, keys: [key] });
  }

  const best = [...grouped.values()].sort((a, b) => b.keys.length - a.keys.length)[0]!;
  const agreeing = best.keys.length;
  const SANE = best.ratio >= 0.4 && best.ratio <= 4;
  const KNOWN = [0.5, 1, 1.25, 1.5, 1.75, 2, 2.5, 3].some((r) => Math.abs(best.ratio - r) < 0.02);

  if (!SANE) return { ok: false, reason: `implausible scale ratio ${best.ratio.toFixed(2)}` };
  if (agreeing < 3 && !KNOWN) {
    return { ok: false, reason: `only ${agreeing} exercise(s) at an unrecognised scale ${best.ratio.toFixed(2)}` };
  }

  if (agreeing === ratios.length) {
    return {
      ok: true,
      ratio: best.ratio,
      shape: 'marked',
      reason: `${agreeing} exercises agree at x${best.ratio.toFixed(2)}`,
    };
  }

  /*
   * A minority of exercises disagree. Keep the majority, DROP the dissenters.
   *
   * The full maths run refused twenty papers on patterns like
   * `2.00 / 2.00 / 2.00 / 1.33 / 2.00 / 2.00` — five exercises agreeing and one
   * not. Discarding the paper threw away five correct exercises to avoid one
   * uncertain one, and the uncertain one is more often the PAPER's fault than
   * the scheme's: 520 exercises in this corpus are scored out of less than their
   * own header states, because parts shed their marks in text extraction.
   *
   * So the dissenting exercise's rows are dropped rather than stored, and the
   * rest are kept. Dropping is not the same as trusting: nothing uncertain gets
   * written, it simply stops taking the certain rows down with it. Requiring a
   * clear majority keeps this from becoming the path by which a badly-read
   * scheme gets in on the strength of two exercises that happen to match.
   */
  const dropped = ratios.filter((r) => !best.keys.includes(r.key)).map((r) => r.key);
  if (agreeing / ratios.length < 0.6 || agreeing < 2) {
    return {
      ok: false,
      reason: `exercises disagree on scale: ${ratios.map((r) => r.ratio.toFixed(2)).join(' / ')}`,
    };
  }

  return {
    ok: true,
    ratio: best.ratio,
    shape: 'marked',
    dropExercises: dropped,
    reason: `${agreeing}/${ratios.length} exercises agree at x${best.ratio.toFixed(2)}; dropped exercise ${dropped.join(', ')}`,
  };
}

/**
 * An exercise token reduced to its number.
 *
 * The scheme heads its tables every way a Lebanese paper does — "Q 1", "Q1",
 * "Exercise II", "التمرين الأول", or a bare "1". This normalises all of them to
 * the digit string `exams.json` uses for `exercise.index`, so the scheme's rows
 * and the paper's stated totals can be matched.
 *
 * Applied to the row's EXERCISE, never to its label. Reading the label instead
 * is what broke the first run: in the table headed "Q 1", the rows number
 * 1, 2a, 2b, 2c, 3, and taking those as exercise numbers scattered one
 * exercise's marks across five, producing ratios of 4.20 / 5.25 / 0.29.
 */
export function exerciseOf(token: string): string {
  const trimmed = token.trim();

  const arabicOrdinals: [string, number][] = [
    ['الأول', 1], ['الاول', 1], ['الثاني', 2], ['الثالث', 3],
    ['الرابع', 4], ['الخامس', 5], ['السادس', 6],
  ];
  for (const [word, value] of arabicOrdinals) {
    if (trimmed.includes(word)) return String(value);
  }

  const digit = trimmed.match(/(\d{1,2})/);
  if (digit) return digit[1]!;

  const roman = trimmed.match(/\b([IVX]+)\b/i);
  if (roman) return String(romanToInt(roman[1]!.toUpperCase()));

  return trimmed.slice(0, 3);
}

function romanToInt(s: string): number {
  const map: Record<string, number> = { I: 1, V: 5, X: 10 };
  let total = 0;
  for (let i = 0; i < s.length; i += 1) {
    const here = map[s[i]!] ?? 0;
    const next = map[s[i + 1]!] ?? 0;
    total += here < next ? -here : here;
  }
  return total;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

type Args = {
  dry: boolean;
  limit: number;
  subject: string | null;
  track: string | null;
  force: boolean;
  model: string | null;
  outDir: string;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    dry: false, limit: 0, subject: null, track: null, force: false, model: null, outDir: OUT_DIR,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--dry') args.dry = true;
    else if (token === '--force') args.force = true;
    else if (token === '--limit') args.limit = Number(argv[++i]);
    else if (token === '--subject') args.subject = String(argv[++i]);
    else if (token === '--track') args.track = String(argv[++i]);
    else if (token === '--model') args.model = String(argv[++i]);
    else if (token === '--cheap') args.model = env().OPENAI_MODEL_VERIFY;
    /*
     * A comparison run MUST NOT write over the run it is being compared to.
     * `--force` plus a shared directory would silently replace 129 papers read
     * at full price with the cheap model's version of them, and the comparison
     * would then be against itself. The same mistake retired a corpus once
     * through `compare_extract` writing `exams.json`; it has its own snapshot
     * directory now, and so does this.
     */
    else if (token === '--out-dir') args.outDir = path.resolve(String(argv[++i]));
  }
  return args;
}

const MVP = new Set(['maths', 'chemistry', 'physics', 'biology', 'economics', 'sociology']);

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const papers = JSON.parse(await readFile(EXAMS_JSON, 'utf8')) as Paper[];

  const worklist = papers.filter((p) => {
    if (p.error) return false;
    const subject = subjectOf(p.file);
    if (!subject || !MVP.has(subject)) return false;
    if (args.subject && subject !== args.subject) return false;
    if (args.track && p.track !== args.track) return false;
    // Only papers whose scheme pages were actually located. `schemeSuspected`
    // without a split says a scheme is in there somewhere, which is not enough
    // to point a renderer at.
    if (!(p.schemePages > 0)) return false;
    // Nothing to gain where the text path already recovered the answers.
    if (!args.force && p.answersFound > 0 && p.marksFound > 0) return false;
    // Already read on an earlier run. Re-reading costs a model call to produce
    // the file that is already sitting there, so a resumed run picks up where
    // the last one stopped rather than starting again — which matters when a
    // run can lose a fifth of its papers to rate limits and want re-running.
    if (!args.force && existsSync(path.join(args.outDir, `${p.sha256}.json`))) return false;
    return true;
  });

  const targets = args.limit > 0 ? worklist.slice(0, args.limit) : worklist;

  const bySubject: Record<string, number> = {};
  for (const p of worklist) {
    const s = subjectOf(p.file)!;
    bySubject[s] = (bySubject[s] ?? 0) + 1;
  }

  console.log('');
  console.log(`  papers in scope        ${worklist.length}`);
  console.log(`  scheme pages to render ${worklist.reduce((a, p) => a + p.schemePages, 0)}`);
  for (const [s, n] of Object.entries(bySubject).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${s.padEnd(12)} ${String(n).padStart(4)}`);
  }
  console.log(`  running on             ${targets.length}`);
  console.log('');

  if (args.dry) {
    for (const p of targets.slice(0, 20)) {
      console.log(`    ${p.path}  pages ${p.paperPages + 1}-${p.paperPages + p.schemePages}`);
    }
    return;
  }

  await mkdir(args.outDir, { recursive: true });

  let accepted = 0;
  let refused = 0;
  let done = 0;
  const shapes: Record<string, number> = { marked: 0, answers: 0 };
  const reasons: Record<string, number> = {};

  // Progress goes to stderr, which is unbuffered. On stdout it sits in a pipe
  // buffer until the process exits, so a long run looks identical to a hung one.
  const say = (line: string) => process.stderr.write(`${line}\n`);

  /*
   * Which model reads the pages, and why it is worth choosing.
   *
   * The default is the main model, because that is what the accuracy above was
   * measured with. But this is TRANSCRIPTION of a printed table, not judgement
   * about it: the prompt forbids inferring any mark that is not printed, and
   * correctness is settled afterwards by arithmetic that does not care which
   * model produced the rows. That is the profile a cheap model is good at, and
   * reading 770 papers of full-page images on the flagship is the single
   * largest avoidable cost in this repository.
   *
   * So `--cheap` exists, and it is falsifiable rather than assumed: run it over
   * papers already read at full price and compare the sidecars. If the marks
   * and labels match, the cheap model is correct here and the difference is
   * money for nothing.
   */
  const model = args.model ?? undefined;

  async function readOne(paper: Paper, i: number): Promise<void> {
    const pdf = path.join(EXAMS_DIR, paper.path);
    if (!existsSync(pdf)) {
      say(`  [${++done}/${targets.length}] ${paper.path}  MISSING FILE`);
      return;
    }

    let rendered: { dir: string; files: string[] } | null = null;
    try {
      rendered = await renderSchemePages(pdf, paper);
      const rows: SchemeRow[] = [];
      let illegible = false;

      for (let page = 0; page < rendered.files.length; page += PAGES_PER_CALL) {
        const batch = rendered.files.slice(page, page + PAGES_PER_CALL);
        const images = await Promise.all(batch.map((f) => imageOf(path.join(rendered!.dir, f))));

        const response = await withRetry(paper.path, () => ai().completeJson<SchemeRead>({
          system: SYSTEM,
          images,
          messages: [{ role: 'user', content: 'Read the marking scheme on these pages.' }],
          schema: ROW_SCHEMA as unknown as Record<string, unknown>,
          schemaName: 'marking_scheme',
          effort: EFFORT,
          maxTokens: 8_000,
          ...(model ? { model } : {}),
          parse: (value) => value as SchemeRead,
        }));

        if (!response.data.pageIsScheme) continue;
        if (response.data.illegible) illegible = true;
        rows.push(...response.data.rows);
      }

      const verdict = verify(rows, paper.exercises ?? []);
      if (!verdict.ok) {
        refused += 1;
        const key = verdict.reason.replace(/[\d.]+/g, 'N');
        reasons[key] = (reasons[key] ?? 0) + 1;
        say(`  [${++done}/${targets.length}] ${paper.path}  REFUSED — ${verdict.reason}`);
        return;
      }

      /*
       * The dissenting exercises' rows never reach the file.
       *
       * `verify` accepts a paper whose majority of exercises agree, but the
       * exercises it could not reconcile are exactly the ones whose marks are in
       * doubt, and a doubtful mark stored beside sound ones is indistinguishable
       * from them afterwards. Keeping the paper is worth doing; keeping the rows
       * that failed the check is not.
       */
      const dropped = new Set(verdict.dropExercises ?? []);
      const kept = dropped.size > 0 ? rows.filter((r) => !dropped.has(exerciseOf(r.exercise))) : rows;

      await writeFile(
        path.join(args.outDir, `${paper.sha256}.json`),
        JSON.stringify(
          {
            path: paper.path,
            sha256: paper.sha256,
            subject: subjectOf(paper.file),
            track: paper.track,
            readBy: 'vision',
            model: model ?? env().OPENAI_MODEL,
            shape: verdict.shape,
            scaleRatio: verdict.ratio,
            illegible,
            droppedExercises: verdict.dropExercises ?? [],
            rows: kept,
          },
          null,
          2,
        ),
        'utf8',
      );
      accepted += 1;
      shapes[verdict.shape] = (shapes[verdict.shape] ?? 0) + 1;
      say(
        `  [${++done}/${targets.length}] ${paper.path}  ${kept.length} rows — ${verdict.reason}${illegible ? ' (illegible regions)' : ''}`,
      );
    } catch (err) {
      refused += 1;
      const key = `error: ${(err as Error).message.slice(0, 60)}`;
      reasons[key] = (reasons[key] ?? 0) + 1;
      say(`  [${++done}/${targets.length}] ${paper.path}  ERROR — ${(err as Error).message}`);
    } finally {
      if (rendered) await rm(rendered.dir, { recursive: true, force: true });
    }
  }

  // A bounded pool: CONCURRENCY workers pulling from one shared cursor. Papers
  // differ several-fold in page count, so handing each worker a fixed slice
  // would leave most of them idle behind the one that drew the long papers.
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, targets.length) }, async () => {
      for (;;) {
        const i = cursor++;
        if (i >= targets.length) return;
        await readOne(targets[i]!, i);
      }
    }),
  );

  console.log('');
  console.log(`  accepted  ${accepted}`);
  console.log(`    with a mark column        ${shapes.marked}   (answers + barème)`);
  console.log(`    answers only, no marks    ${shapes.answers}   (answers; barème left as it was)`);
  console.log(`  refused   ${refused}`);
  for (const [reason, n] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(n).padStart(4)}  ${reason}`);
  }
  console.log('');
  console.log(`  sidecars in ${path.relative(process.cwd(), args.outDir)}`);
}

/**
 * Only run the CLI when this file IS the command.
 *
 * tests/scheme-gate.test.ts imports `verify` and `exerciseOf` from here for
 * their own sake. Unguarded, that import RAN the whole command: main() went
 * looking for a corpus that is not there under vitest, threw, and called
 * process.exit(1) — which vitest reports as an unhandled error and which failed
 * the entire suite no matter how many tests had passed. It looked like a broken
 * test rather than a module that starts a CLI when you import a function from
 * it.
 */
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
