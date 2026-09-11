import { db } from '@/lib/db';

/**
 * Moves a question out of a subject whose language it is not written in.
 *
 *   npm run refile:cross-language
 *   npm run refile:cross-language -- --apply
 *
 * Four questions sit in English GS and LS and are written in French:
 *
 *   "Sujet : Les vieux ne sont pas la seule catégorie d'âge à souffrir du
 *    milieu social... À quels problèmes sont confrontés les jeunes ?"
 *   "1-a. Quel est le mot qui, par ses répétitions et ses substituts lexicaux,
 *    souligne le thème du texte de Combaz ?"
 *
 * A student revising English is shown a French composition prompt. It is a
 * filing error at the SUBJECT level, which the ordinary refiler cannot fix
 * because that only ever moves a question between chapters of its own subject.
 *
 * THE TEST IS FUNCTION WORDS, NOT ACCENTS. An English paper quotes French
 * titles and prints accented names, so "contains é" finds dozens of false
 * positives. A question is treated as French only if it uses French function
 * words (le, la, les, des, une, dans, vous) AND uses no English ones (the, and,
 * of, to, is, are, that). Both halves are needed: the first alone matches an
 * English question quoting a French phrase, and the second alone matches a
 * maths paper. Measured across 197 English and 248 Francais questions, this
 * finds 4 and zero the other way — Francais holds no English questions.
 *
 * WHICH CHAPTER IT LANDS IN IS THE WEAKER HALF, and deliberately separated from
 * the subject decision. That a French question does not belong in English is
 * certain. Which chapter of Français it belongs to is chosen by similarity and
 * scores 0.56-0.62 here, under the 0.65 floor `refile:questions` uses — so it is
 * reported before it is applied, and it is only ever a choice between chapters
 * of the right subject rather than a choice about whether to move at all.
 */

const APPLY = process.argv.includes('--apply');

/** Written in French: uses French function words and no English ones. */
const FRENCH = String.raw`\m(le|la|les|des|une|dans|vous)\M`;
const ENGLISH = String.raw`\m(the|and|of|to|is|are|that)\M`;

async function main() {
  const rows = await db.$queryRaw<
    { qid: string; track: string; txt: string; chid: string; name: string; sim: number }[]
  >`
    WITH mis AS (
      SELECT q.id, q.embedding, t.code AS track,
             left(regexp_replace(q.content_text, '\s+', ' ', 'g'), 70) AS txt
        FROM questions q
        JOIN chapters c ON c.id = q.chapter_id
        JOIN subjects s ON s.id = c.subject_id
        JOIN tracks t ON t.id = s.track_id
       WHERE s.name = 'English' AND q.verified_status <> 'rejected'
         AND q.embedding IS NOT NULL
         AND q.content_text ~ ${FRENCH} AND q.content_text !~ ${ENGLISH}),
    cand AS (
      SELECT m.id AS qid, m.track, m.txt, c.id AS chid, c.name,
             max(1 - (cc.embedding <=> m.embedding)) AS sim,
             row_number() OVER (
               PARTITION BY m.id
               ORDER BY max(1 - (cc.embedding <=> m.embedding)) DESC, c.id) AS rk
        FROM mis m
        JOIN subjects s2 ON s2.name = 'Francais'
                        AND s2.track_id = (SELECT id FROM tracks WHERE code = m.track)
        JOIN chapters c ON c.subject_id = s2.id
        JOIN chapter_content_chunks x ON x.chapter_id = c.id
        JOIN content_chunks cc ON cc.id = x.chunk_id AND cc.embedding IS NOT NULL
       GROUP BY m.id, m.track, m.txt, c.id, c.name)
    SELECT qid::text, track, txt, chid::text, name, sim FROM cand WHERE rk = 1
    ORDER BY track, txt`;

  if (rows.length === 0) {
    console.log('  no cross-language questions found');
    await db.$disconnect();
    return;
  }

  for (const row of rows) {
    console.log(`  ${row.track}  ${Number(row.sim).toFixed(3)}  -> ${row.name}`);
    console.log(`        ${row.txt}`);
  }

  if (APPLY) {
    for (const row of rows) {
      await db.$executeRaw`
        UPDATE questions SET chapter_id = ${row.chid}::uuid WHERE id = ${row.qid}::uuid`;
    }
    console.log(`\n  ${rows.length} question(s) moved into Français.`);
  } else {
    console.log('\n  Nothing changed. Re-run with --apply.');
  }
  await db.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
