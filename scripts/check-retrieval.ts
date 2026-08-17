/**
 * Retrieval quality, subject by subject.
 *
 *   npm run check:retrieval
 *   npm run check:retrieval -- --per-subject 12
 *
 * The other checks ask whether the pipeline behaves: does it refuse what it
 * should, does it hand over material that explains. This one asks a narrower
 * question that they cannot — is the index equally good everywhere?
 *
 * It matters because this corpus is not uniform. It is three languages, and a
 * third of it is Arabic that arrived late, from three different readers, with
 * synthetic page numbers in places. An embedding model that handles French and
 * English well can be materially worse on Arabic morphology, and nothing built
 * so far would have shown it: every probe written by hand up to now has been in
 * English or French.
 *
 * Method — leave-one-out, per subject:
 *
 *   take a passage, lift a sentence from the middle of it, search that subject
 *   with the sentence, and see where the passage it came from ranks.
 *
 * The sample is deterministic — ordered by a hash of the row id rather than at
 * random — so two runs of this are comparable. With a random sample a five-point
 * move means nothing, and every change looks like an improvement if you rerun
 * until it does.
 *
 * A query lifted from the corpus is not what a student types, and a number here
 * is NOT a claim about answer quality. It is a comparison: the same unrealistic
 * query shape applied to every subject, so a subject that scores far below its
 * neighbours has an indexing problem rather than a phrasing problem.
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { PrismaClient } from '@prisma/client';

import { ai } from '../src/lib/ai';
import { embed } from '../src/lib/ai/embeddings';
import { env } from '../src/lib/env';
import { rerankByRelevance } from '../src/lib/rerank';
import { searchContentChunks } from '../src/lib/vector';

const db = new PrismaClient();

const TOP_K = Number(process.env.CHECK_TOP_K ?? 5);

const PROBE_CACHE = path.resolve(__dirname, '..', 'corpus', 'retrieval-probes.json');

/*
 * Two ways to build a probe, and the difference decides what the number means.
 *
 *   sentence    a sentence copied out of the passage. Free, deterministic, and
 *               worthless for judging a term index: an exact string is exactly
 *               what a term index finds. Fine for comparing subjects against
 *               each other, since every subject is flattered equally.
 *
 *   question    what a student would actually type, written once by the cheap
 *               model from the passage and cached on disk. Costs a few cents the
 *               first time and nothing afterwards. This is the honest test: the
 *               words mostly differ from the passage, so a hit has to be earned.
 *
 * Measuring lexical search with sentence probes reported an enormous gain that
 * was mostly the benchmark grading itself.
 */
type Probe = { id: string; query: string };

async function askForQuestion(passage: string, language: string): Promise<string | null> {
  const named = language === 'fr' ? 'French' : language === 'ar' ? 'Arabic' : 'English';
  try {
    const response = await ai().complete({
      system:
        'You write one short exam-revision question that the given passage answers. ' +
        'Write it the way a student would type it, in ' + named + '. ' +
        'Do not quote the passage. Do not copy its phrasing. Reply with the question only.',
      messages: [{ role: 'user', content: passage.slice(0, 2500) }],
      maxTokens: 200,
      effort: 'low',
      model: env().OPENAI_MODEL_VERIFY,
    });
    const text = response.text.trim().split(String.fromCharCode(10))[0]?.trim() ?? '';
    return text.length > 8 ? text : null;
  } catch {
    return null;
  }
}

