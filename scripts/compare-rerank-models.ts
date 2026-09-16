/**
 * Is reranking bad for French, or is the cheap model bad for French?
 *
 *   npm run compare:rerank
 *   npm run compare:rerank -- --limit 80
 *
 * `retrieval.ts` reranks Arabic questions and nothing else, on this measurement:
 *
 *              top-1
 *     ar   28% -> 48%
 *     en   48% -> 46%
 *     fr   52% -> 39%
 *
 * Doubling Arabic and losing thirteen points of French is a good reason not to
 * rerank French. It is not a reason to conclude that reading the passages
 * cannot help French, because the reader in that measurement was
 * OPENAI_MODEL_VERIFY — the cheap model — at low effort, seeing 300-character
 * openings. Those are three separate choices and none of them was varied.
 *
 * OpenAI has no better EMBEDDING to switch to: the API offers 3-small, 3-large
 * and ada-002, and 3-large measured no better on this corpus (spread 0.061 vs
 * 0.054, cross-lingual lift 0.077 vs 0.075). So if there is headroom left
 * inside this provider it is in the reading, not in the vectors, and this is
 * where to look for it.
 *
 * GROUND TRUTH is `corpus/retrieval-probes.json`: student-style questions
 * cached against the passage each was generated from, which is the same set the
 * original figures came from. Not real student questions — a real measurement
 * still needs `judge:passages` — but it is consistent between arms, which is
 * what a comparison needs.
 *
 * Reports top-1 per language per arm. Nothing is written.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { embed } from '@/lib/ai/embeddings';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { rerankByRelevance, type RerankOptions } from '@/lib/rerank';
import { searchContentChunks } from '@/lib/vector';

const argv = process.argv.slice(2);
const arg = (n: string) => {
  const i = argv.indexOf(n);
  return i === -1 ? null : argv[i + 1] ?? null;
};
// Capped by default: every probe costs one model call PER ARM, and an arm on
// the main model at medium effort is not a cheap call. A full-corpus run is a
// deliberate choice — pass --limit 0 — not something you get by forgetting.
const LIMIT = argv.includes('--limit') ? Number(arg('--limit')) : 40;
/*
 * One language, and only the arms named.
 *
 * Added because the first four-arm run answered the question it was built for
 * and raised a sharper one it could not answer: Arabic got 7 of the 40 probes,
 * and on those 7 the CURRENT production setting scored below no reranking at
 * all — against a comment in `retrieval.ts` claiming it nearly doubles Arabic.
 * Seven probes cannot tell those apart, and the probe set holds 59.
 *
 * Narrowing to one language and two arms turns a $2 run into a $0.15 one, which
 * is the difference between being able to check a live policy and not.
 */
const LANG = arg('--lang');
const ARM_FILTER = arg('--arms');
const FIELD = 20;
const KEEP = 8;
/*
 * How many passages the tutor is actually handed — `HANDED_OVER` in
 * retrieval.ts. Reported alongside top-1 because top-1 is not the number that
 * decides whether a question can be answered, and reading it as though it were
 * is what made reranking look worth doing.
 *
 * The model reads all twelve. Whether the right passage is FIRST is cosmetic;
 * whether it is IN THERE is the whole thing. Reordering twelve passages cannot
 * change which twelve they are, which is why every rerank arm moved top-1 a
 * long way and coverage barely at all.
 */
const HANDED_OVER = 12;

type Probe = { chunkId: string; query: string; subjectId: string; lang: string };

