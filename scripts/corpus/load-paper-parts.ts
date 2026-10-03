/**
 * corpus/.mapping/paper-parts.json -> questions.paper_parts, and the official
 * answer and barème of each exercise whose scheme matched part by part.
 *
 *   npm run corpus:paper-parts                                   report only
 *   npm run corpus:paper-parts -- --apply --confirm-db bac2      writes
 *   npm run corpus:paper-parts -- --restore <table> --confirm-db bac2
 *   --source <file>   read the parts from elsewhere (the VPS: ops-in/…)
 *   --measure         print how well stored rows match their parts, and others'
 *
 * `paper_parts.py` cut each exercise into its printed parts and bound each
 * part to the scheme row printed for it, by label, refusing any exercise whose
 * rows did not add up to the marks its header states. This stores the result.
 *
 * WHAT IT WRITES
 *
 *   paper_parts      every exercise the parts were found for, answered or not.
 *                    The paper page shows the parts; with no answers it falls
 *                    back to the exercise's old solution, as before.
 *   official_solution, official_solution_latex, bareme
 *                    ONLY where the scheme matched (answers.status = ok). The
 *                    stored solution was the scheme pages' text layer — the
 *                    three columns interleaved with the answer's own maths —
 *                    and the tutor and the marker read it. It is replaced by
 *                    the same rows, per part, in the ministry's own wording.
 *
 * Questions are found by the key load-exams.ts gives them,
 * sha256(`${subjectId}:${pdfSha256}:${exercise.index}:${order}`), tried for
 * every subject, so it runs unchanged on a database whose ids differ. Every
 * row it changes is copied to a backup table first; --restore puts it back.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { Prisma, PrismaClient } from '@prisma/client';

import { partMarkdown } from '../../src/lib/paper-parts';

import { renderProblem } from './render-gate';

const db = new PrismaClient();
const ROOT = process.cwd();
const SOURCE = path.join(ROOT, 'corpus/.mapping/paper-parts.json');
const ANSWER_CROPS = path.join(ROOT, 'corpus/science-answer-crops.json');
const OFFICIAL_ANSWER_CROPS = path.join(ROOT, 'corpus/official-answer-crops.json');
// Drawn answers (graphs, structural formulas) cut from GS key cells: crop_gs_key_cells.py.
const GS_KEY_CELL_CROPS = path.join(ROOT, 'corpus/gs-key-cell-crops.json');

type Part = { label: string; text: string; marks?: number; answer?: string };
type Exercise = {
  ordinal: number;
  /** The exercise's key as printed, where its rows could not be matched part by part. */
  wholeKey?: string;
  index: number;
  marks: number;
  status: string;
  intro?: string;
  /** A language paper's reading passage (lang_parts.py), shown first where the row has none of its own. */
  passage?: string;
  parts?: Part[];
  answers?: { status: string };
};
type Paper = { paper: string; sha256: string; subject: string; language: string; exercises: Exercise[] };
type AnswerCrop = { paper: string; index: number; label: string; image: string };

type Wanted = {
  paper: string;
  sha: string;
  index: number;
  parts: Prisma.InputJsonValue;
  /** The same parts with the passage on top, for a row that stores no passage. */
  partsWithPassage: Prisma.InputJsonValue | null;
  solution: string | null;
  bareme: Array<{ criterion: string; points: number }> | null;
};

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** The prose words of a text, LaTeX command names left out. */
function words(text: string | null): Set<string> {
  const plain = (text ?? '').replace(/\\[a-zA-Z]+/g, ' ').toLowerCase();
  return new Set(plain.match(/\p{L}{3,}/gu) ?? []);
}

/**
 * Share of a row's own words the parts must hold. See `recallOf`. Measured
 * locally (--measure): a row against its own exercise scores at least 0.76,
 * against another exercise of its paper at most 0.66.
 */
const MIN_RECALL = 0.7;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function confirmDatabase(): Promise<string> {
  const rows = await db.$queryRaw<Array<{ d: string }>>`SELECT current_database() AS d`;
  const database = rows[0]!.d;
  if (arg('confirm-db') !== database) {
    throw new Error(`refusing to write: connected to "${database}", --confirm-db says "${arg('confirm-db') ?? '(none)'}"`);
  }
  return database;
}

