/**
 * Does this question have its own answer key printed inside it?
 *
 *   npm run detect:schemes -- --language ar --limit 40      # report only
 *   npm run detect:schemes -- --subject Francais --apply    # write the cuts
 *   npm run detect:schemes -- --ids-file path/to/ids.txt
 *
 * WHY THIS EXISTS AND `detect --data` DOES NOT COVER IT.
 *
 * The pattern in `extract_exams.py` finds a scheme by its header — أسس تصحيح,
 * معيار التصحيح, barème, marking scheme. That found and fixed 337 questions on
 * 2026-08-26 and cannot find the rest, for two reasons that no wider regex
 * fixes:
 *
 *   - Plenty of schemes never announce themselves. They simply start awarding
 *     marks. gs/2019/math_en.pdf opens its key on "A3b" with no header in the
 *     file at all.
 *   - OCR corrupts the header words themselves. A Geography scheme reading
 *     "4/1 علامة نطبيعة انمستند" — ¼ mark for the nature of the document — is a
 *     marking scheme beyond argument, and every pattern spelling العلامة
 *     correctly is blind to it, because the scan turned ل into ن.
 *
 * The remaining signal is the mark column, and it is unusable as a cut: 72% of
 * the questions carrying one are maths and physics, where PDF extraction
 * shatters f_n(x) into lines reading "1", "e1", "2e", "nx". Cutting on it cost
 * 683 sub-questions the last time it was tried.
 *
 * "Is this a question or is it the answer to one" is a judgement about meaning,
 * not about spelling, and it survives the OCR damage that defeats the patterns.
 *
 * THE MODEL NEVER REWRITES THE QUESTION.
 *
 * It returns an ANCHOR: the first line of the scheme, copied out of the input.
 * This file then finds that anchor in the original text and cuts there. If the
 * anchor does not appear verbatim the result is refused and counted, because a
 * model that paraphrased the anchor may equally have imagined the scheme. The
 * cut is therefore always made by string search over the stored text, and the
 * worst a wrong answer can do is refuse a real scheme — never invent a question
 * or truncate one at a boundary that does not exist.
 *
 * Reports by default. `--apply` writes, and nulls the embedding of every row it
 * changes, which is what `load-exams.ts` does for the same reason: a vector
 * computed from question-plus-answer describes neither.
 */

import { readFileSync } from 'node:fs';

import { ai } from '@/lib/ai';
import { db } from '@/lib/db';

const argv = process.argv.slice(2);
const arg = (name: string) => {
  const i = argv.indexOf(name);
  return i === -1 ? null : argv[i + 1] ?? null;
};
const APPLY = argv.includes('--apply');
// One model call per question. Capped by default; --limit 0 for everything.
const LIMIT = argv.includes('--limit') ? Number(arg('--limit')) : 40;
const LANGUAGE = arg('--language');
const SUBJECT = arg('--subject');
const IDS_FILE = arg('--ids-file');
const CONCURRENCY = Number(arg('--concurrency')) || 4;

/** Below this the statement is not an exercise; above it a cut leaves something. */
const MIN_KEEP = 40;

type Verdict = {
  verdict: 'clean' | 'ends_with_scheme' | 'entirely_scheme';
  anchor: string | null;
  reason: string;
};

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'anchor', 'reason'],
  properties: {
    verdict: {
      type: 'string',
      enum: ['clean', 'ends_with_scheme', 'entirely_scheme'],
      description:
        'clean: the text is only the question. ends_with_scheme: a real question, then the answer key. entirely_scheme: no question at all, it is a marking scheme.',
    },
    anchor: {
      type: ['string', 'null'],
      description:
        'For ends_with_scheme ONLY: the first 30-60 characters of the answer key, copied EXACTLY from the input including any misspellings. Null otherwise.',
    },
    reason: { type: 'string', description: 'One short sentence of justification.' },
  },
} as const;

const SYSTEM = [
  'You are auditing questions extracted from Lebanese Baccalaureate exam papers.',
  'A paper and its official marking scheme are often in one PDF, and the splitter',
  'sometimes leaves the scheme attached to the question. Your job is to say whether',
  'that happened here.',
  '',
  'A MARKING SCHEME is the examiner-facing answer key. It reads as answers rather',
  'than as instructions, and it usually awards marks: "¼ mark for the nature of the',
  'document", "Introduction (2 marks)", "Q.I Answers 6.25 pts", a table of',
  'question / expected answer / mark, or instructions addressed to correcting',
  'teachers.',
  '',
  'A QUESTION is addressed to the candidate. It asks, instructs or sets a problem:',
  '"Explain this judgement", "Calculate the limit", "Correct the following',
  'statements". Marks printed beside a question — "(9 marks)" — are the paper',
  'telling the candidate what the part is worth. THAT IS NOT A SCHEME.',
  '',
  'Be careful with these, which are NOT schemes:',
  '- an imperative to correct something ("corriger les phrases fausses")',
  '- data the candidate needs: tables of values, constants, document extracts',
  '- bare numbers left by broken mathematical notation',
  '- a question that quotes or numbers its own parts',
  '',
  'The text is OCR output and is often badly damaged, with letters substituted',
  'and words broken. Judge by meaning, not by spelling. If a heading is garbled',
  'but plainly means "marking criteria", treat it as one.',
  '',
  'If you report ends_with_scheme you MUST return an anchor copied byte-for-byte',
  'from the input, including its OCR damage. Do not correct it, do not translate',
  'it, do not paraphrase it. If you cannot copy it exactly, answer clean.',
].join('\n');

