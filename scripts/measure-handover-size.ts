import { readFileSync } from 'node:fs';
import path from 'node:path';

import { embed } from '@/lib/ai/embeddings';
import { db } from '@/lib/db';
import { searchContentChunks } from '@/lib/vector';

/**
 * How many passages the tutor actually needs.
 *
 *   npm run measure:handover
 *
 * `HANDED_OVER` in retrieval.ts is 12, and those twelve passages are the bulk of
 * every answer's prompt — the dominant cost of the dominant call. The comment
 * defending the number says it is "measured protection for Arabic", and the
 * measurement behind it was a TOP-1 figure: the right passage was ranked third
 * in Arabic, so more passages were handed over to compensate.
 *
 * Top-1 is the wrong number for this question. The model reads all twelve, so
 * what matters is whether the right passage is IN there — coverage — and
 * coverage is what this measures, at every size from 4 to 16.
 *
 * WHAT A SIZE COSTS. Passages run ~600 tokens each in the prompt, so every one
 * dropped is ~600 fewer input tokens on a call priced at $5/Mtok. Across a
 * national user base that is the difference between a viable margin and not.
 *
 * WHAT A SIZE BUYS is the last column: the share of questions whose answer is
 * actually in front of the model. A question whose passage is missing does not
 * get a worse answer — it gets a refusal or an answer grounded in the wrong
 * material, which is the failure this whole pipeline exists to prevent.
 *
 * Costs nothing to run: one embedding per probe, no model calls.
 */

const PROBES = path.join(process.cwd(), 'corpus', 'retrieval-probes.json');
const SIZES = [4, 6, 8, 10, 12, 14, 16];
/** What one passage adds to the prompt, measured from the corpus below. */
const FIELD = 20;

type Probe = { chunkId: string; query: string; subjectId: string; lang: string };

async function main() {
  const raw = JSON.parse(readFileSync(PROBES, 'utf8')) as Record<string, string>;
  const ids = Object.keys(raw);

  const rows = await db.$queryRaw<{ id: string; subjectId: string; lang: string }[]>`
    SELECT DISTINCT ON (cc.id) cc.id, sub.id AS "subjectId", sub.language::text AS lang
      FROM content_chunks cc
      JOIN chapter_content_chunks l ON l.chunk_id = cc.id
      JOIN chapters c ON c.id = l.chapter_id
      JOIN subjects sub ON sub.id = c.subject_id
     WHERE cc.id = ANY(${ids}::uuid[]) AND cc.embedding IS NOT NULL`;

  const probes: Probe[] = rows.map((r) => ({
    chunkId: r.id,
    query: raw[r.id]!,
    subjectId: r.subjectId,
    lang: r.lang,
  }));

  /** Mean characters of the passages actually handed over, for the token estimate. */
  let charTotal = 0;
  let charCount = 0;

  // hit[size][lang] = how many probes had their passage inside that many.
  const hit = new Map<number, Map<string, number>>();
  const seen = new Map<string, number>();
  for (const size of SIZES) hit.set(size, new Map());

  let done = 0;
  for (const p of probes) {
    const hits = await searchContentChunks(await embed(p.query, 'query'), [p.subjectId], FIELD, p.query);
    if (!hits.length) continue;

    seen.set(p.lang, (seen.get(p.lang) ?? 0) + 1);
    for (const h of hits.slice(0, 12)) {
      charTotal += h.contentText.length;
      charCount += 1;
    }

    for (const size of SIZES) {
      if (hits.slice(0, size).some((h) => h.id === p.chunkId)) {
        const m = hit.get(size)!;
        m.set(p.lang, (m.get(p.lang) ?? 0) + 1);
      }
    }
    done += 1;
    process.stdout.write(`\r  ${done}/${probes.length}`);
  }
  console.log('\n');

  const langs = [...seen.keys()].sort();
  const totalProbes = [...seen.values()].reduce((a, b) => a + b, 0);
  const meanChars = charCount === 0 ? 0 : charTotal / charCount;
  // ~4 characters per token for Latin text; Arabic runs denser, so this
  // UNDERSTATES the Arabic saving rather than overstating it.
  const tokensPerPassage = Math.round(meanChars / 4);

  console.log(`  mean passage ≈ ${Math.round(meanChars)} chars ≈ ${tokensPerPassage} tokens\n`);
  console.log(
    '  ' + 'handed over'.padEnd(13) + langs.map((l) => l.padStart(9)).join('') +
      'all'.padStart(9) + 'prompt'.padStart(10) + '$/1k answers'.padStart(14),
  );

  for (const size of SIZES) {
    const m = hit.get(size)!;
    let total = 0;
    const cells = langs.map((l) => {
      const n = seen.get(l) ?? 0;
      const h = m.get(l) ?? 0;
      total += h;
      return n === 0 ? '        -' : `${Math.round((100 * h) / n)}%`.padStart(9);
    });

    const promptTokens = size * tokensPerPassage;
    // Generation only, at the default model's input rate. Output is unaffected
    // by how many passages went in, so it is left out rather than guessed at.
    const per1k = (promptTokens * 5) / 1_000_000 * 1000;

    const marker = size === 12 ? '  ← today' : '';
    console.log(
      '  ' + String(size).padEnd(13) + cells.join('') +
        `${Math.round((100 * total) / Math.max(totalProbes, 1))}%`.padStart(9) +
        `${promptTokens.toLocaleString()}`.padStart(10) +
        `$${per1k.toFixed(2)}`.padStart(14) + marker,
    );
  }

  console.log(
    '\n  coverage = the passage the question was written from is among those handed over.\n' +
      '  The model reads all of them, so this is what decides whether an answer is possible.\n',
  );
  await db.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
