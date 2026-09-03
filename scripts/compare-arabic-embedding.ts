import OpenAI from 'openai';

import { db } from '../src/lib/db';
import { env } from '../src/lib/env';

/**
 * Would the free multilingual model separate Arabic where OpenAI's does not?
 *
 *   npm run compare:arabic
 *   npm run compare:arabic -- --sample 300
 *
 * `check:refusal` measures the decision the pipeline actually makes and reports
 * four Arabic errors that no threshold can remove: on-syllabus questions score
 * 0.452 to 0.686 and off-syllabus ones reach 0.563, so the two populations
 * overlap and any cut-off trades a wrong answer for a wrong refusal.
 *
 * The obvious next move is a different embedding, and the obvious way to test it
 * is to re-embed the corpus and re-run the check — which is hours of CPU for an
 * answer that might be no. This asks the same question on a sample instead: take
 * the questions a student would type, take a sample of Arabic passages, embed
 * both with each model, and measure how far apart the two populations sit.
 *
 * The measure is the gap between the highest-scoring off-syllabus question and
 * the lowest-scoring on-syllabus one. Positive means a threshold exists that
 * puts every question on the right side. Negative is the overlap, and its size
 * is how wrong the model is about this corpus.
 *
 * Nothing is written. This decides whether the re-embedding is worth starting.
 */
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const SAMPLE = Number(arg('--sample')) || 250;

/** The same probes `check:refusal` uses, so the two are comparable. */
const OFF_SYLLABUS = [
  'كيف أخبز الخبز في المنزل؟',
  'ما هو أفضل مطعم في بيروت؟',
  'من فاز بكأس العالم عام ٢٠١٨؟',
  'كيف أصلح حنفية تنقط؟',
  'كم يكلف الآيفون في لبنان؟',
  'كيف أجدد جواز سفري؟',
  'ما هي أفضل طريقة لتعلم العزف على الجيتار؟',
  'أعطني وصفة التبولة.',
  'ماذا ألبس في حفل زفاف في تموز؟',
  'ما هو أفضل مسلسل على نتفليكس؟',
];

const ON_SYLLABUS = [
  'ما هو تعريف الدولة في التربية الوطنية؟',
  'اشرح مفهوم الحرية عند الفلاسفة.',
  'ما هي أسباب الحرب العالمية الأولى؟',
  'عرّف الوعي واللاوعي في الفلسفة.',
  'ما هي خصائص المناخ في لبنان؟',
  'ما الفرق بين السلطة التشريعية والسلطة التنفيذية؟',
  'اشرح النزعة الإنسانية في الأدب العربي.',
  'ما هو دور الجامعة العربية؟',
  'كيف نحلل نصًا شعريًا؟',
  'ما هي مبادئ الديمقراطية؟',
];

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
    na += (a[i] ?? 0) ** 2;
    nb += (b[i] ?? 0) ** 2;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

async function embedOpenAI(texts: string[], model: string): Promise<number[][]> {
  const client = new OpenAI({ apiKey: env().OPENAI_API_KEY });
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 64) {
    const r = await client.embeddings.create({ model, input: texts.slice(i, i + 64) });
    out.push(...r.data.map((d) => d.embedding as number[]));
  }
  return out;
}

/**
 * e5 is trained with `query:` and `passage:` prefixes and scores badly without
 * them — the same mistake would make the free model look worse than it is and
 * end the investigation for the wrong reason.
 */
async function embedLocal(texts: string[], asQuery: boolean): Promise<number[][]> {
  const { pipeline } = (await import('@huggingface/transformers')) as {
    pipeline: (task: string, model: string) => Promise<
      (input: string[], opts: { pooling: string; normalize: boolean }) => Promise<{ tolist(): number[][] }>
    >;
  };
  const extract = await pipeline('feature-extraction', 'Xenova/multilingual-e5-base');
  const prefixed = texts.map((t) => `${asQuery ? 'query' : 'passage'}: ${t}`);
  const out: number[][] = [];
  for (let i = 0; i < prefixed.length; i += 16) {
    const res = await extract(prefixed.slice(i, i + 16), { pooling: 'mean', normalize: true });
    out.push(...res.tolist());
  }
  return out;
}

function report(name: string, off: number[], on: number[]) {
  const offMax = Math.max(...off);
  const onMin = Math.min(...on);
  const gap = onMin - offMax;
  console.log(`\n  ${name}`);
  console.log(`    off-syllabus  ${Math.min(...off).toFixed(3)} … ${offMax.toFixed(3)}`);
  console.log(`    on-syllabus   ${onMin.toFixed(3)} … ${Math.max(...on).toFixed(3)}`);
  console.log(
    gap > 0
      ? `    SEPARABLE — gap ${gap.toFixed(3)}, threshold anywhere in (${offMax.toFixed(3)}, ${onMin.toFixed(3)})`
      : `    NOT separable — overlap ${(-gap).toFixed(3)}`,
  );
}

async function main() {
  const rows = await db.$queryRaw<{ content_text: string }[]>`
    SELECT cc.content_text
      FROM content_chunks cc
      JOIN source_documents sd ON sd.id = cc.source_document_id
     WHERE sd.language = 'ar' AND length(cc.content_text) > 300
     ORDER BY md5(cc.id::text)
     LIMIT ${SAMPLE}`;

  console.log(`  Arabic passages sampled: ${rows.length}`);
  if (rows.length === 0) {
    console.log('  No Arabic course material found — nothing to measure against.');
    await db.$disconnect();
    return;
  }
  const passages = rows.map((r) => r.content_text.slice(0, 1500));

  for (const model of ['text-embedding-3-small', 'text-embedding-3-large']) {
    const [p, off, on] = await Promise.all([
      embedOpenAI(passages, model),
      embedOpenAI(OFF_SYLLABUS, model),
      embedOpenAI(ON_SYLLABUS, model),
    ]);
    const best = (q: number[]) => Math.max(...p.map((v) => cosine(q, v)));
    report(`openai · ${model}`, off.map(best), on.map(best));
  }

  console.log('\n  loading multilingual-e5-base (first run downloads ~1GB)…');
  const p = await embedLocal(passages, false);
  const off = await embedLocal(OFF_SYLLABUS, true);
  const on = await embedLocal(ON_SYLLABUS, true);
  const best = (q: number[]) => Math.max(...p.map((v) => cosine(q, v)));
  report('local · multilingual-e5-base (free)', off.map(best), on.map(best));

  await db.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
