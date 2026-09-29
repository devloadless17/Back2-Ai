/**
 * Bring a database's chapter lists in line with another's, matching chapters BY NAME.
 *
 *   npm run corpus:sync-chapters -- --export ops-in/chapters.json          # on the source (laptop)
 *   npm run corpus:sync-chapters -- --from corpus/chapters.json            # dry run on the target
 *   npm run corpus:sync-chapters -- --from corpus/chapters.json --apply --confirm-db bac2
 *   npm run corpus:sync-chapters -- --restore <backup table> --confirm-db bac2
 *
 * WHY NOT `db:seed:taxonomy`. The seeder keys chapters on (subject, orderIndex)
 * and updates in place. Where the source list gained chapters near the front
 * (GS/LS physics now opens with "Energy", "Angular Momentum"…), every existing
 * row would be RENAMED to the chapter after it, while its questions, passages
 * and students' mastery stayed on the same id — the whole subject silently
 * relabelled. Production holds real students' progress on those ids.
 *
 * WHAT THIS DOES, per subject (track + name + language):
 *   - a target chapter whose name matches a source chapter keeps its id; its
 *     name, position, unit and cancellation are set from the source. Names are
 *     compared exactly first, then loosely (punctuation, spacing, Arabic
 *     vowel marks and letter variants ignored), because the two databases
 *     spell "وجود الله (إبن سينا، أخوان الصفاء، المعري)" differently;
 *   - a source chapter with no match is created;
 *   - a target chapter with no match is deleted ONLY if nothing uses it —
 *     no question, link, passage, mastery row, attempt, generated problem or
 *     card, study session or todo. Otherwise it is kept, moved past the end of
 *     the list, and reported.
 *
 * One transaction. Before writing, the target's chapters and units are copied
 * to backup tables named in the output; --restore puts names, positions and
 * units back and deletes the chapters this run created that are still unused.
 */

import { readFileSync, writeFileSync } from 'node:fs';

import { Prisma, PrismaClient } from '@prisma/client';

const db = new PrismaClient();

type ExportChapter = { name: string; orderIndex: number; unit: string | null; cancelledAt: string | null; cancelledReason: string | null };
type ExportSubject = { track: string; subject: string; language: string; units: string[]; chapters: ExportChapter[] };

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** A name with everything that differs between two spellings of it removed. */
export function looseKey(name: string): string {
  return name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '') // Arabic vowel marks, tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\(\s*\*\s*\)/g, '') // the "(*)" footnote marker
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * The last pass, for chapters still unmatched: one name inside the other
 * ("L'ÉMIGRÉ DE BRISBANE" / "… de GEORGES SCHÉHADÉ", "Chapter 12: Solid and
 * Hazardous Wastes" / "Solid and Hazardous Wastes"), or a spelling a letter or
 * two apart ("يحي" / "يحيى"). Only ever offered chapters the exact and loose
 * passes left over, in the same subject.
 */
export function nearlySame(a: string, b: string, minShare = 0): boolean {
  if (!a || !b) return false;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length >= 8 && long.includes(short) && short.length >= minShare * long.length) return true;
  if (Math.abs(a.length - b.length) > 3) return false;
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length]! <= Math.max(1, Math.floor(long.length * 0.06));
}

async function confirmDatabase(): Promise<string> {
  const rows = await db.$queryRaw<Array<{ d: string }>>`SELECT current_database() AS d`;
  const database = rows[0]!.d;
  if (arg('confirm-db') !== database) {
    throw new Error(`refusing to write: connected to "${database}", --confirm-db says "${arg('confirm-db') ?? '(none)'}"`);
  }
  return database;
}

async function exportChapters(file: string) {
  const subjects = await db.subject.findMany({
    where: { trackId: { not: null } },
    select: {
      name: true,
      language: true,
      track: { select: { code: true } },
      units: { select: { name: true, orderIndex: true }, orderBy: { orderIndex: 'asc' } },
      chapters: {
        select: { name: true, orderIndex: true, cancelledAt: true, cancelledReason: true, unit: { select: { name: true } } },
        orderBy: { orderIndex: 'asc' },
      },
    },
  });
  const out: ExportSubject[] = subjects.map((s) => ({
    track: s.track!.code,
    subject: s.name,
    language: s.language,
    units: s.units.map((u) => u.name),
    chapters: s.chapters.map((c) => ({
      name: c.name,
      orderIndex: c.orderIndex,
      unit: c.unit?.name ?? null,
      cancelledAt: c.cancelledAt?.toISOString() ?? null,
      cancelledReason: c.cancelledReason,
    })),
  }));
  writeFileSync(file, JSON.stringify(out, null, 1));
  console.log(`exported ${out.length} subjects, ${out.reduce((n, s) => n + s.chapters.length, 0)} chapters -> ${file}`);
}

