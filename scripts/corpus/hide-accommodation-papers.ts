/**
 * Hide the accommodation papers: the adapted editions set for candidates with
 * special needs (ehteyejet, makfufin, mu5tasa…).
 *
 *   npm run corpus:hide-accommodation -- --track GS                          report only
 *   npm run corpus:hide-accommodation -- --track GS --apply --confirm-db bac2
 *   npm run corpus:hide-accommodation -- --restore <table> --confirm-db bac2
 *
 * An accommodation paper is a separate exam, with its own exercises, sat in
 * the same session. load-exams.ts filed it into the same cycle as the ordinary
 * paper, so a student opening "Physics GS 2019 — session 1" read seven
 * exercises from two different exams. The product shows the ordinary papers
 * only (the user's decision, 2026-10-02), and load-exams.ts now skips these
 * files, so a later full load retires them as well.
 *
 * Hidden, not deleted: `verified_status = 'rejected'` is what every surface
 * already filters on, and deleting would cascade to students' attempts. Rows
 * are found by the key load-exams.ts gives them, from both extraction files.
 * Every row it changes is recorded in a backup table; --restore undoes it.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { PrismaClient } from '@prisma/client';

import { ACCOMMODATION } from './accommodation';

const db = new PrismaClient();
const FILES = ['corpus/exams.json', 'corpus/exams-arabic.json'];

type Exam = { path: string; sha256: string; track: string; exercises: Array<{ index: number }> };

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
  if (!/^backup_accommodation_\d{14}$/.test(table)) throw new Error(`not a backup table of this script: ${table}`);
  const n = await db.$executeRawUnsafe(
    `UPDATE questions q SET verified_status = b.verified_status FROM ${table} b WHERE b.id = q.id`,
  );
  console.log(`restored ${n} row(s) from ${table}`);
}

async function main() {
  const restoreFrom = arg('restore');
  if (restoreFrom) return restore(restoreFrom);
  const track = arg('track');
  const apply = process.argv.includes('--apply');
  const database = apply ? await confirmDatabase() : null;

  const papers: Exam[] = [];
  for (const file of FILES) {
    for (const e of JSON.parse(readFileSync(path.join(process.cwd(), file), 'utf8')) as Exam[]) {
      const name = path.basename(e.path.replace(/\\/g, '/'));
      if (!ACCOMMODATION.test(name)) continue;
      if (track && e.track.toUpperCase() !== track.toUpperCase()) continue;
      papers.push(e);
    }
  }
  const subjects = await db.subject.findMany({ select: { id: true } });
  const refs = new Map<string, string>();
  for (const p of papers) {
    for (const [order, ex] of p.exercises.entries()) {
      for (const s of subjects) refs.set(sha256(`${s.id}:${p.sha256}:${ex.index}:${order}`), p.path);
    }
  }
  const keys = [...refs.keys()];
  const rows: Array<{ id: string; sourceRef: string | null; verifiedStatus: string }> = [];
  for (let i = 0; i < keys.length; i += 5000) {
    rows.push(
      ...(await db.question.findMany({
        where: { sourceRef: { in: keys.slice(i, i + 5000) } },
        select: { id: true, sourceRef: true, verifiedStatus: true },
      })),
    );
  }
  const visible = rows.filter((r) => r.verifiedStatus !== 'rejected');
  const byPaper = new Map<string, number>();
  for (const r of visible) byPaper.set(refs.get(r.sourceRef!)!, (byPaper.get(refs.get(r.sourceRef!)!) ?? 0) + 1);

  console.log(`  accommodation papers          ${papers.length}${track ? ` (${track})` : ''}`);
  console.log(`  their rows in the database    ${rows.length}`);
  console.log(`  still shown to students       ${visible.length}`);
  for (const [p, n] of [...byPaper].sort()) console.log(`    ${String(n).padStart(3)}  ${p}`);

  if (!apply) {
    console.log('\n  report only — pass --apply --confirm-db <database> to write.');
    return;
  }
  if (!visible.length) return;
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  const table = `backup_accommodation_${stamp}`;
  await db.$executeRawUnsafe(
    `CREATE TABLE ${table} AS SELECT id, verified_status FROM questions WHERE id = ANY($1::uuid[])`,
    visible.map((r) => r.id),
  );
  await db.question.updateMany({ where: { id: { in: visible.map((r) => r.id) } }, data: { verifiedStatus: 'rejected' } });
  console.log(`\n  ${visible.length} question(s) hidden on ${database}; backup in ${table}.`);
  console.log(`  undo:  npm run corpus:hide-accommodation -- --restore ${table} --confirm-db ${database}`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
