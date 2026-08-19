/**
 * Removes chapter rows that no book's contents page names any more.
 *
 *   npm run prune:chapters            what it would remove
 *   npm run prune:chapters -- --apply
 *
 * The taxonomy seeder matches chapters on (subject, orderIndex) and updates
 * them in place, which is right for a chapter that was re-worded and wrong for
 * one that was removed: an earlier parse produced entries that later parses do
 * not, and those rows stay for ever. LH Life Sciences carries fifteen chapters
 * for a book whose contents page lists five. The extra ten are sub-sections
 * that an older parse promoted — "To make a balanced diet", "Qualitative needs:
 * requirements in vitamins" — and the material they name is already reachable
 * under the chapter that contains them, which has 29 passages.
 *
 * They are not harmless. Each one shows in the app as a chapter with nothing
 * behind it, and a student cannot tell "we have not loaded this yet" from "this
 * is a heading inside another chapter you have already got".
 *
 * The test is whether any book serving that subject still names the chapter.
 * Emptiness is NOT the test and would be wrong: "الكتابة العروضيّة وتقطيع البيت
 * الشعريّ" is empty and is a real chapter of the grammar book, listed on its
 * contents page, that our parser cannot locate in the body. Deleting it would
 * remove a piece of the syllabus.
 *
 * Anything a student has touched is kept regardless. A chapter holding
 * questions, mastery or a planned session is left alone and reported, because
 * deleting it would cascade into work that belongs to somebody.
 */

import { readFile } from 'node:fs/promises';
import { writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { db } from '@/lib/db';

const ROOT = process.cwd();
const CATALOG = path.join(ROOT, 'scripts', 'corpus', 'catalog.csv');
const TAXONOMY = path.join(ROOT, 'corpus', 'taxonomy');
const RECEIPT = 'corpus/pruned-chapters.json';

/** Same folding the chunker matches names with, so both agree on "the same". */
const fold = (s: string) => s.normalize('NFKC').replace(/\s+/g, ' ').trim();

async function currentTitles(): Promise<Map<string, Set<string>>> {
  const csv = await readFile(CATALOG, 'utf8');
  const [header, ...lines] = csv.split(/\r?\n/).filter((l) => l.trim());
  const cols = header!.replace(/^\uFEFF/, '').split(',');
  const iFolder = cols.indexOf('folder');
  const iSubject = cols.indexOf('subject');

  const bySubject = new Map<string, Set<string>>();
  for (const line of lines) {
    const cells = line.split(',');
    const folder = cells[iFolder]?.trim();
    const subject = cells[iSubject]?.trim();
    if (!folder || !subject) continue;
    let taxonomy: { chapters?: { title?: string }[] };
    try {
      taxonomy = JSON.parse(await readFile(path.join(TAXONOMY, `${folder}.json`), 'utf8'));
    } catch {
      // A book with no taxonomy tells us nothing about what its subject should
      // hold, so its subject is skipped entirely rather than half-judged.
      bySubject.delete(subject);
      continue;
    }
    const set = bySubject.get(subject) ?? new Set<string>();
    for (const c of taxonomy.chapters ?? []) if (c.title) set.add(fold(c.title));
    bySubject.set(subject, set);
  }
  return bySubject;
}

async function main() {
  if (process.argv.includes('--undo')) {
    console.log(`This deletes rows. Restore with: npm run db:seed:taxonomy`);
    console.log(`The removed rows are listed in ${RECEIPT}.`);
    console.log(readFileSync(RECEIPT, 'utf-8').slice(0, 400));
    return;
  }
  const apply = process.argv.includes('--apply');
  const titles = await currentTitles();

  const rows: { id: string; name: string; subject: string; track: string;
                questions: bigint; mastery: bigint; sessions: bigint; chunks: bigint }[] =
    await db.$queryRaw`
      SELECT ch.id, ch.name, s.name AS subject, t.code AS track,
        (SELECT count(*) FROM questions q WHERE q.chapter_id = ch.id) AS questions,
        (SELECT count(*) FROM chapter_mastery m WHERE m.chapter_id = ch.id) AS mastery,
        (SELECT count(*) FROM study_sessions ss WHERE ss.chapter_id = ch.id) AS sessions,
        (SELECT count(*) FROM chapter_content_chunks l WHERE l.chapter_id = ch.id) AS chunks
      FROM chapters ch
      JOIN subjects s ON s.id = ch.subject_id
      JOIN tracks t ON t.id = s.track_id`;

  const unknown = rows.filter((r) => {
    const known = titles.get(r.subject);
    return known !== undefined && !known.has(fold(r.name));
  });
  const inUse = unknown.filter((r) => Number(r.questions) + Number(r.mastery) + Number(r.sessions) > 0);
  const removable = unknown.filter((r) => Number(r.questions) + Number(r.mastery) + Number(r.sessions) === 0);

  console.log(`${rows.length} chapter rows, ${unknown.length} named by no book serving their subject`);
  console.log(`  ${removable.length} removable — nothing points at them`);
  console.log(`  ${inUse.length} kept — a student has questions, mastery or a plan on them\n`);

  const bySubject = new Map<string, number>();
  for (const r of removable) bySubject.set(`[${r.track}] ${r.subject}`, (bySubject.get(`[${r.track}] ${r.subject}`) ?? 0) + 1);
  for (const [k, n] of [...bySubject].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`    ${String(n).padStart(3)}  ${k}`);
  }
  console.log('\n  a sample:');
  for (const r of removable.slice(0, 8)) {
    console.log(`    [${r.track}] ${r.subject.slice(0, 16).padEnd(18)}${r.name.slice(0, 46)}${Number(r.chunks) ? `  (${r.chunks} passages!)` : ''}`);
  }

  const withContent = removable.filter((r) => Number(r.chunks) > 0);
  if (withContent.length) {
    console.log(`\n  ${withContent.length} of them DO hold passages and will not be touched.`);
  }

  const doomed = removable.filter((r) => Number(r.chunks) === 0);
  console.log(`\n${doomed.length} row(s) would be deleted.`);
  if (!apply) {
    console.log('Nothing changed. Re-run with --apply.');
    return;
  }

  writeFileSync(
    RECEIPT,
    JSON.stringify({ prunedAt: new Date().toISOString(),
      rows: doomed.map((d) => ({ id: d.id, track: d.track, subject: d.subject, name: d.name })) }, null, 1),
    'utf-8',
  );
  const result = await db.chapter.deleteMany({ where: { id: { in: doomed.map((d) => d.id) } } });
  console.log(`${result.count} chapter row(s) removed. Listed in ${RECEIPT}.`);
  console.log('Re-create from the books at any time with: npm run db:seed:taxonomy');
}

main()
  .catch((e) => {
    console.error('Prune failed:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
