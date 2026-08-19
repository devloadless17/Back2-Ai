/**
 * Removes links that say a passage belongs to a chapter it was never cut for.
 *
 *   npm run repair:links            what it would remove
 *   npm run repair:links -- --apply
 *
 * The chunker builds each chapter's body from its own page range, prefixes every
 * passage with "Subject — Chapter", and records that chapter in the passage's
 * `title`. So a passage knows which chapter it came from, twice over.
 *
 * 3,007 links disagree with both records. They are left over from earlier runs
 * whose page ranges were wrong — one English chapter was given pages 15 to 346,
 * the whole book — and the chunker cannot clear them, because its own tidy-up
 * only looks at passages from the book it is currently reading. A stale link
 * pointing into a DIFFERENT book is invisible to it and survives every re-run.
 *
 * What that costs a student is not abstract: ask "ما موقف طاغور من الخالق؟" and
 * the answer comes back sourced to "يوحنا قمير: هل في الكواكب إنسان؟" — a
 * different essay, in a different unit, by a different author.
 *
 * Both records must disagree before a link is removed. `title` alone would be
 * enough for almost every row, but it is truncated to 200 characters at write
 * time, and a rename would make it lie. The trail inside the passage's own text
 * is independent of both.
 */

import { readFileSync, writeFileSync } from 'node:fs';

import { db } from '@/lib/db';

const RECEIPT = 'corpus/repaired-chunk-links.json';

type Row = { chapter_id: string; chunk_id: string; chapter: string; title: string; head: string; subject: string };

async function main() {
  if (process.argv.includes('--undo')) {
    const { links } = JSON.parse(readFileSync(RECEIPT, 'utf-8')) as { links: { chapterId: string; chunkId: string }[] };
    let back = 0;
    for (const l of links) {
      await db.chapterContentChunk.upsert({
        where: { chapterId_chunkId: { chapterId: l.chapterId, chunkId: l.chunkId } },
        update: {},
        create: { chapterId: l.chapterId, chunkId: l.chunkId },
      });
      back += 1;
    }
    console.log(`${back} link(s) restored.`);
    return;
  }

  const apply = process.argv.includes('--apply');

  /*
   * `left(ch.name, 200)` because that is what the writer stored; comparing
   * against the untruncated name would flag every chapter with a long title.
   */
  const doomed: Row[] = await db.$queryRaw`
    SELECT l.chapter_id, l.chunk_id, ch.name AS chapter, cc.title, s.name AS subject,
           left(cc.content_text, 120) AS head
    FROM chapter_content_chunks l
    JOIN chapters ch ON ch.id = l.chapter_id
    JOIN subjects s ON s.id = ch.subject_id
    JOIN content_chunks cc ON cc.id = l.chunk_id
    WHERE cc.title IS NOT NULL
      AND cc.title <> left(ch.name, 200)
      AND position(ch.name in left(cc.content_text, 300)) = 0`;

  console.log(`${doomed.length} link(s) name a chapter the passage was not cut for\n`);

  const byChapter = new Map<string, number>();
  for (const d of doomed) byChapter.set(`${d.chapter} <- ${d.title}`, (byChapter.get(`${d.chapter} <- ${d.title}`) ?? 0) + 1);
  console.log('  worst offenders (chapter <- the chapter the passage really came from):');
  for (const [k, n] of [...byChapter].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    console.log(`    ${String(n).padStart(4)}  ${k.slice(0, 74)}`);
  }

  const emptied: { n: bigint }[] = await db.$queryRaw`
    SELECT count(*) AS n FROM chapters ch
    WHERE EXISTS (SELECT 1 FROM chapter_content_chunks l WHERE l.chapter_id = ch.id)
      AND NOT EXISTS (
        SELECT 1 FROM chapter_content_chunks l
        JOIN content_chunks cc ON cc.id = l.chunk_id
        WHERE l.chapter_id = ch.id
          AND (cc.title = left(ch.name, 200) OR position(ch.name in left(cc.content_text, 300)) > 0))`;
  console.log(`\n  ${emptied[0]!.n} chapter(s) hold only such links and will show no material afterwards.`);
  console.log('  That is the correct state: they were showing another chapter\u2019s pages under their own name.');

  if (!apply) {
    console.log('\nNothing changed. Re-run with --apply.');
    return;
  }

  writeFileSync(
    RECEIPT,
    JSON.stringify(
      { repairedAt: new Date().toISOString(), links: doomed.map((d) => ({ chapterId: d.chapter_id, chunkId: d.chunk_id })) },
      null,
      1,
    ),
    'utf-8',
  );

  let removed = 0;
  for (const d of doomed) {
    await db.chapterContentChunk.delete({
      where: { chapterId_chunkId: { chapterId: d.chapter_id, chunkId: d.chunk_id } },
    });
    removed += 1;
  }
  console.log(`\n${removed} link(s) removed. Passages themselves are untouched.`);
  console.log(`  recorded in ${RECEIPT} — undo:  npm run repair:links -- --undo`);
}

main()
  .catch((e) => {
    console.error('Repair failed:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