/** A sentence long enough to identify its passage, short enough to be a query. */
function queryFrom(text: string): string | null {
  const body = text
    .split('\n\n')
    .slice(1)
    .join(' ')
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')
    .replace(/!\[\]\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const sentences = body
    .split(/(?<=[.!?؟،؛])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 50 && s.length <= 260);

  return sentences[Math.floor(sentences.length / 2)] ?? null;
}

function bar(rate: number): string {
  const filled = Math.round(rate * 20);
  return '█'.repeat(filled) + '·'.repeat(20 - filled);
}

async function main() {
  const args = process.argv.slice(2);
  const perSubject = args.includes('--per-subject')
    ? Number(args[args.indexOf('--per-subject') + 1])
    : 10;
  const asQuestions = args.includes('--questions');
  const mode = args.includes('--mode') ? args[args.indexOf('--mode') + 1] : 'hybrid';
  const rerank = args.includes('--rerank');

  let cache: Record<string, string> = {};
  if (asQuestions) {
    try {
      cache = JSON.parse(await readFile(PROBE_CACHE, 'utf8')) as Record<string, string>;
    } catch {
      cache = {};
    }
  }
  let written = 0;

  const subjects = await db.subject.findMany({
    where: { trackId: { not: null } },
    select: { id: true, name: true, language: true, track: { select: { code: true } } },
    orderBy: [{ name: 'asc' }],
  });

  type Row = {
    label: string;
    language: string;
    probes: number;
    top1: number;
    topK: number;
    passages: number;
  };
  const rows: Row[] = [];

  for (const subject of subjects) {
    const chunks = await db.$queryRaw<{ id: string; content_text: string }[]>`
      SELECT cc.id, cc.content_text
      FROM content_chunks cc
      JOIN chapter_content_chunks l ON l.chunk_id = cc.id
      JOIN chapters ch ON ch.id = l.chapter_id
      WHERE ch.subject_id = ${subject.id}::uuid AND cc.embedding IS NOT NULL
      ORDER BY md5(cc.id::text)
      LIMIT ${perSubject * 3}
    `;
    if (chunks.length < 4) continue;

    let probes: Probe[];
    if (asQuestions) {
      probes = [];
      for (const chunk of chunks) {
        if (probes.length >= perSubject) break;
        let query = cache[chunk.id];
        if (!query) {
          const asked = await askForQuestion(chunk.content_text, subject.language);
          if (!asked) continue;
          cache[chunk.id] = asked;
          query = asked;
          written += 1;
        }
        probes.push({ id: chunk.id, query });
      }
    } else {
      probes = chunks
        .map((c) => ({ id: c.id, query: queryFrom(c.content_text) }))
        .filter((p): p is Probe => Boolean(p.query))
        .slice(0, perSubject);
    }
    if (probes.length < 3) continue;

    let top1 = 0;
    let topK = 0;
    for (const probe of probes) {
      /*
       * With --rerank, fetch a wider candidate set and let the model order it,
       * exactly as retrieval would. Comparing a reranked top-5 against an
       * unreranked top-5 drawn from the same 5 candidates would measure nothing:
       * reranking earns its place by promoting a passage from rank 12.
       */
      const fetched = await searchContentChunks(
        await embed(probe.query, 'query'),
        [subject.id],
        rerank ? 20 : TOP_K,
        mode === 'vector' ? undefined : probe.query,
      );
      const hits = rerank ? await rerankByRelevance(probe.query, fetched, TOP_K) : fetched;
      const rank = hits.findIndex((h) => h.id === probe.id);
      if (rank === 0) top1 += 1;
      if (rank >= 0) topK += 1;
    }

    const counted = await db.$queryRaw<{ count: bigint }[]>`
      SELECT count(DISTINCT l.chunk_id) AS count
      FROM chapter_content_chunks l
      JOIN chapters ch ON ch.id = l.chapter_id
      WHERE ch.subject_id = ${subject.id}::uuid
    `;
    const count = counted[0]?.count ?? 0n;

    rows.push({
      label: `${subject.track!.code} ${subject.name}`,
      language: subject.language,
      probes: probes.length,
      top1,
      topK,
      passages: Number(count),
    });
  }

  rows.sort((a, b) => a.topK / a.probes - b.topK / b.probes);

  console.log('');
  console.log(`  ${'subject'.padEnd(30)}${'lang'.padEnd(6)}${'passages'.padStart(9)}${'top-1'.padStart(8)}${`top-${TOP_K}`.padStart(8)}`);
  console.log('  ' + '-'.repeat(82));
  for (const row of rows) {
    const rate = row.topK / row.probes;
    console.log(
      `  ${row.label.slice(0, 29).padEnd(30)}${row.language.padEnd(6)}${String(row.passages).padStart(9)}` +
        `${`${row.top1}/${row.probes}`.padStart(8)}${`${row.topK}/${row.probes}`.padStart(8)}  ${bar(rate)}`,
    );
  }

  // Grouped by language, which is the comparison this exists to make.
  console.log('');
  for (const language of ['fr', 'en', 'ar']) {
    const group = rows.filter((r) => r.language === language);
    if (!group.length) continue;
    const probes = group.reduce((n, r) => n + r.probes, 0);
    const top1 = group.reduce((n, r) => n + r.top1, 0);
    const topK = group.reduce((n, r) => n + r.topK, 0);
    console.log(
      `  ${language}: ${group.length} subjects, ${probes} probes — ` +
        `top-1 ${Math.round((100 * top1) / probes)}%, top-${TOP_K} ${Math.round((100 * topK) / probes)}%`,
    );
  }

  console.log('');
  console.log(
    `  probes: ${asQuestions ? 'student-style questions' : 'sentences copied from the passage'}` +
      `   ranking: ${mode === 'vector' ? 'vector only' : 'vector + term index'}`,
  );
  if (written) {
    await writeFile(PROBE_CACHE, JSON.stringify(cache, null, 1), 'utf8');
    console.log(`  ${written} new question(s) written to corpus/retrieval-probes.json`);
  }

  const weak = rows.filter((r) => r.topK / r.probes < 0.7);
  if (weak.length) {
    console.log('');
    console.log('  below 70% — a passage often does not rank for a sentence taken out of it:');
    for (const row of weak) console.log(`    ${row.label} (${row.language}), ${row.passages} passages`);
  }
}

main()
  .catch((e) => {
    console.error('Check failed:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
