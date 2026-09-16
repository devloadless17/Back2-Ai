import { readFileSync } from 'node:fs';
import path from 'node:path';

import { embed } from '@/lib/ai/embeddings';
import { db } from '@/lib/db';
import { searchContentChunks } from '@/lib/vector';

/**
 * Does one concept gate per SCRIPT fit seventy subjects?
 *
 *   npm run measure:subject-thresholds
 *
 * `conceptThresholdFor` has two numbers in it — 0.50 for Latin script, 0.45 for
 * Arabic — and every subject in the corpus is judged by one of them. They were
 * calibrated on the two script-level populations pooled together, which assumes
 * the subjects inside each script behave alike.
 *
 * They may well not. A maths passage is symbols and a short statement; a
 * philosophy passage is continuous prose; an English comprehension passage is a
 * magazine article the exam printed. Cosine similarity between a student
 * question and its own source passage has no reason to sit in the same band
 * across those, and if it does not, a single gate is simultaneously too strict
 * for one subject and too loose for another — refusing real questions here
 * while answering off-syllabus ones there.
 *
 * This measures, per subject, where the ON-SYLLABUS population actually sits:
 * each probe searched against its own subject, reporting the similarity of the
 * passage it was written from. The p10 is the interesting number — the gate has
 * to sit below it or one question in ten is refused despite the corpus holding
 * its answer.
 *
 * COSTS NOTHING BEYOND EMBEDDINGS. No model calls. The off-syllabus half of a
 * real calibration needs questions that are deliberately outside each subject,
 * which `check:refusal` holds and this does not — so this says where the gate
 * is too STRICT, and cannot say where it is too loose. Read it as half a
 * picture, and the cheap half.
 */

type Probe = { chunkId: string; query: string; subjectId: string };

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))));
  return sorted[i]!;
}

async function main() {
  const raw = JSON.parse(
    readFileSync(path.join(process.cwd(), 'corpus', 'retrieval-probes.json'), 'utf8'),
  ) as Record<string, string>;

  const rows = await db.$queryRaw<
    { id: string; subjectId: string; subject: string; track: string; lang: string }[]
  >`
    SELECT DISTINCT ON (cc.id)
           cc.id, sub.id AS "subjectId", sub.name AS subject,
           t.code AS track, sub.language::text AS lang
      FROM content_chunks cc
      JOIN chapter_content_chunks l ON l.chunk_id = cc.id
      JOIN chapters c ON c.id = l.chapter_id
      JOIN subjects sub ON sub.id = c.subject_id
      JOIN tracks t ON t.id = sub.track_id
     WHERE cc.id = ANY(${Object.keys(raw)}::uuid[]) AND cc.embedding IS NOT NULL`;

  const bySubject = new Map<
    string,
    { label: string; lang: string; scores: number[]; missed: number }
  >();

  let done = 0;
  for (const row of rows) {
    const probe: Probe = { chunkId: row.id, query: raw[row.id]!, subjectId: row.subjectId };
    const hits = await searchContentChunks(await embed(probe.query, 'query'), [probe.subjectId], 20, probe.query);
    const own = hits.find((h) => h.id === probe.chunkId);

    const key = row.subjectId;
    const entry =
      bySubject.get(key) ?? { label: `${row.track} ${row.subject}`, lang: row.lang, scores: [], missed: 0 };
    if (own) entry.scores.push(own.similarity);
    else entry.missed += 1;
    bySubject.set(key, entry);

    done += 1;
    process.stdout.write(`\r  ${done}/${rows.length}`);
  }
  console.log('\n');

  const GATE = { ar: 0.45, fr: 0.5, en: 0.5 } as Record<string, number>;

  console.log('  where a subject\'s OWN passage scores, and what the gate demands\n');
  console.log(
    '  ' + 'subject'.padEnd(30) + 'n'.padStart(4) + 'p10'.padStart(8) + 'median'.padStart(8) +
      'p90'.padStart(8) + 'gate'.padStart(7) + '   under gate',
  );

  const ranked = [...bySubject.values()]
    .filter((e) => e.scores.length >= 3)
    .sort((a, b) => quantile(a.scores.slice().sort((x, y) => x - y), 0.1) -
      quantile(b.scores.slice().sort((x, y) => x - y), 0.1));

  for (const e of ranked) {
    const s = e.scores.slice().sort((a, b) => a - b);
    const gate = GATE[e.lang] ?? 0.5;
    const under = s.filter((v) => v < gate).length;
    const pct = Math.round((100 * under) / s.length);
    console.log(
      '  ' + e.label.padEnd(30) + String(s.length).padStart(4) +
        quantile(s, 0.1).toFixed(3).padStart(8) +
        quantile(s, 0.5).toFixed(3).padStart(8) +
        quantile(s, 0.9).toFixed(3).padStart(8) +
        gate.toFixed(2).padStart(7) +
        `   ${under}/${s.length} (${pct}%)`.padStart(16) +
        (pct >= 30 ? '  ← gate too strict here' : ''),
    );
  }
  console.log('');
  await db.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