/** How many rows of any kind hang off a chapter. */
async function usage(tx: Prisma.TransactionClient, chapterId: string): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ n: bigint }>>`
    SELECT (SELECT count(*) FROM questions WHERE chapter_id = ${chapterId}::uuid)
         + (SELECT count(*) FROM question_chapters WHERE chapter_id = ${chapterId}::uuid)
         + (SELECT count(*) FROM chapter_content_chunks WHERE chapter_id = ${chapterId}::uuid)
         + (SELECT count(*) FROM chapter_mastery WHERE chapter_id = ${chapterId}::uuid)
         + (SELECT count(*) FROM attempts WHERE chapter_id = ${chapterId}::uuid)
         + (SELECT count(*) FROM generated_problems WHERE chapter_id = ${chapterId}::uuid)
         + (SELECT count(*) FROM generated_cards WHERE chapter_id = ${chapterId}::uuid)
         + (SELECT count(*) FROM study_sessions WHERE chapter_id = ${chapterId}::uuid)
         + (SELECT count(*) FROM todos WHERE linked_chapter_id = ${chapterId}::uuid) AS n`;
  return Number(rows[0]!.n);
}

/**
 * Move everything that hangs off one chapter onto another, then delete it.
 *
 * Link tables are primary-keyed on the pair, so a row the target already has
 * is dropped rather than duplicated. A student with a mastery row on both
 * keeps the target's; mastery is recomputed from attempts, which all move.
 */
async function mergeInto(tx: Prisma.TransactionClient, from: string, to: string) {
  await tx.$executeRaw`UPDATE questions SET chapter_id = ${to}::uuid WHERE chapter_id = ${from}::uuid`;
  await tx.$executeRaw`INSERT INTO question_chapters (question_id, chapter_id, score)
    SELECT question_id, ${to}::uuid, score FROM question_chapters WHERE chapter_id = ${from}::uuid ON CONFLICT DO NOTHING`;
  await tx.$executeRaw`DELETE FROM question_chapters WHERE chapter_id = ${from}::uuid`;
  await tx.$executeRaw`INSERT INTO chapter_content_chunks (chapter_id, chunk_id)
    SELECT ${to}::uuid, chunk_id FROM chapter_content_chunks WHERE chapter_id = ${from}::uuid ON CONFLICT DO NOTHING`;
  await tx.$executeRaw`DELETE FROM chapter_content_chunks WHERE chapter_id = ${from}::uuid`;
  await tx.$executeRaw`DELETE FROM chapter_mastery m WHERE m.chapter_id = ${from}::uuid
    AND EXISTS (SELECT 1 FROM chapter_mastery t WHERE t.chapter_id = ${to}::uuid AND t.user_id = m.user_id)`;
  await tx.$executeRaw`UPDATE chapter_mastery SET chapter_id = ${to}::uuid WHERE chapter_id = ${from}::uuid`;
  await tx.$executeRaw`UPDATE attempts SET chapter_id = ${to}::uuid WHERE chapter_id = ${from}::uuid`;
  await tx.$executeRaw`UPDATE generated_problems SET chapter_id = ${to}::uuid WHERE chapter_id = ${from}::uuid`;
  await tx.$executeRaw`UPDATE generated_cards SET chapter_id = ${to}::uuid WHERE chapter_id = ${from}::uuid`;
  await tx.$executeRaw`UPDATE study_sessions SET chapter_id = ${to}::uuid WHERE chapter_id = ${from}::uuid`;
  await tx.$executeRaw`UPDATE todos SET linked_chapter_id = ${to}::uuid WHERE linked_chapter_id = ${from}::uuid`;
  await tx.$executeRaw`DELETE FROM chapters WHERE id = ${from}::uuid`;
}

