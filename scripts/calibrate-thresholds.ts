/**
 * Measures where this embedding model puts a right answer and a wrong one.
 *
 *   npm run calibrate
 *
 * The retrieval tiers are absolute similarity cut-offs, and a cut-off is only
 * meaningful for the model it was measured on. OpenAI's embeddings put unrelated
 * text near 0.2, so 0.72 separates cleanly. A local multilingual model puts
 * unrelated text near 0.83 — the same 0.72 would admit everything, and the
 * refusal that protects a student from a confident wrong answer would never
 * fire.
 *
 * So the thresholds are derived rather than guessed. The method:
 *
 *   - take a sample of real corpus chunks;
 *   - build a query from each of some of them, by lifting a distinctive
 *     sentence out of the chunk — a proxy for a student asking about that
 *     passage in their own words;
 *   - embed queries and chunks and score every pair;
 *   - record, per query, the score of its own chunk (a true positive) and the
 *     best score among all the others (the hardest negative available).
 *
 * A threshold that sits above most negatives and below most positives is the
 * one to use. Where those overlap, the corpus cannot support that tier at any
 * cut-off, and the report says so instead of proposing a number.
 */

import { PrismaClient } from '@prisma/client';

import { embedMany } from '../src/lib/ai/embeddings';
import { env } from '../src/lib/env';

const db = new PrismaClient();

const SAMPLE = Number(process.env.CALIBRATE_SAMPLE ?? 400);
const QUERIES = Number(process.env.CALIBRATE_QUERIES ?? 60);

/** A sentence long enough to identify the passage, short enough to be a query. */
function queryFrom(text: string): string | null {
  const body = text
    .split('\n\n')
    .slice(1)
    .join(' ')
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const sentences = body
    .split(/(?<=[.!?؟。])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 60 && s.length <= 300);

  return sentences[Math.floor(sentences.length / 2)] ?? null;
}

/**
 * Questions no Bac syllabus covers, in the three languages of the corpus.
 *
 * These are what the refusal tier exists for. A near-miss inside the corpus is
 * a different measurement: when a student asks about integration and the best
 * passage is a neighbouring chapter on derivatives, answering from it is
 * imperfect but not dangerous. Answering a question about football from a
 * chemistry chapter is. So the threshold that decides "say nothing" has to be
 * measured against genuinely foreign questions, not against near-misses.
 */
const OFF_SYLLABUS = [
  'How do I bake sourdough bread at home?',
  'What is the offside rule in football?',
  'Comment obtenir un visa pour le Canada ?',
  'Quel est le meilleur restaurant de Beyrouth ?',
  'كيف أطبخ الكبة النية؟',
  'ما هي أفضل طريقة لشراء سيارة مستعملة؟',
  'Who won the 2018 World Cup final?',
  'What is my horoscope for today?',
  'Explique-moi comment réparer une machine à laver.',
  'كم سعر صرف الدولار اليوم؟',
  'Write me a poem about my girlfriend.',
  'What should I wear to a wedding in July?',
  'How much does an iPhone cost in Lebanon?',
  'Quelle est la meilleure série sur Netflix en ce moment ?',
  'Comment changer un pneu de voiture ?',
  'ما هو أفضل موبايل للشراء هذه السنة؟',
  'متى يبدأ دوري كرة القدم الإنكليزي؟',
  'Can you help me write a CV for a waiter job?',
  'What time does the pharmacy close?',
  'Donne-moi une recette de tabbouleh.',
  'How do I get my driving licence renewed?',
  'Which airline flies from Beirut to Istanbul?',
  'ما هي أعراض الإنفلونزا وكيف أعالجها؟',
  'كيف أفتح حساب في المصرف؟',
  'What is the best way to learn guitar?',
  'Comment installer Windows sur un nouvel ordinateur ?',
  'Tell me a joke about cats.',
  'How do I fix a leaking tap?',
  'ما هي أفضل جامعة لدراسة الهندسة في لبنان؟',
  'Combien coûte un abonnement de gym ?',
];

function percentile(sorted: number[], q: number): number {
  if (!sorted.length) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]!;
}

