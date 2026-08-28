/**
 * Is a different embedding model better for THIS corpus?
 *
 *   npm run compare:embeddings
 *   npm run compare:embeddings -- --models text-embedding-3-small,text-embedding-3-large
 *   npm run compare:embeddings -- --sample 150
 *
 * Two measures, because "better" has to mean something checkable.
 *
 * 1. THE PER-LANGUAGE NOISE FLOOR. Unrelated text does not score the same in
 *    every language. Measured on text-embedding-3-small over this corpus,
 *    random passage pairs average 0.217 in English, 0.282 in Arabic and 0.292
 *    in French. `CONCEPT_LEVEL_THRESHOLD` is ONE number for all three, so it
 *    asks English to clear its own floor by 0.233 and French by 0.158 — the
 *    same code applying a different standard depending on which edition the
 *    student sits. A model whose floors are closer together needs less of that
 *    correction; a model whose floors are further apart needs more.
 *
 *    This also explains a finding that was nearly reported as one: English
 *    editions score ~0.06 below their French counterparts on identical books
 *    with identical coverage. That is the floor, not the retrieval.
 *
 * 2. CROSS-LINGUAL ALIGNMENT, which is the part that is real ground truth and
 *    costs nothing to obtain. Four subjects in this corpus are the same book in
 *    two languages — Chemistry/Chimie, Physics/Physique, Mathematics/
 *    Mathematiques, Life Sciences/Sciences de la vie — and chapter N of one is
 *    chapter N of the other. So a passage and its translation SHOULD be near
 *    neighbours, and a model that fails to put them together will never answer
 *    an Arabic or French question out of the English half of a shared syllabus.
 *
 *    Reported against the same-language baseline, because a model that scores
 *    everything high scores translations high too. What matters is the gap.
 *
 * Nothing is written and no column is touched. Switching model means
 * `npm run vector:resize`, which re-embeds the whole corpus; this exists to
 * decide whether that is worth doing.
 */

import OpenAI from 'openai';

import { db } from '@/lib/db';
import { env } from '@/lib/env';

const argv = process.argv.slice(2);
const arg = (n: string) => {
  const i = argv.indexOf(n);
  return i === -1 ? null : argv[i + 1] ?? null;
};
const MODELS = (arg('--models') ?? 'text-embedding-3-small,text-embedding-3-large').split(',');
const SAMPLE = Number(arg('--sample')) || 120;

type Chunk = { id: string; text: string; lang: string; subject: string; orderIndex: number };

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

/** OpenAI returns unit vectors, so the dot product is the cosine. */
async function embedAll(client: OpenAI, model: string, texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 96) {
    const batch = texts.slice(i, i + 96).map((t) => t.slice(0, 6000));
    const r = await client.embeddings.create({ model, input: batch });
    out.push(...r.data.map((d) => d.embedding as number[]));
  }
  return out;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

async function main() {
  const key = env().OPENAI_API_KEY;
  if (!key) {
    console.error('OPENAI_API_KEY is not set.');
    process.exit(1);
  }
  const client = new OpenAI({ apiKey: key, maxRetries: 3 });

  // --- the language sample, for the noise floor -----------------------------
  const perLang = await db.$queryRaw<Chunk[]>`
    SELECT * FROM (
      SELECT DISTINCT ON (cc.id) cc.id, cc.content_text AS text,
             sub.language::text AS lang, sub.name AS subject, c.order_index AS "orderIndex",
             row_number() OVER (PARTITION BY sub.language ORDER BY md5(cc.id::text)) AS rn
        FROM content_chunks cc
        JOIN chapter_content_chunks l ON l.chunk_id = cc.id
        JOIN chapters c ON c.id = l.chapter_id
        JOIN subjects sub ON sub.id = c.subject_id
       WHERE cc.embedding IS NOT NULL AND length(cc.content_text) > 400
    ) t WHERE rn <= ${SAMPLE}`;

  /*
   * The translation pairs. Chapter N of Chemistry is chapter N of Chimie: the
   * two editions are the same book, so the pairing needs no model to establish
   * and cannot be accused of agreeing with the thing it measures.
   */
  const pairs = await db.$queryRaw<{ en: string; fr: string; subject: string }[]>`
    WITH one AS (
      SELECT DISTINCT ON (sub.name, c.order_index)
             sub.name AS subject, c.order_index AS idx, sub.language::text AS lang,
             cc.content_text AS text
        FROM content_chunks cc
        JOIN chapter_content_chunks l ON l.chunk_id = cc.id
        JOIN chapters c ON c.id = l.chapter_id
        JOIN subjects sub ON sub.id = c.subject_id
       WHERE length(cc.content_text) > 600
       ORDER BY sub.name, c.order_index, md5(cc.id::text)
    )
    SELECT e.text AS en, f.text AS fr, e.subject
      FROM one e JOIN one f ON f.idx = e.idx
     WHERE (e.subject, f.subject) IN (
             ('Chemistry','Chimie'), ('Physics','Physique'),
             ('Mathematics','Mathematiques'), ('Life Sciences','Sciences de la vie'))
     LIMIT 60`;

  console.log(`\n  ${perLang.length} passages sampled, ${pairs.length} translation pairs.\n`);

  for (const model of MODELS) {
    console.log(`\n=== ${model} ===`);
    const vecs = await embedAll(client, model, perLang.map((c) => c.text));
    const byLang = new Map<string, number[][]>();
    perLang.forEach((c, i) => byLang.set(c.lang, [...(byLang.get(c.lang) ?? []), vecs[i]!]));

    const floors = new Map<string, number>();
    for (const [lang, vs] of byLang) {
      const sims: number[] = [];
      for (let i = 0; i < vs.length; i++) {
        for (let j = i + 1; j < vs.length; j++) sims.push(dot(vs[i]!, vs[j]!));
      }
      floors.set(lang, mean(sims));
    }
    const vals = [...floors.values()];
    console.log('  noise floor, unrelated same-language pairs:');
    for (const [lang, v] of [...floors.entries()].sort((a, b) => a[1] - b[1])) {
      console.log(`    ${lang}   ${v.toFixed(3)}   (n=${byLang.get(lang)!.length})`);
    }
    const spread = Math.max(...vals) - Math.min(...vals);
    console.log(`    SPREAD ${spread.toFixed(3)}   <- lower is better: one threshold fits all three`);

    if (pairs.length) {
      const en = await embedAll(client, model, pairs.map((p) => p.en));
      const fr = await embedAll(client, model, pairs.map((p) => p.fr));
      const aligned = pairs.map((_, i) => dot(en[i]!, fr[i]!));
      // Mismatched control: chapter i of one against chapter i+1 of the other.
      const control = pairs.map((_, i) => dot(en[i]!, fr[(i + 1) % pairs.length]!));
      const a = mean(aligned);
      const c = mean(control);
      console.log('  cross-lingual alignment (same chapter, en vs fr):');
      console.log(`    matched chapters    ${a.toFixed(3)}`);
      console.log(`    mismatched control  ${c.toFixed(3)}`);
      console.log(`    LIFT ${(a - c).toFixed(3)}   <- higher is better: it can tell a translation from a stranger`);
    }
  }
  console.log('');
  await db.$disconnect();
}

main();