async function sync(file: string, apply: boolean) {
  const database = apply ? await confirmDatabase() : null;
  const source = JSON.parse(readFileSync(file, 'utf8')) as ExportSubject[];
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  const report = { subjects: 0, missingSubjects: [] as string[], kept: 0, renamed: 0, moved: 0, created: 0, merged: 0, deleted: 0, retired: [] as string[], mergedList: [] as string[] };

  const run = async (tx: Prisma.TransactionClient) => {
    if (apply) {
      await tx.$executeRawUnsafe(`CREATE TABLE backup_chapters_sync_${stamp} AS SELECT id, subject_id, unit_id, name, order_index, cancelled_at, cancelled_reason FROM chapters`);
      await tx.$executeRawUnsafe(`CREATE TABLE backup_units_sync_${stamp} AS SELECT id, subject_id, name, order_index FROM units`);
      await tx.$executeRawUnsafe(`CREATE TABLE created_chapters_sync_${stamp} (id uuid PRIMARY KEY)`);
    }
    for (const s of source) {
      const subject = await tx.subject.findFirst({
        where: { name: s.subject, language: s.language as never, track: { code: s.track } },
        select: { id: true },
      });
      if (!subject) {
        report.missingSubjects.push(`${s.track} ${s.subject} (${s.language})`);
        continue;
      }
      report.subjects++;
      const existing = await tx.chapter.findMany({
        where: { subjectId: subject.id },
        select: { id: true, name: true, orderIndex: true, unitId: true },
        orderBy: { orderIndex: 'asc' },
      });

      // Match: exact names first, then loose keys, each target used once.
      const free = new Map(existing.map((c) => [c.id, c]));
      const matchOf = new Map<number, (typeof existing)[number]>();
      for (const pass of ['exact', 'loose', 'near'] as const) {
        for (const [i, ch] of s.chapters.entries()) {
          if (matchOf.has(i)) continue;
          const hit = [...free.values()].find((c) =>
            pass === 'exact'
              ? c.name.trim() === ch.name.trim()
              : pass === 'loose'
                ? looseKey(c.name) === looseKey(ch.name)
                : nearlySame(looseKey(c.name), looseKey(ch.name)),
          );
          if (hit) {
            matchOf.set(i, hit);
            free.delete(hit.id);
          }
        }
      }

      if (!apply) {
        for (const [i, ch] of s.chapters.entries()) {
          const m = matchOf.get(i);
          if (!m) report.created++;
          else {
            report.kept++;
            if (m.name !== ch.name) report.renamed++;
            if (m.orderIndex !== ch.orderIndex) report.moved++;
          }
        }
        const kept = [...matchOf.values()];
        for (const c of free.values()) {
          const twin = kept.find((m) => looseKey(m.name) === looseKey(c.name) || nearlySame(looseKey(m.name), looseKey(c.name), 0.7));
          if (twin) {
            report.merged++;
            report.mergedList.push(`${s.track} ${s.subject}: "${c.name}" (#${c.orderIndex}) -> "${twin.name}" (#${twin.orderIndex})`);
            continue;
          }
          const n = await usage(tx, c.id);
          if (n === 0) report.deleted++;
          else report.retired.push(`${s.track} ${s.subject}: "${c.name}" (${n} rows)`);
        }
        continue;
      }

      // Units by position, named from the source.
      const unitIds: string[] = [];
      for (const [i, name] of s.units.entries()) {
        const u = await tx.unit.upsert({
          where: { subjectId_orderIndex: { subjectId: subject.id, orderIndex: i } },
          update: { name },
          create: { subjectId: subject.id, name, orderIndex: i },
          select: { id: true },
        });
        unitIds.push(u.id);
      }
      const unitByName = new Map(s.units.map((name, i) => [name, unitIds[i]!]));

      // Out of the way first: (subject, orderIndex) is unique.
      await tx.$executeRaw`UPDATE chapters SET order_index = order_index + 100000 WHERE subject_id = ${subject.id}::uuid`;

      for (const [i, ch] of s.chapters.entries()) {
        const m = matchOf.get(i);
        const data = {
          name: ch.name,
          orderIndex: i,
          unitId: ch.unit ? (unitByName.get(ch.unit) ?? null) : null,
          cancelledAt: ch.cancelledAt ? new Date(ch.cancelledAt) : null,
          cancelledReason: ch.cancelledReason,
        };
        if (m) {
          await tx.chapter.update({ where: { id: m.id }, data });
          report.kept++;
          if (m.name !== ch.name) report.renamed++;
          if (m.orderIndex !== i) report.moved++;
        } else {
          const c = await tx.chapter.create({ data: { ...data, subjectId: subject.id }, select: { id: true } });
          await tx.$executeRawUnsafe(`INSERT INTO created_chapters_sync_${stamp} VALUES ('${c.id}')`);
          report.created++;
        }
      }
      let past = s.chapters.length;
      const kept = [...matchOf.values()];
      for (const c of free.values()) {
        // A second copy of a chapter that was kept: the teacher summaries were
        // added as their own "Logarithm functions" beside the book's, and the
        // source fused them. Everything hanging off the copy moves across.
        const twin = kept.find((m) => looseKey(m.name) === looseKey(c.name) || nearlySame(looseKey(m.name), looseKey(c.name), 0.7));
        if (twin) {
          await mergeInto(tx, c.id, twin.id);
          report.merged++;
          continue;
        }
        const n = await usage(tx, c.id);
        if (n === 0) {
          await tx.chapter.delete({ where: { id: c.id } });
          report.deleted++;
        } else {
          // Still carrying questions, passages or a student's history: hidden
          // from students (every chapter query filters cancelled_at) and kept.
          await tx.chapter.update({
            where: { id: c.id },
            data: { orderIndex: past++, cancelledAt: new Date(), cancelledReason: `retired by chapter sync ${stamp}` },
          });
          report.retired.push(`${s.track} ${s.subject}: "${c.name}" (${n} rows)`);
        }
      }
      // Units past the source's list that no chapter uses any more.
      await tx.$executeRaw`DELETE FROM units u WHERE u.subject_id = ${subject.id}::uuid AND u.order_index >= ${s.units.length}
        AND NOT EXISTS (SELECT 1 FROM chapters c WHERE c.unit_id = u.id)`;
    }
  };

  if (apply) await db.$transaction(run, { timeout: 30 * 60_000, maxWait: 60_000 });
  else await run(db as unknown as Prisma.TransactionClient);

  console.log(JSON.stringify({ database, mode: apply ? 'apply' : 'dry-run', ...report, retired: report.retired.length, mergedList: undefined }, null, 2));
  for (const m of report.mergedList) console.log(`  merge: ${m}`);
  for (const k of report.retired) console.log(`  retired (hidden, history kept): ${k}`);
  for (const m of report.missingSubjects) console.log(`  MISSING SUBJECT on target: ${m}`);
  if (apply) {
    console.log(`\nbackup: backup_chapters_sync_${stamp}, backup_units_sync_${stamp}`);
    console.log(`undo:   npm run corpus:sync-chapters -- --restore ${stamp} --confirm-db ${database}`);
  } else console.log('\n(dry run — pass --apply --confirm-db to write)');
}