async function restore(table: string) {
  await confirmDatabase();
  if (!/^backup_paper_parts_\d{14}$/.test(table)) throw new Error(`not a backup table of this script: ${table}`);
  const n = await db.$executeRawUnsafe(`
    UPDATE questions q SET paper_parts = b.paper_parts, official_solution = b.official_solution,
           official_solution_latex = b.official_solution_latex, bareme = b.bareme
      FROM ${table} b WHERE b.id = q.id`);
  console.log(`restored ${n} row(s) from ${table}`);
}

/** The criterion a marker reads: the part's label and the start of its own words. */
function criterion(part: Part): string {
  const words = part.text.replace(/\s+/g, ' ').trim();
  return `${part.label} ${words}`.slice(0, 300);
}

const refused = { exercises: 0, answers: 0, examples: [] as string[], parts: [] as Array<{ paper: string; index: number; label: string }> };

/**
 * The page's own renderer has the last word. The parts are slices of text
 * that already passed this gate whole, so a slice failing means a cut landed
 * badly and the exercise keeps its single block; an answer failing loses only
 * that answer, and its part says so.
 */
function wantedFor(exercise: Exercise, run: string, paper: string, crops: Map<string, string>): Omit<Wanted, 'paper' | 'sha' | 'index'> | null {
  if (exercise.status !== 'split' || !exercise.parts?.length) return null;
  const textProblem =
    (exercise.intro?.trim() ? renderProblem(exercise.intro) : null) ??
    exercise.parts.map((p) => renderProblem(partMarkdown(p.text))).find(Boolean) ??
    null;
  if (textProblem) {
    refused.exercises += 1;
    if (refused.examples.length < 6) refused.examples.push(`${paper} #${exercise.index}: ${textProblem}`);
    return null;
  }
  const answered = exercise.answers?.status === 'ok';
  const parts = exercise.parts.map((p) => {
    let answer = answered && p.answer ? p.answer : undefined;
    if (answer && renderProblem(answer)) {
      refused.answers += 1;
      if (refused.examples.length < 6) refused.examples.push(`${paper} #${exercise.index} ${p.label}: ${renderProblem(answer)}`);
      refused.parts.push({ paper, index: exercise.index, label: p.label });
      answer = undefined;
    }
    return {
      label: p.label,
      text: p.text,
      ...(answered && typeof p.marks === 'number' ? { marks: p.marks } : {}),
      ...(answer ? { answer } : {}),
      ...(crops.get(`${paper}#${exercise.index}#${p.label}`) ? { answerImage: crops.get(`${paper}#${exercise.index}#${p.label}`) } : {}),
    };
  });
  const withAnswers = parts.filter((p) => p.answer);
  // Not matched part by part: the exercise's whole key, as the ministry printed
  // it, replaces the scraps the text layer had stored. The barème is left alone.
  const wholeKey = !answered && exercise.wholeKey && !renderProblem(exercise.wholeKey) ? exercise.wholeKey : null;
  const solution =
    answered && withAnswers.length
      ? withAnswers.map((p) => `**${p.label}**\n\n${p.answer}`).join('\n\n')
      : wholeKey;
  const bareme = answered
    ? exercise.parts.filter((p) => typeof p.marks === 'number').map((p) => ({ criterion: criterion(p), points: p.marks! }))
    : null;
  const passage = exercise.passage?.trim() && !renderProblem(exercise.passage) ? exercise.passage.trim() : '';
  return {
    parts: { intro: exercise.intro ?? '', parts, run } as Prisma.InputJsonValue,
    partsWithPassage: passage
      ? ({ intro: [passage, exercise.intro ?? ''].filter(Boolean).join('\n\n'), parts, run } as Prisma.InputJsonValue)
      : null,
    solution,
    bareme: bareme && bareme.length ? bareme : null,
  };
}

