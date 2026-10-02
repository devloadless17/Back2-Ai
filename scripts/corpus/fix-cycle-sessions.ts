/**
 * Move questions to the session their paper was actually sat in.
 *
 *   npm run corpus:fix-sessions -- --track GS                          report only
 *   npm run corpus:fix-sessions -- --track GS --apply --confirm-db bac2
 *   npm run corpus:fix-sessions -- --restore <table> --confirm-db bac2
 *
 * load-exams.ts read a folder named by the year alone ("gs/2019") as session 1,
 * so 2019's exceptional session was filed into the ordinary session's papers:
 * "Physics GS 2019 — session 1" held both exams. `exam-session.ts` now says
 * which session such a folder is; this moves the rows already loaded into the
 * right cycle, creating it where it does not exist yet.
 *
 * Rows are found by the key load-exams.ts gives them, from both extraction
 * files. Each moved row's old cycle is recorded in a backup table, and so is
 * each cycle this creates; --restore moves the rows back and removes those
 * cycles once they are empty.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { PrismaClient } from '@prisma/client';

import { sessionOf } from './exam-session';

const db = new PrismaClient();
// The extraction files, from corpus/ or from --exams-dir (the VPS: ops-in/…).
const FILES = ['exams.json', 'exams-arabic.json'];

type Exam = { path: string; sha256: string; track: string; session: string; exercises: Array<{ index: number }> };

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
  if (!/^backup_cycle_sessions_\d{14}$/.test(table)) throw new Error(`not a backup table of this script: ${table}`);
  const moved = await db.$executeRawUnsafe(
    `UPDATE questions q SET source_exam_id = b.source_exam_id FROM ${table} b WHERE b.id = q.id`,
  );
  const removed = await db.$executeRawUnsafe(`
    DELETE FROM exam_cycles c USING ${table}_cycles n
     WHERE c.id = n.id
       AND NOT EXISTS (SELECT 1 FROM questions q WHERE q.source_exam_id = c.id)
       AND NOT EXISTS (SELECT 1 FROM exam_simulations s WHERE s.exam_cycle_id = c.id)`);
  console.log(`moved ${moved} row(s) back; removed ${removed} empty cycle(s) this script created`);
}

async function main() {
  const restoreFrom = arg('restore');
  if (restoreFrom) return restore(restoreFrom);
  const track = arg('track');
  const apply = process.argv.includes('--apply');
  const database = apply ? await confirmDatabase() : null;

  // ref -> the session its paper says
  const want = new Map<string, { session: string; paper: string }>();
  const subjects = await db.subject.findMany({ select: { id: true } });
  const dir = path.resolve(process.cwd(), arg('exams-dir') ?? 'corpus');
  for (const file of FILES.map((f) => path.join(dir, f)).filter((f) => existsSync(f))) {
    for (const e of JSON.parse(readFileSync(file, 'utf8')) as Exam[]) {
      if (track && e.track.toUpperCase() !== track.toUpperCase()) continue;
      const session = sessionOf(e.session, e.track);
      // Only papers whose folder needed the table: everything else was filed right.
      if (session === sessionOf(e.session)) continue;
      for (const [order, ex] of e.exercises.entries()) {
        for (const s of subjects) {
          want.set(sha256(`${s.id}:${e.sha256}:${ex.index}:${order}`), { session, paper: e.path });
        }
      }
    }
  }

  const keys = [...want.keys()];
  const rows: Array<{
    id: string;
    sourceRef: string | null;
    sourceExam: {
      id: string;
      subjectId: string;
      year: number;
      session: string | null;
      language: 'ar' | 'fr' | 'en';
      title: string;
      durationMinutes: number;
      durationIsOfficial: boolean;
    } | null;
  }> = [];
  for (let i = 0; i < keys.length; i += 5000) {
    rows.push(
      ...(await db.question.findMany({
        where: { sourceRef: { in: keys.slice(i, i + 5000) } },
        select: {
          id: true,
          sourceRef: true,
          sourceExam: {
            select: {
              id: true, subjectId: true, year: true, session: true, language: true,
              title: true, durationMinutes: true, durationIsOfficial: true,
            },
          },
        },
      })),
    );
  }
  const misfiled = rows.filter((r) => r.sourceExam && r.sourceExam.session !== want.get(r.sourceRef!)!.session);
  const byCycle = new Map<string, number>();
  for (const r of misfiled) byCycle.set(r.sourceExam!.title, (byCycle.get(r.sourceExam!.title) ?? 0) + 1);

  console.log(`  rows from year-only folders   ${rows.length}`);
  console.log(`  filed in the wrong session    ${misfiled.length}`);
  for (const [t, n] of [...byCycle].sort()) console.log(`    ${String(n).padStart(3)}  ${t}`);

  if (!apply) {
    console.log('\n  report only — pass --apply --confirm-db <database> to write.');
    return;
  }
  if (!misfiled.length) return;

  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  const table = `backup_cycle_sessions_${stamp}`;
  await db.$executeRawUnsafe(
    `CREATE TABLE ${table} AS SELECT id, source_exam_id FROM questions WHERE id = ANY($1::uuid[])`,
    misfiled.map((r) => r.id),
  );
  await db.$executeRawUnsafe(`CREATE TABLE ${table}_cycles (id uuid PRIMARY KEY)`);

  const target = new Map<string, string>();
  for (const r of misfiled) {
    const old = r.sourceExam!;
    const session = want.get(r.sourceRef!)!.session;
    const key = `${old.subjectId}:${old.year}:${session}:${old.language}`;
    if (!target.has(key)) {
      const existing = await db.examCycle.findUnique({
        where: { subjectId_year_session_language: { subjectId: old.subjectId, year: old.year, session, language: old.language } },
        select: { id: true },
      });
      const cycle =
        existing ??
        (await db.examCycle.create({
          data: {
            subjectId: old.subjectId,
            year: old.year,
            session,
            language: old.language,
            title: old.title.replace(/session \d$/, session === 'session2' ? 'session 2' : 'session 1'),
            durationMinutes: old.durationMinutes,
            durationIsOfficial: old.durationIsOfficial,
          },
          select: { id: true },
        }));
      if (!existing) await db.$executeRawUnsafe(`INSERT INTO ${table}_cycles (id) VALUES ($1::uuid)`, cycle.id);
      target.set(key, cycle.id);
    }
    await db.question.update({ where: { id: r.id }, data: { sourceExamId: target.get(key)! } });
  }
  console.log(`\n  ${misfiled.length} question(s) moved on ${database}; backup in ${table}.`);
  console.log(`  undo:  npm run corpus:fix-sessions -- --restore ${table} --confirm-db ${database}`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
