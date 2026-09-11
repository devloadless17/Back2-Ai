import { db } from '@/lib/db';

/**
 * Puts the GS/LS English questions back in the unit they were filed under.
 *
 *   npm run refile:english-rescan            what it would move
 *   npm run refile:english-rescan -- --apply
 *
 * A ONE-OFF, for one specific event. The GS/LS English book was re-scanned
 * (c6e87a91 -> a301fec1) because the old scan's pages were physically out of
 * order, and the re-scan let the subject go from 3 chapters to 9. The seeder
 * matches a chapter on (subject, orderIndex) and RENAMES it in place, so the row
 * at index 2 — which was "Current Concerns", holding 219 passages and every one
 * of the subject's questions — became "Natural Phenomena — New Worlds". The
 * questions did not move; the name moved out from under them. They are now filed
 * under a chapter about Mars while being about obesity, leptin and depression.
 *
 * `refile:questions` declines to fix it and is right to: it moved 2 of 60,
 * leaving 42 because no chapter scored above its 0.65 floor. That floor is doing
 * its job. An English comprehension question is answered from a text printed on
 * the exam paper, so NO chapter of the book contains its answer and every
 * chapter scores weakly — 0.43 to 0.48 here. Lowering the floor to force a
 * decision would lower it for the whole corpus to paper over one rename.
 *
 * So this moves them within the unit they already belonged to, and nowhere else.
 * "Current Concerns" is where a human classification had already put them and
 * what the content is about. Which of the unit's three chapters each lands in is
 * decided by similarity, and that part is LOW CONFIDENCE — it is a choice
 * between three weak matches, not a measurement. It is still better than leaving
 * fifty-nine questions about public health under "New Worlds", and better than
 * piling them all into one chapter, which would rebuild the lump the re-scan
 * just took apart.
 *
 * Not general, not reusable, and should be deleted once run on both databases.
 */

const APPLY = process.argv.includes('--apply');

async function main() {
  const tracks = ['GS', 'LS'];
  let moved = 0;

  for (const track of tracks) {
    const subject = await db.$queryRaw<{ id: string }[]>`
      SELECT s.id::text AS id FROM subjects s JOIN tracks t ON t.id = s.track_id
       WHERE s.name = 'English' AND t.code = ${track}`;
    const subjectId = subject[0]?.id;
    if (!subjectId) continue;

    /*
     * Only questions still sitting on the renamed row, and only chapters of the
     * Current Concerns unit. Both halves are deliberately narrow: this must not
     * touch a question that was filed correctly, nor offer a chapter outside the
     * unit the questions came from.
     */
    const rows = await db.$queryRaw<{ qid: string; chid: string; name: string; sim: number }[]>`
      WITH cc AS (
        SELECT c.id, c.name FROM chapters c
         WHERE c.subject_id = ${subjectId}::uuid AND c.name LIKE 'Current Concerns —%'),
      q AS (
        SELECT qq.id, qq.embedding FROM questions qq
          JOIN chapters c ON c.id = qq.chapter_id
         WHERE c.subject_id = ${subjectId}::uuid
           AND c.name = 'Natural Phenomena — New Worlds'
           AND qq.verified_status <> 'rejected' AND qq.embedding IS NOT NULL),
      ranked AS (
        SELECT q.id AS qid, cc.id AS chid, cc.name,
               max(1 - (ch.embedding <=> q.embedding)) AS sim,
               row_number() OVER (
                 PARTITION BY q.id
                 ORDER BY max(1 - (ch.embedding <=> q.embedding)) DESC, cc.id) AS rk
          FROM q CROSS JOIN cc
          JOIN chapter_content_chunks x ON x.chapter_id = cc.id
          JOIN content_chunks ch ON ch.id = x.chunk_id AND ch.embedding IS NOT NULL
         GROUP BY q.id, cc.id, cc.name)
      SELECT qid::text, chid::text, name, sim FROM ranked WHERE rk = 1`;

    const tally = new Map<string, number>();
    for (const row of rows) tally.set(row.name, (tally.get(row.name) ?? 0) + 1);
    console.log(`  ${track}: ${rows.length} question(s) to move`);
    for (const [name, n] of [...tally].sort((a, b) => b[1] - a[1])) {
      console.log(`      ${n.toString().padStart(3)}  ${name}`);
    }

    if (APPLY) {
      for (const row of rows) {
        await db.$executeRaw`
          UPDATE questions SET chapter_id = ${row.chid}::uuid WHERE id = ${row.qid}::uuid`;
        moved += 1;
      }
    }
  }

  console.log(APPLY ? `\n  ${moved} question(s) moved.` : '\n  Nothing changed. Re-run with --apply.');
  await db.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