async function restore(stamp: string) {
  if (!/^\d{14}$/.test(stamp)) throw new Error('--restore takes the 14-digit stamp printed by --apply');
  await confirmDatabase();
  await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`UPDATE chapters SET order_index = order_index + 100000`);
    await tx.$executeRawUnsafe(`
      DELETE FROM chapters c USING created_chapters_sync_${stamp} x
       WHERE c.id = x.id
         AND NOT EXISTS (SELECT 1 FROM questions q WHERE q.chapter_id = c.id)
         AND NOT EXISTS (SELECT 1 FROM question_chapters q WHERE q.chapter_id = c.id)
         AND NOT EXISTS (SELECT 1 FROM chapter_mastery m WHERE m.chapter_id = c.id)
         AND NOT EXISTS (SELECT 1 FROM attempts a WHERE a.chapter_id = c.id)`);
    await tx.$executeRawUnsafe(`
      UPDATE chapters c SET name = b.name, order_index = b.order_index, unit_id = b.unit_id,
             cancelled_at = b.cancelled_at, cancelled_reason = b.cancelled_reason
        FROM backup_chapters_sync_${stamp} b WHERE b.id = c.id`);
    await tx.$executeRawUnsafe(`
      UPDATE units u SET name = b.name, order_index = b.order_index FROM backup_units_sync_${stamp} b WHERE b.id = u.id`);
  }, { timeout: 30 * 60_000 });
  console.log(`restored chapters and units from backup_*_sync_${stamp}. Chapters it created that are now in use were kept (moved past the end).`);
}

async function main() {
  const exp = arg('export');
  const from = arg('from');
  const rest = arg('restore');
  if (exp) return exportChapters(exp);
  if (rest) return restore(rest);
  if (!from) throw new Error('pass --export <file>, --from <file> [--apply], or --restore <stamp>');
  return sync(from, process.argv.includes('--apply'));
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