function dot(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += a[i]! * b[i]!;
  return sum;
}

async function main() {
  const rows = await db.$queryRaw<{ id: string; content_text: string; title: string | null }[]>`
    SELECT id, content_text, title FROM content_chunks
    WHERE source_document_id IS NOT NULL
    ORDER BY random()
    LIMIT ${SAMPLE}
  `;
  if (rows.length < 50) {
    console.error(`Only ${rows.length} chunks in the corpus — load them first with npm run corpus:chunks.`);
    process.exitCode = 1;
    return;
  }

  const candidates = rows.map((r) => ({ ...r, query: queryFrom(r.content_text) })).filter((r) => r.query);
  const asked = candidates.slice(0, QUERIES);
  if (asked.length < 10) {
    console.error('Too few chunks yielded a usable query sentence.');
    process.exitCode = 1;
    return;
  }

  console.log(`provider ${env().EMBEDDING_PROVIDER} / ${env().EMBEDDING_MODEL}`);
  console.log(`scoring ${asked.length} queries against ${rows.length} chunks…`);

  // Embedded in batches: the local model holds every input in memory at once.
  const documents: number[][] = [];
  for (let i = 0; i < rows.length; i += 32) {
    const batch = rows.slice(i, i + 32);
    documents.push(...(await embedMany(batch.map((r) => `${r.title ?? ''}\n${r.content_text}`.trim()))));
  }
  const queries: number[][] = [];
  for (let i = 0; i < asked.length; i += 32) {
    queries.push(...(await embedMany(asked.slice(i, i + 32).map((r) => r.query!), 'query')));
  }

  /*
   * How far the best hit stands above the field.
   *
   * An absolute score is a statement about the model; this is a statement about
   * the query. A question the corpus covers has one passage that answers it and
   * the rest trailing behind. A question it does not cover matches everything
   * equally badly, so the top hit sits level with the twentieth. That shape
   * survives a model whose scores are all crowded into a narrow band, which is
   * exactly the position the free model leaves us in.
   */
  const lead = (q: number[]): { top: number; lead: number } => {
    const scores = documents.map((d) => dot(q, d)).sort((a, b) => b - a);
    const field = scores.slice(0, 20);
    return { top: scores[0]!, lead: scores[0]! - field[Math.floor(field.length / 2)]! };
  };

  const foreign = await embedMany(OFF_SYLLABUS, 'query');
  const foreignScored = foreign.map(lead);
  const foreignTop = foreignScored.map((s) => s.top);
  const foreignLead = foreignScored.map((s) => s.lead).sort((a, b) => a - b);

  const positives: number[] = [];
  const negatives: number[] = [];
  const realLead: number[] = [];
  let rankedFirst = 0;

  for (const [qi, row] of asked.entries()) {
    const q = queries[qi]!;
    let own = 0;
    let bestOther = -1;
    for (const [di, doc] of documents.entries()) {
      const score = dot(q, doc);
      if (rows[di]!.id === row.id) own = score;
      else if (score > bestOther) bestOther = score;
    }
    positives.push(own);
    negatives.push(bestOther);
    realLead.push(lead(q).lead);
    if (own > bestOther) rankedFirst += 1;
  }
  realLead.sort((a, b) => a - b);

  positives.sort((a, b) => a - b);
  negatives.sort((a, b) => a - b);
  foreignTop.sort((a, b) => a - b);

  const f = (n: number) => n.toFixed(3);
  console.log('');
  console.log(`  the passage the query came from ranked first: ${rankedFirst}/${asked.length}`);
  console.log('');
  console.log(`  on-syllabus, right passage   p5 ${f(percentile(positives, 0.05))}   median ${f(percentile(positives, 0.5))}   p95 ${f(percentile(positives, 0.95))}`);
  console.log(`  on-syllabus, nearest other   p5 ${f(percentile(negatives, 0.05))}   median ${f(percentile(negatives, 0.5))}   p95 ${f(percentile(negatives, 0.95))}`);
  console.log(`  OFF-syllabus, best hit       p5 ${f(percentile(foreignTop, 0.05))}   median ${f(percentile(foreignTop, 0.5))}   max ${f(foreignTop[foreignTop.length - 1]!)}`);

  /*
   * Tier 2 decides whether the assistant speaks at all, so it is set against
   * the off-syllabus questions: above every one of them, and below most real
   * ones. Sitting it above the highest foreign hit is what makes the refusal
   * mean something.
   */
  const concept = (percentile(positives, 0.1) + foreignTop[foreignTop.length - 1]!) / 2;
  /*
   * Tier 1 answers from another question's official solution, so a false fire
   * explains the wrong problem confidently. It is set above the near-misses,
   * not merely above the foreign questions.
   */
  const exact = Math.max(percentile(negatives, 0.9), percentile(positives, 0.5));

  console.log('');
  const separable = percentile(positives, 0.1) > foreignTop[foreignTop.length - 1]!;
  if (!separable) {
    console.log('  An off-syllabus question scores as high as a real one. No cut-off can');
    console.log('  tell them apart, and the refusal tier cannot be enforced on this model.');
  } else {
    console.log(`  Off-syllabus questions all land below ${f(foreignTop[foreignTop.length - 1]!)},`);
    console.log(`  real ones mostly above ${f(percentile(positives, 0.1))} — a threshold between them holds.`);
  }
  console.log(`  suggested CONCEPT_LEVEL_THRESHOLD  ${f(concept)}`);
  console.log(`  suggested EXACT_MATCH_THRESHOLD    ${f(exact)}`);

  console.log('');
  console.log('  how far the best hit stands above the field (top hit minus the median of the top 20):');
  console.log(`    real questions      p10 ${f(percentile(realLead, 0.1))}   median ${f(percentile(realLead, 0.5))}`);
  console.log(`    off-syllabus        median ${f(percentile(foreignLead, 0.5))}   max ${f(foreignLead[foreignLead.length - 1]!)}`);

  const leadGate = (percentile(realLead, 0.1) + foreignLead[foreignLead.length - 1]!) / 2;
  const leadSeparates = percentile(realLead, 0.1) > foreignLead[foreignLead.length - 1]!;
  console.log(
    leadSeparates
      ? `    separates cleanly — suggested RELEVANCE_LEAD ${f(leadGate)}`
      : '    does not separate on its own either.',
  );

  /*
   * Neither signal separates alone, so try them together.
   *
   * They fail differently. An off-syllabus question can score high in absolute
   * terms — the model finds everything vaguely similar — but it has no single
   * passage that answers it, so it has no lead. A near-duplicate inside the
   * corpus has a lead but a merely ordinary absolute score. Requiring both is
   * therefore stricter than either, and the search below asks whether any pair
   * of cut-offs admits real questions while admitting no foreign one at all.
   */
  const realPairs = asked.map((_, i) => ({ top: positives[i]!, lead: realLead[i]! }));
  const foreignPairs = foreignScored;

  let best: { top: number; lead: number; kept: number } | null = null;
  for (let t = 0.74; t <= 0.9; t += 0.005) {
    for (let l = 0; l <= 0.08; l += 0.002) {
      const foreignThrough = foreignPairs.filter((p) => p.top >= t && p.lead >= l).length;
      if (foreignThrough > 0) continue;
      const kept = realPairs.filter((p) => p.top >= t && p.lead >= l).length;
      if (!best || kept > best.kept) best = { top: t, lead: l, kept };
    }
  }

  console.log('');
  console.log('  requiring BOTH a score and a lead:');
  if (!best || best.kept === 0) {
    console.log('    no pair of cut-offs admits a real question while excluding every foreign one.');
  } else {
    const pct = Math.round((100 * best.kept) / realPairs.length);
    console.log(`    score >= ${f(best.top)} AND lead >= ${f(best.lead)}`);
    console.log(`    lets through ${best.kept}/${realPairs.length} real questions (${pct}%) and 0/${foreignPairs.length} off-syllabus ones.`);
  }
  console.log('');
  console.log('  Measured on the corpus. Confirm with npm run eval before trusting them.');
}

main()
  .catch((e) => {
    console.error('Calibration failed:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