async function main() {
  const raw = JSON.parse(
    readFileSync(path.join(process.cwd(), 'corpus', 'retrieval-probes.json'), 'utf8'),
  ) as Record<string, string>;

  const ids = Object.keys(raw);
  const rows = await db.$queryRaw<{ id: string; subjectId: string; lang: string }[]>`
    SELECT DISTINCT ON (cc.id) cc.id, sub.id AS "subjectId", sub.language::text AS lang
      FROM content_chunks cc
      JOIN chapter_content_chunks l ON l.chunk_id = cc.id
      JOIN chapters c ON c.id = l.chapter_id
      JOIN subjects sub ON sub.id = c.subject_id
     WHERE cc.id = ANY(${ids}::uuid[]) AND cc.embedding IS NOT NULL`;

  let probes: Probe[] = rows.map((r) => ({
    chunkId: r.id, query: raw[r.id]!, subjectId: r.subjectId, lang: r.lang,
  }));
  // Filtered before the limit, so `--lang ar --limit 0` is every Arabic probe
  // rather than whichever Arabic probes survived a slice taken across all three.
  if (LANG) probes = probes.filter((p) => p.lang === LANG);
  if (LIMIT > 0) probes = probes.slice(0, LIMIT);

  const ALL_ARMS: { name: string; opts: RerankOptions | null }[] = [
    { name: 'no rerank (embedding order)', opts: null },
    { name: `${env().OPENAI_MODEL_VERIFY} @ low   (current)`, opts: { effort: 'low' } },
    { name: `${env().OPENAI_MODEL} @ low`, opts: { model: env().OPENAI_MODEL, effort: 'low' } },
    { name: `${env().OPENAI_MODEL} @ medium`, opts: { model: env().OPENAI_MODEL, effort: 'medium' } },
  ];
  // `--arms 0,1` by position. The no-rerank arm costs nothing and is the
  // baseline every other arm is read against, so dropping it saves no money and
  // makes the rest unreadable; include it unless you know why you are not.
  const ARMS = ARM_FILTER
    ? ARM_FILTER.split(',').map((i) => ALL_ARMS[Number(i)]!).filter(Boolean)
    : ALL_ARMS;

  const score = new Map<string, Map<string, { hit: number; n: number }>>();
  const bump = (arm: string, lang: string, hit: boolean) => {
    const m = score.get(arm) ?? new Map();
    const c = m.get(lang) ?? { hit: 0, n: 0 };
    c.n++;
    if (hit) c.hit++;
    m.set(lang, c);
    score.set(arm, m);
  };

  // Coverage does not depend on the arm — reordering cannot change membership —
  // so it is counted once per probe, outside the arm loop.
  const cover = new Map<string, { hit: number; n: number }>();

  let done = 0;
  for (const p of probes) {
    const hits = await searchContentChunks(await embed(p.query, 'query'), [p.subjectId], FIELD, p.query);
    if (!hits.length) continue;

    const c = cover.get(p.lang) ?? { hit: 0, n: 0 };
    c.n += 1;
    if (hits.slice(0, HANDED_OVER).some((h) => h.id === p.chunkId)) c.hit += 1;
    cover.set(p.lang, c);

    for (const arm of ARMS) {
      const ordered = arm.opts
        ? await rerankByRelevance(p.query, hits, KEEP, arm.opts)
        : hits.slice(0, KEEP);
      bump(arm.name, p.lang, ordered[0]?.id === p.chunkId);
    }
    done++;
    process.stdout.write(`\r  ${done}/${probes.length}`);
  }
  console.log('\n');

  const langs = [...new Set(probes.map((p) => p.lang))].sort();
  console.log('  top-1: the passage the question was written from, ranked first\n');
  console.log('  ' + 'arm'.padEnd(38) + langs.map((l) => l.padStart(9)).join('') + '      all');
  for (const arm of ARMS) {
    const m = score.get(arm.name);
    if (!m) continue;
    let hit = 0, n = 0;
    const cells = langs.map((l) => {
      const c = m.get(l);
      if (!c || !c.n) return '        -';
      hit += c.hit; n += c.n;
      return `${Math.round((100 * c.hit) / c.n)}% (${c.n})`.padStart(9);
    });
    console.log('  ' + arm.name.padEnd(38) + cells.join('') + `${Math.round((100 * hit) / Math.max(n, 1))}%`.padStart(9));
  }

  /*
   * The number that decides whether a question is answerable at all, printed
   * under the one that does not. Same for every arm by construction.
   */
  let ch = 0, cn = 0;
  const coverCells = langs.map((l) => {
    const c = cover.get(l);
    if (!c || !c.n) return '        -';
    ch += c.hit; cn += c.n;
    return `${Math.round((100 * c.hit) / c.n)}% (${c.n})`.padStart(9);
  });
  console.log('');
  console.log(`  in the ${HANDED_OVER} passages handed to the tutor — what actually decides answerability\n`);
  console.log('  ' + 'any arm (order cannot change this)'.padEnd(38) + coverCells.join('') +
    `${Math.round((100 * ch) / Math.max(cn, 1))}%`.padStart(9));
  console.log('');
  await db.$disconnect();
}

main();
