/**
 * Translated editions of a paper that is sat in Arabic.
 *
 *   npm run prune:translated                                   report only
 *   npm run prune:translated -- --apply   --confirm-db bac2     writes
 *   npm run prune:translated -- --restore <run> --confirm-db bac2
 *
 * ---------------------------------------------------------------------------
 * NOT the same script as prune-misfiled-exams.ts, and the difference is worth
 * saying out loud because they touch the same rows.
 *
 *   prune-misfiled  a question written in the wrong script for the cycle it
 *                   sits in — a Arabic question inside a French paper. A
 *                   filing error, decided by reading the text.
 *
 *   this one        a whole paper printed in a language its subject is not
 *                   examined in. Nothing is wrong with the text; the edition
 *                   itself is not part of the programme.
 *
 * The CRDP does print philosophy, sociology and economics in French and
 * English, and `exam_cycles.language` exists so those editions could be told
 * apart and served. The decision recorded here reverses that: an Arabic-taught
 * subject is sat in Arabic, so only the Arabic edition is shown. If that is
 * ever revisited, `--restore` puts every row back and the code filter to undo
 * is `OWN_EDITION_ONLY` in src/lib/queries/taxonomy.ts.
 *
 * It hides rather than deletes, for the same reason prune-misfiled does:
 * `Attempt.question` cascades on delete, so removing these rows would take
 * every mark any student earned on them. `verified_status = 'rejected'` is the
 * switch the product already reads everywhere.
 *
 * The backup names the rows this run rejected, so `--restore` cannot un-reject
 * a row some other script rejected for its own reasons.
 * ---------------------------------------------------------------------------
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { db } from '../../src/lib/db';

const ROOT = process.cwd();

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}
const APPLY = process.argv.includes('--apply');
const RESTORE = arg('restore');
const CONFIRM_DB = arg('confirm-db');
const BACKUP_DIR = arg('backup-dir') ?? 'corpus/.mapping';

const backupPath = (run: string, database: string) =>
  path.join(ROOT, BACKUP_DIR, `translated-exams-backup-${database}-${run}.json`);

type Backup = { run: string; questionIds: string[] };

async function currentDatabase(): Promise<string> {
  const rows = await db.$queryRaw<Array<{ d: string }>>`SELECT current_database() AS d`;
  return rows[0]!.d;
}

async function guardWrite() {
  const database = await currentDatabase();
  if (!CONFIRM_DB || CONFIRM_DB !== database) {
    throw new Error(
      `refusing to write: connected to "${database}", --confirm-db says "${CONFIRM_DB ?? '(none)'}"`,
    );
  }
  return database;
}

/** Every paper printed in a language its own subject is not examined in. */
const TRANSLATED = {
  subject: { language: 'ar' as const },
  NOT: { language: 'ar' as const },
};

async function restore(run: string) {
  const database = await guardWrite();
  const file = backupPath(run, database);
  if (!existsSync(file)) throw new Error(`no backup for run ${run} at ${file}`);
  const backup = JSON.parse(readFileSync(file, 'utf-8')) as Backup;

  const result = await db.question.updateMany({
    where: { id: { in: backup.questionIds }, verifiedStatus: 'rejected' },
    data: { verifiedStatus: 'unverified' },
  });
  console.log(
    `  database ${database}: ${result.count} of ${backup.questionIds.length} row(s) restored to unverified.`,
  );
  console.log('  Also revert OWN_EDITION_ONLY in src/lib/queries/taxonomy.ts, or the papers stay hidden.');
}

async function main() {
  if (RESTORE) return restore(RESTORE);

  const database = await currentDatabase();
  const cycles = await db.examCycle.findMany({
    where: TRANSLATED,
    select: {
      id: true,
      title: true,
      year: true,
      language: true,
      subject: { select: { name: true, track: { select: { code: true } } } },
      questions: {
        where: { verifiedStatus: { not: 'rejected' } },
        select: { id: true },
      },
    },
    orderBy: [{ year: 'asc' }],
  });

  const questionIds = cycles.flatMap((c) => c.questions.map((q) => q.id));

  const bySubject = new Map<string, { cycles: number; questions: number }>();
  for (const cycle of cycles) {
    const key = `${cycle.subject.track?.code ?? '??'}  ${cycle.subject.name}  .${cycle.language}`;
    const entry = bySubject.get(key) ?? { cycles: 0, questions: 0 };
    entry.cycles += 1;
    entry.questions += cycle.questions.length;
    bySubject.set(key, entry);
  }

  console.log('');
  console.log(`  database ${database}`);
  console.log(`  translated papers   ${cycles.length}`);
  console.log(`  questions to hide   ${questionIds.length}`);
  console.log('');
  for (const [key, entry] of [...bySubject.entries()].sort()) {
    console.log(`    ${String(entry.cycles).padStart(3)} papers, ${String(entry.questions).padStart(4)} questions   ${key}`);
  }
  console.log('');

  if (!APPLY) {
    console.log(`  DRY RUN — nothing was written. Re-run with --apply --confirm-db ${database}.`);
    console.log('  Nothing is deleted: --apply sets verified_status = rejected, and --restore undoes it.');
    console.log('');
    return;
  }

  await guardWrite();

  /*
   * The run is the date, not a hash of the input: the input here is the
   * database's own state, so a hash of it would change between the apply and
   * anyone looking for the backup afterwards.
   */
  const run = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '');
  const file = backupPath(run, database);
  writeFileSync(file, JSON.stringify({ run, questionIds } satisfies Backup));

  const result = await db.question.updateMany({
    where: { id: { in: questionIds } },
    data: { verifiedStatus: 'rejected' },
  });

  console.log(`  hidden: ${result.count} row(s) now carry verified_status = rejected.`);
  console.log(`  backup: ${path.relative(ROOT, file)}`);
  console.log(`  restore: npm run prune:translated -- --restore ${run} --confirm-db ${database}`);
  console.log('');
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