async function main() {
  const restoreFrom = arg('restore');
  if (restoreFrom) return restore(restoreFrom);
  const apply = process.argv.includes('--apply');
  const database = apply ? await confirmDatabase() : null;

  const raw = readFileSync(arg('source') ?? SOURCE, 'utf8');
  const run = sha256(raw).slice(0, 16);
  const papers = JSON.parse(raw) as Paper[];
  const crops = new Map<string, string>();
  for (const source of [ANSWER_CROPS, OFFICIAL_ANSWER_CROPS, GS_KEY_CELL_CROPS]) {
    if (!existsSync(source)) continue;
    for (const crop of JSON.parse(readFileSync(source, 'utf8')) as AnswerCrop[]) {
      if (/^\/answer-figures\/[a-z0-9][a-z0-9._-]*\.(?:png|jpe?g|webp)$/i.test(crop.image)) {
        crops.set(`${crop.paper}#${crop.index}#${crop.label}`, crop.image);
      }
    }
  }
  const subjects = await db.subject.findMany({ select: { id: true } });

  const wanted = new Map<string, Wanted>();
  const shownBy = new Map<string, Set<string>>(); // paper#index -> the words of its parts
  for (const p of papers) {
    for (const e of p.exercises) {
      const w = wantedFor(e, run, p.paper, crops);
      if (!w) continue;
      // The answers count too: gs/2011 2/eng.pdf's row stores its own key as
      // the exercise's text, and another exercise's key reads nothing like it.
      shownBy.set(
        `${p.sha256}#${e.index}`,
        words([e.passage ?? '', e.intro ?? '', ...(e.parts ?? []).flatMap((x) => [x.text, x.answer ?? ''])].join(' ')),
      );
      for (const s of subjects) {
        wanted.set(sha256(`${s.id}:${p.sha256}:${e.index}:${e.ordinal - 1}`), {
          paper: p.paper,
          sha: p.sha256,
          index: e.index,
          ...w,
        });
      }
    }
  }

  // In batches: every exercise is keyed once per subject, and one `IN` that
  // large is refused outright.
  const refs = [...wanted.keys()];
  const rows: Array<{
    id: string;
    sourceRef: string | null;
    verifiedStatus: string;
    paperParts: Prisma.JsonValue;
    officialSolution: string | null;
    contentText: string;
    sourcePassage: string | null;
    chapter: { subject: { name: string } };
  }> = [];
  for (let i = 0; i < refs.length; i += 5000) {
    rows.push(
      ...(await db.question.findMany({
        where: { sourceRef: { in: refs.slice(i, i + 5000) }, verifiedStatus: { not: 'rejected' } },
        select: {
          id: true,
          sourceRef: true,
          verifiedStatus: true,
          paperParts: true,
          officialSolution: true,
          contentText: true,
          sourcePassage: true,
          chapter: { select: { subject: { select: { name: true } } } },
        },
      })),
    );
  }

  /*
   * THE KEY IS NOT ENOUGH ON ITS OWN. A row is found by paper, exercise number
   * and position, and a database loaded from an older extraction can hold a
   * different exercise under the same key. So the row's own stored text must
   * read like the parts about to be written onto it — most of its words found
   * among theirs — or it is left alone and reported.
   */
  const recallOf = (r: (typeof rows)[number]) => {
    const w = wanted.get(r.sourceRef!)!;
    const stored = words(r.contentText);
    const shown = shownBy.get(`${w.sha}#${w.index}`)!;
    let hit = 0;
    for (const x of stored) if (shown.has(x)) hit += 1;
    return stored.size ? hit / stored.size : 0;
  };
  const mismatched = rows.filter((r) => recallOf(r) < MIN_RECALL);
  if (process.argv.includes('--measure')) {
    const own = rows.map(recallOf).sort((a, b) => a - b);
    console.log(`  stored-text recall, own exercise: min ${own[0]?.toFixed(2)}, 5th pct ${own[Math.floor(own.length * 0.05)]?.toFixed(2)}`);
    // The same rows against another exercise of their paper: what a wrong key would look like.
    const wrong: number[] = [];
    for (const r of rows) {
      const w = wanted.get(r.sourceRef!)!;
      const other = [...shownBy.keys()].find((k) => k.startsWith(`${w.sha}#`) && k !== `${w.sha}#${w.index}`);
      if (!other) continue;
      const stored = words(r.contentText);
      let hit = 0;
      for (const x of stored) if (shownBy.get(other)!.has(x)) hit += 1;
      wrong.push(stored.size ? hit / stored.size : 0);
    }
    wrong.sort((a, b) => a - b);
    console.log(`  stored-text recall, another exercise: max ${wrong.at(-1)?.toFixed(2)}, 95th pct ${wrong[Math.floor(wrong.length * 0.95)]?.toFixed(2)}`);
  }
  for (let i = rows.length - 1; i >= 0; i--) if (mismatched.includes(rows[i]!)) rows.splice(i, 1);

  // Postgres stores jsonb with its own key order, so the stored value is
  // compared with its keys sorted — and without `run`, which names the file
  // rather than the content.
  const canonical = (v: unknown): string =>
    JSON.stringify(v, (_, value: unknown) =>
      value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).sort(([x], [y]) => x.localeCompare(y)))
        : value,
    );
  const same = (a: Prisma.JsonValue, b: Prisma.InputJsonValue) =>
    a !== null && canonical({ ...(a as object), run: null }) === canonical({ ...(b as object), run: null });
  // A row that stores its reading passage already shows it above the parts.
  const partsFor = (r: (typeof rows)[number], w: Wanted) =>
    w.partsWithPassage && !r.sourcePassage?.trim() ? w.partsWithPassage : w.parts;
  const changes = rows.filter((r) => {
    const w = wanted.get(r.sourceRef!)!;
    return !same(r.paperParts, partsFor(r, w)) || (w.solution !== null && r.officialSolution !== w.solution);
  });

  const tally = new Map<string, { parts: number; answers: number }>();
  for (const r of rows) {
    const t = tally.get(r.chapter.subject.name) ?? { parts: 0, answers: 0 };
    t.parts += 1;
    if (wanted.get(r.sourceRef!)!.solution) t.answers += 1;
    tally.set(r.chapter.subject.name, t);
  }
  const exercises = new Set([...wanted.values()].map((w) => `${w.paper}#${w.index}`)).size;
  console.log(`  exercises split into parts     ${exercises}`);
  console.log(`  verified official-key crops    ${crops.size}`);
  console.log(`  questions found                ${rows.length}`);
  console.log(`  to write                       ${changes.length}`);
  console.log(`  left alone: stored text differs ${mismatched.length}`);
  for (const r of mismatched.slice(0, 5)) {
    const w = wanted.get(r.sourceRef!)!;
    console.log(`    ${w.paper} #${w.index}: ${r.contentText.replace(/\s+/g, ' ').slice(0, 60)}`);
  }
  console.log(`  refused by the page's renderer ${refused.exercises} exercise(s) kept whole, ${refused.answers} answer(s) dropped`);
  // The dropped answers, for crop_gs_key_cells.py to cut from the key page instead.
  const refusedOut = arg('refused-out');
  if (refusedOut) writeFileSync(refusedOut, JSON.stringify(refused.parts, null, 1));
  for (const e of refused.examples) console.log(`    ${e}`);
  console.log('  by subject (parts / with official answers per part):');
  for (const [k, v] of [...tally].sort((a, b) => b[1].parts - a[1].parts)) {
    console.log(`    ${String(v.parts).padStart(4)} / ${String(v.answers).padStart(4)}  ${k}`);
  }

  if (!apply) {
    console.log('\n  report only — pass --apply --confirm-db <database> to write.');
    return;
  }
  if (!changes.length) return;

  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  const table = `backup_paper_parts_${stamp}`;
  await db.$executeRawUnsafe(
    `CREATE TABLE ${table} AS
       SELECT id, paper_parts, official_solution, official_solution_latex, bareme
         FROM questions WHERE id = ANY($1::uuid[])`,
    changes.map((c) => c.id),
  );
  for (const c of changes) {
    const w = wanted.get(c.sourceRef!)!;
    await db.question.update({
      where: { id: c.id },
      data: {
        paperParts: partsFor(c, w),
        ...(w.solution !== null
          ? {
              officialSolution: w.solution,
              officialSolutionLatex: w.solution,
              ...(w.bareme ? { bareme: w.bareme } : {}),
            }
          : {}),
      },
    });
  }
  console.log(`\n  ${changes.length} question(s) written on ${database}; backup in ${table}.`);
  console.log(`  undo:  npm run corpus:paper-parts -- --restore ${table} --confirm-db ${database}`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
