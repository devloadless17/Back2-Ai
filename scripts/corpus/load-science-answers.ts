/**
 * corpus/science-answers.json -> questions.official_solution, for the science papers.
 *
 *   npm run corpus:science-answers                                   report only
 *   npm run corpus:science-answers -- --apply --confirm-db bac2      writes
 *   npm run corpus:science-answers -- --restore <table> --confirm-db bac2
 *
 * attach_science_answers.py matched each sub-question to its lines in the
 * paper's official answer key. This stores them on the question, the way
 * load-exams.ts builds an official solution ("<label> <answer>" per part), so
 * the tutor explains the ministry's answer and the marker compares against it.
 *
 * FILLS, NEVER REPLACES. A question is written only when its official solution
 * is missing or is extraction debris shorter than 80 characters ("1 Exercise",
 * "1 1/2" — what most LS biology rows held). A real solution already there,
 * from any other loader, is left alone.
 *
 * Questions are found by the key load-exams.ts gives them:
 * sha256(`${subjectId}:${pdfSha256}:${exercise.index}:${order}`), tried for
 * every subject, so it runs unchanged on a database whose ids differ.
 * Before writing, the rows it changes are copied to a backup table; --restore
 * puts the old values back.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();
const ROOT = process.cwd();
const ANSWERS = path.join(ROOT, 'corpus/science-answers.json');
const JUNK_BELOW = 80;

type Paper = {
  paper: string;
  sha256: string;
  exercises: Array<{ order: number; index: number; parts: Array<{ label: string; answer: string | null }> }>;
};

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

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
  if (!/^backup_science_answers_\d{14}$/.test(table)) throw new Error(`not a backup table of this script: ${table}`);
  const n = await db.$executeRawUnsafe(`
    UPDATE questions q SET official_solution = b.official_solution, official_solution_latex = b.official_solution_latex
      FROM ${table} b WHERE b.id = q.id`);
  console.log(`restored ${n} row(s) from ${table}`);
}

async function main() {
  const restoreFrom = arg('restore');
  if (restoreFrom) return restore(restoreFrom);
  const apply = process.argv.includes('--apply');
  const database = apply ? await confirmDatabase() : null;

  const papers = JSON.parse(readFileSync(ANSWERS, 'utf8')) as Paper[];
  const subjects = await db.subject.findMany({ select: { id: true } });

  // sourceRef -> the solution text for that exercise
  const wanted = new Map<string, string>();
  for (const p of papers) {
    for (const e of p.exercises) {
      const answered = e.parts.filter((pt) => pt.answer && pt.answer.trim());
      if (!answered.length) continue;
      const text = answered.map((pt) => `${pt.label} ${pt.answer}`.trim()).join('\n\n');
      for (const s of subjects) wanted.set(sha256(`${s.id}:${p.sha256}:${e.index}:${e.order}`), text);
    }
  }

  // In batches: every exercise is keyed once per subject, and one `IN` that
  // large is refused outright. Rejected rows are filtered here, not in the query.
  const refs = [...wanted.keys()];
  const rows: Array<{ id: string; sourceRef: string | null; officialSolution: string | null; verifiedStatus: string; chapter: { subject: { name: string } } }> = [];
  for (let i = 0; i < refs.length; i += 5000) {
    rows.push(
      ...(await db.question.findMany({
        where: { sourceRef: { in: refs.slice(i, i + 5000) } },
        select: { id: true, sourceRef: true, officialSolution: true, verifiedStatus: true, chapter: { select: { subject: { select: { name: true } } } } },
      })),
    );
  }
  for (let i = rows.length - 1; i >= 0; i--) if (rows[i]!.verifiedStatus === 'rejected') rows.splice(i, 1);

  const changes = rows.filter((r) => (r.officialSolution ?? '').trim().length < JUNK_BELOW);
  const bySubject = new Map<string, number>();
  for (const r of changes) bySubject.set(r.chapter.subject.name, (bySubject.get(r.chapter.subject.name) ?? 0) + 1);

  console.log(`  exercises with answers   ${wanted.size / Math.max(1, subjects.length)}`);
  console.log(`  questions found          ${rows.length}`);
  console.log(`  to fill (empty or junk)  ${changes.length}`);
  console.log(`  kept (real solution)     ${rows.length - changes.length}`);
  for (const [k, v] of [...bySubject].sort((a, b) => b[1] - a[1])) console.log(`    ${String(v).padStart(4)}  ${k}`);

  if (!apply) {
    console.log('\n  report only — pass --apply --confirm-db <database> to write.');
    return;
  }
  if (!changes.length) return;

  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  const table = `backup_science_answers_${stamp}`;
  await db.$executeRawUnsafe(
    `CREATE TABLE ${table} AS SELECT id, official_solution, official_solution_latex FROM questions WHERE id = ANY($1::uuid[])`,
    changes.map((c) => c.id),
  );
  for (const c of changes) {
    const text = wanted.get(c.sourceRef!)!;
    await db.question.update({ where: { id: c.id }, data: { officialSolution: text, officialSolutionLatex: text } });
  }
  console.log(`\n  ${changes.length} question(s) filled on ${database}; backup in ${table}.`);
  console.log(`  undo:  npm run corpus:science-answers -- --restore ${table} --confirm-db ${database}`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
