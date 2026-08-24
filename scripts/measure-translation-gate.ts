/**
 * What does the top chunk similarity actually look like, and how often would
 * the cross-script translation gate fire?
 *
 *   npm run measure:translation-gate
 *   npm run measure:translation-gate -- --sample 400
 *
 * `retrieveGrounding` translates the query into the corpus's other script when
 * nothing convincing has been found yet, and "convincing" is spelled
 * `CONCEPT_LEVEL_THRESHOLD + 0.15`. That margin was chosen when the concept
 * threshold was 0.72, making the gate 0.87 — above the exact-match threshold,
 * so it fired only when nothing very good had come back. The provider changed
 * and the threshold was recalibrated to 0.45; the margin was not revisited, so
 * the gate is now 0.60 and fires on roughly half of all questions, each time
 * costing a model call and about 1.4 seconds.
 *
 * The obvious place to read the real distribution is `chat_messages.top_similarity`,
 * which is logged on every answer. There are nine rows. Picking a threshold off
 * nine samples is the same mistake as judging an extractor rule on 250 papers,
 * with two orders of magnitude less to go on.
 *
 * So the distribution is measured directly: take real questions, embed each as
 * a query, run the same chunk search the pipeline runs, and record what came
 * back. It is a proxy and the difference is worth stating — a student types
 * "what is the photoelectric effect" where an exam paper writes six lines of
 * setup, and shorter queries tend to score lower — so this measures the gate on
 * the harder end of the range rather than the typical one.
 *
 * Nothing is changed. This prints the distribution and what each candidate
 * threshold would cost, and the choice stays with a person.
 */

import { embed } from '@/lib/ai/embeddings';
import { db } from '@/lib/db';
import { CONCEPT_LEVEL_THRESHOLD, EXACT_MATCH_THRESHOLD } from '@/lib/retrieval';

const argv = process.argv.slice(2);
const SAMPLE = Number(argv[argv.indexOf('--sample') + 1]) || 250;

type Row = { similarity: number };

async function main() {
  // Spread across subjects rather than taken in insertion order, so one
  // well-covered subject cannot set the distribution for all of them.
  const questions = await db.$queryRaw<{ id: string; content_text: string; subject_id: string }[]>`
    WITH ranked AS (
      SELECT q.id, q.content_text, s.id AS subject_id,
             row_number() OVER (PARTITION BY s.id ORDER BY random()) AS rn
        FROM questions q
        JOIN chapters c ON c.id = q.chapter_id
        JOIN subjects s ON s.id = c.subject_id
       WHERE q.verified_status <> 'rejected' AND length(q.content_text) > 40
    )
    SELECT id, content_text, subject_id FROM ranked WHERE rn <= 12 LIMIT ${SAMPLE}
  `;

  if (!questions.length) {
    console.log('no questions to measure');
    return;
  }

  const sims: number[] = [];
  for (const q of questions) {
    const vector = await embed(q.content_text.slice(0, 1500), 'query');
    const hits = await db.$queryRaw<Row[]>`
      SELECT 1 - (cc.embedding <=> ${`[${vector.join(',')}]`}::vector) AS similarity
        FROM content_chunks cc
        JOIN chapter_content_chunks link ON link.chunk_id = cc.id
        JOIN chapters ch ON ch.id = link.chapter_id
       WHERE ch.subject_id = ${q.subject_id}::uuid AND cc.embedding IS NOT NULL
       ORDER BY cc.embedding <=> ${`[${vector.join(',')}]`}::vector
       LIMIT 1
    `;
    if (hits[0]) sims.push(Number(hits[0].similarity));
  }

  sims.sort((a, b) => a - b);
  const at = (p: number) => sims[Math.min(sims.length - 1, Math.floor(p * sims.length))]!;
  const pct = (n: number) => `${((100 * n) / sims.length).toFixed(1)}%`;

  console.log(`\n${sims.length} questions measured against their own subject's passages\n`);
  console.log(`  min ${at(0).toFixed(3)}   p10 ${at(0.1).toFixed(3)}   p25 ${at(0.25).toFixed(3)}` +
    `   median ${at(0.5).toFixed(3)}   p75 ${at(0.75).toFixed(3)}   p90 ${at(0.9).toFixed(3)}` +
    `   max ${at(0.999).toFixed(3)}`);
  console.log(`\n  concept threshold ${CONCEPT_LEVEL_THRESHOLD}, exact ${EXACT_MATCH_THRESHOLD}`);
  console.log(`\n  gate value   fires on      meaning`);
  for (const margin of [0.15, 0.1, 0.05, 0.0, -0.05]) {
    const gate = CONCEPT_LEVEL_THRESHOLD + margin;
    const fires = sims.filter((s) => s < gate).length;
    const label = margin === 0.15 ? '  <-- today' : '';
    console.log(`  +${margin.toFixed(2)} = ${gate.toFixed(2)}   ${pct(fires).padStart(6)}` +
      `        ${fires} of ${sims.length}${label}`);
  }
  /*
   * The cost of firing too little is invisible, which is why it is stated here
   * rather than left to be inferred: a question about material that exists only
   * in the other script simply comes back unanswered, and looks from the
   * outside exactly like a question the corpus does not cover.
   */
  console.log(`\n  Firing costs ~1.4s and one model call. NOT firing costs the answer\n` +
    `  entirely, for a question whose material is only in the other script —\n` +
    `  which is indistinguishable from a gap in the corpus.`);
  await db.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
