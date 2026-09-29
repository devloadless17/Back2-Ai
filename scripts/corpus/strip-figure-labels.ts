/**
 * Remove figure labels read into science questions as text ("S / Laser / x / O / Doc. 7").
 *
 *   npm run corpus:strip-labels                                  report only, with examples
 *   npm run corpus:strip-labels -- --apply --confirm-db bac2     writes
 *   npm run corpus:strip-labels -- --restore <table> --confirm-db bac2
 *
 * Only questions a student sees in their raw text layer: science subjects
 * whose content_latex is empty (the Mathpix display text is used wherever it
 * exists, and it does not carry these runs). The rule is figure-label-debris.ts:
 * runs of four or more tiny label lines, nothing else. Backup table first; a
 * changed row's embedding is cleared for `ingest --embed-missing`.
 */

import { PrismaClient } from '@prisma/client';

import { stripLabelRuns } from './figure-label-debris';

const db = new PrismaClient();
const SCIENCE = ['Life Sciences', 'Sciences de la vie', 'Physics', 'Physique', 'Chemistry', 'Chimie', 'Mathematics', 'Mathematiques'];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function confirmDatabase(): Promise<string> {
  const rows = await db.$queryRaw<Array<{ d: string }>>`SELECT current_database() AS d`;
  const database = rows[0]!.d;
  if (arg('confirm-db') !== database) throw new Error(`refusing to write: connected to "${database}", --confirm-db says "${arg('confirm-db') ?? '(none)'}"`);
  return database;
}

async function main() {
  const restoreFrom = arg('restore');
  if (restoreFrom) {
    await confirmDatabase();
    if (!/^backup_figure_labels_\d{14}$/.test(restoreFrom)) throw new Error('not a backup table of this script');
    const n = await db.$executeRawUnsafe(`UPDATE questions q SET content_text = b.content_text, embedding = NULL FROM ${restoreFrom} b WHERE b.id = q.id`);
    console.log(`restored ${n} row(s)`);
    return;
  }
  const apply = process.argv.includes('--apply');
  const database = apply ? await confirmDatabase() : null;

  const rows = await db.question.findMany({
    where: {
      verifiedStatus: { not: 'rejected' },
      OR: [{ contentLatex: null }, { contentLatex: '' }],
      chapter: { subject: { name: { in: SCIENCE } } },
    },
    select: { id: true, contentText: true, chapter: { select: { subject: { select: { name: true } } } } },
  });

  const changes: Array<{ id: string; text: string }> = [];
  const bySubject = new Map<string, number>();
  const examples: string[] = [];
  for (const r of rows) {
    const out = stripLabelRuns(r.contentText);
    if (!out.removed.length || !out.text.trim()) continue;
    changes.push({ id: r.id, text: out.text });
    bySubject.set(r.chapter.subject.name, (bySubject.get(r.chapter.subject.name) ?? 0) + 1);
    if (examples.length < Number(arg('show') ?? 12)) examples.push(`${r.chapter.subject.name}: removed ${JSON.stringify(out.removed)}`);
  }
  console.log(`  questions checked  ${rows.length}`);
  console.log(`  to clean           ${changes.length}`);
  for (const [k, v] of [...bySubject].sort((a, b) => b[1] - a[1])) console.log(`    ${String(v).padStart(4)}  ${k}`);
  for (const e of examples) console.log(`  ${e.slice(0, 220)}`);
  if (!apply) {
    console.log('\n  report only — pass --apply --confirm-db <database> to write.');
    return;
  }
  if (!changes.length) return;
  const table = `backup_figure_labels_${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}`;
  await db.$executeRawUnsafe(`CREATE TABLE ${table} AS SELECT id, content_text FROM questions WHERE id = ANY($1::uuid[])`, changes.map((c) => c.id));
  for (const c of changes) {
    await db.$executeRaw`UPDATE questions SET content_text = ${c.text}, embedding = NULL WHERE id = ${c.id}::uuid`;
  }
  console.log(`\n  ${changes.length} cleaned on ${database}; backup in ${table}.`);
  console.log(`  undo:  npm run corpus:strip-labels -- --restore ${table} --confirm-db ${database}`);
  console.log('  next:  npm run ingest -- --embed-missing');
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