function parse(value: unknown): Verdict {
  const v = value as Verdict;
  if (!v || typeof v !== 'object') throw new Error('not an object');
  if (!['clean', 'ends_with_scheme', 'entirely_scheme'].includes(v.verdict)) {
    throw new Error(`bad verdict ${v.verdict}`);
  }
  return { verdict: v.verdict, anchor: v.anchor ?? null, reason: String(v.reason ?? '') };
}

type Row = { id: string; subject: string; text: string };

async function pick(): Promise<Row[]> {
  if (IDS_FILE) {
    const ids = readFileSync(IDS_FILE, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);
    return db.$queryRaw<Row[]>`
      SELECT q.id, s.name AS subject, q.content_text AS text
        FROM questions q JOIN chapters c ON c.id = q.chapter_id
        JOIN subjects s ON s.id = c.subject_id
       WHERE q.id = ANY(${ids}::uuid[]) AND q.verified_status <> 'rejected'`;
  }
  const rows = await db.$queryRaw<Row[]>`
    SELECT q.id, s.name AS subject, q.content_text AS text
      FROM questions q JOIN chapters c ON c.id = q.chapter_id
      JOIN subjects s ON s.id = c.subject_id
     WHERE q.verified_status <> 'rejected'
       AND (${LANGUAGE}::text IS NULL OR s.language::text = ${LANGUAGE})
       AND (${SUBJECT}::text IS NULL OR s.name = ${SUBJECT})
     ORDER BY q.id`;
  return LIMIT > 0 ? rows.slice(0, LIMIT) : rows;
}

async function judge(row: Row): Promise<{ row: Row; v: Verdict } | null> {
  try {
    const { data } = await ai().completeJson<Verdict>({
      system: SYSTEM,
      messages: [{ role: 'user', content: row.text.slice(0, 12000) }],
      schema: SCHEMA as unknown as Record<string, unknown>,
      schemaName: 'scheme_verdict',
      parse,
      /*
       * Generous because this budget covers the model's reasoning as well as
       * the JSON. At 400 it ran out mid-object on four of ten first-run rows
       * and those were reported as errors — a silent under-count of schemes,
       * which is the direction that matters here.
       */
      maxTokens: 3000,
    });
    return { row, v: data };
  } catch (err) {
    console.error(`  ! ${row.id}: ${(err as Error).message}`);
    return null;
  }
}

async function main() {
  if (!ai().isConfigured()) {
    console.error('No AI provider configured. Set the API key for AI_PROVIDER in .env.');
    process.exit(1);
  }

  const rows = await pick();
  console.log(`\nJudging ${rows.length} question(s) with ${ai().defaultModel}…\n`);

  const results: { row: Row; v: Verdict }[] = [];
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const batch = await Promise.all(rows.slice(i, i + CONCURRENCY).map(judge));
    results.push(...batch.filter((r): r is { row: Row; v: Verdict } => r !== null));
    process.stdout.write(`\r  ${Math.min(i + CONCURRENCY, rows.length)}/${rows.length}`);
  }
  console.log('\n');

  const clean = results.filter((r) => r.v.verdict === 'clean');
  const whole = results.filter((r) => r.v.verdict === 'entirely_scheme');
  const partial = results.filter((r) => r.v.verdict === 'ends_with_scheme');

  /*
   * The hallucination gate. An anchor that is not in the text verbatim means
   * the model wrote it rather than found it, and nothing it said about this
   * row can be trusted enough to cut on.
   */
  const cuts: { row: Row; at: number; anchor: string }[] = [];
  const unanchored: { row: Row; v: Verdict }[] = [];
  for (const r of partial) {
    const a = (r.v.anchor ?? '').trim();
    const at = a.length >= 8 ? r.row.text.indexOf(a) : -1;
    if (at < MIN_KEEP) unanchored.push(r);
    else cuts.push({ row: r.row, at, anchor: a });
  }

  console.log(`  clean                        ${clean.length}`);
  console.log(`  entirely a scheme (retire)   ${whole.length}`);
  console.log(`  question + scheme (truncate) ${cuts.length}`);
  console.log(`  REFUSED — anchor not found verbatim, or too early  ${unanchored.length}`);

  const bySubject = new Map<string, number>();
  for (const c of [...cuts.map((c) => c.row), ...whole.map((w) => w.row)]) {
    bySubject.set(c.subject, (bySubject.get(c.subject) ?? 0) + 1);
  }
  if (bySubject.size) {
    console.log('\n  by subject:');
    for (const [s, n] of [...bySubject.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${s.padEnd(24)} ${n}`);
    }
  }

  console.log('\n  --- what would be cut ---');
  for (const c of cuts.slice(0, 12)) {
    console.log(`    ${c.row.subject} | keep ${c.at} of ${c.row.text.length} | cut at: ${c.anchor.slice(0, 60)}`);
  }
  for (const w of whole.slice(0, 8)) {
    console.log(`    RETIRE ${w.row.subject} | ${w.v.reason.slice(0, 80)}`);
  }

  if (!APPLY) {
    console.log('\nReport only. Re-run with --apply to write.\n');
    await db.$disconnect();
    return;
  }

  let truncated = 0;
  for (const c of cuts) {
    const next = c.row.text.slice(0, c.at).trimEnd();
    if (next.length < MIN_KEEP) continue;
    await db.$executeRaw`
      UPDATE questions SET content_text = ${next}, embedding = NULL WHERE id = ${c.row.id}::uuid`;
    truncated += 1;
  }
  let retired = 0;
  for (const w of whole) {
    await db.$executeRaw`
      UPDATE questions SET verified_status = 'rejected' WHERE id = ${w.row.id}::uuid`;
    retired += 1;
  }
  console.log(`\nApplied: ${truncated} truncated, ${retired} retired.`);
  console.log('Embeddings nulled on the truncated rows — run `npm run ingest -- --embed-missing`.\n');
  await db.$disconnect();
}

main();
