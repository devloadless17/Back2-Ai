/**
 * Would expanding a question into the concepts it tests find better material?
 *
 *   npm run measure:concept-expansion -- --sample 150
 *   npm run measure:concept-expansion -- --sample 60 --kind concept
 *
 * A Lebanese exam exercise is titled by its SCENARIO and a textbook chapter is
 * named by its CONCEPT, so the two meet only where their vocabulary happens to
 * overlap. "Un cas de thyroïdite. Sarah présente un gonflement au cou" retrieves
 * `Evolution humaine` at 0.396 — under the 0.45 gate, so the student is told
 * their own syllabus does not cover it. Expanded to "régulation hormonale,
 * thyroïde, rétrocontrôle" the same corpus answers at 0.628.
 *
 * That is three hand-picked examples, which is exactly the evidence that has
 * been wrong before on this repo. This measures the whole distribution instead,
 * and it reports BOTH directions: the questions expansion would rescue and the
 * questions it would damage. A change that lifts a median and pushes forty
 * questions below the refusal line is not an improvement, and the median alone
 * cannot say so.
 *
 * Both arms are scoped to the question's own subject, which flatters both
 * equally and keeps the comparison about the query rather than about scoping.
 *
 * Nothing is written. This decides whether the expansion is worth building.
 */

import { classifyQuestionKind, type QuestionKind } from '@/lib/question-kind';
import { ai } from '@/lib/ai';
import { embed } from '@/lib/ai/embeddings';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { searchContentChunks } from '@/lib/vector';

const argv = process.argv.slice(2);
const arg = (n: string) => {
  const i = argv.indexOf(n);
  return i === -1 ? null : argv[i + 1] ?? null;
};
// One model call per question. Capped by default; raise it deliberately.
const SAMPLE = Number(arg('--sample')) || 40;
const ONLY_KIND = arg('--kind') as QuestionKind | null;
const CONCURRENCY = Number(arg('--concurrency')) || 4;

/** The gate a concept-level answer has to clear. Mirrors retrieval.ts. */
const GATE = 0.45;

type Row = { id: string; subjectId: string; subject: string; language: string; text: string };

async function expand(text: string): Promise<string | null> {
  try {
    const r = await ai().complete({
      system: [
        'You are given an exam question from the Lebanese Baccalaureate.',
        'Name the syllabus topics it tests — the concepts a textbook chapter would be titled with.',
        'Reply with 5 to 10 comma-separated keywords, in the SAME language as the question.',
        'No commentary, no restating the scenario, no proper nouns from the question.',
      ].join('\n'),
      messages: [{ role: 'user', content: text.slice(0, 4000) }],
      maxTokens: 2000,
      effort: 'low',
      model: env().OPENAI_MODEL_VERIFY,
    });
    const t = r.text.trim();
    return t.length > 3 ? t : null;
  } catch {
    return null;
  }
}

async function topScore(query: string, subjectId: string): Promise<{ score: number; chapter: string }> {
  const hits = await searchContentChunks(await embed(query, 'query'), [subjectId], 3, query);
  return { score: hits[0]?.similarity ?? 0, chapter: hits[0]?.chapterName ?? '—' };
}

type Result = {
  row: Row;
  kind: QuestionKind;
  raw: number;
  exp: number;
  rawChapter: string;
  expChapter: string;
};

async function measure(row: Row): Promise<Result | null> {
  const kind = classifyQuestionKind(row.text).kind;
  if (ONLY_KIND && kind !== ONLY_KIND) return null;
  const concepts = await expand(row.text);
  if (!concepts) return null;
  const [raw, exp] = await Promise.all([
    topScore(row.text, row.subjectId),
    topScore(concepts, row.subjectId),
  ]);
  return { row, kind, raw: raw.score, exp: exp.score, rawChapter: raw.chapter, expChapter: exp.chapter };
}

function pct(n: number, d: number) {
  return d ? `${Math.round((100 * n) / d)}%` : '—';
}

async function main() {
  const rows = await db.$queryRaw<Row[]>`
    SELECT q.id, s.id AS "subjectId", s.name AS subject, s.language::text AS language,
           q.content_text AS text
      FROM questions q
      JOIN chapters c ON c.id = q.chapter_id
      JOIN subjects s ON s.id = c.subject_id
     WHERE q.verified_status <> 'rejected'
     ORDER BY md5(q.id::text)
     LIMIT ${SAMPLE * 2}`;

  const out: Result[] = [];
  for (let i = 0; i < rows.length && out.length < SAMPLE; i += CONCURRENCY) {
    const batch = await Promise.all(rows.slice(i, i + CONCURRENCY).map(measure));
    out.push(...batch.filter((r): r is Result => r !== null));
    process.stdout.write(`\r  measured ${out.length}/${SAMPLE}`);
  }
  console.log('\n');

  const deltas = out.map((r) => r.exp - r.raw).sort((a, b) => a - b);
  const median = deltas[Math.floor(deltas.length / 2)] ?? 0;
  const better = out.filter((r) => r.exp > r.raw);
  const worse = out.filter((r) => r.exp < r.raw);

  // The decision cases: the gate is what turns a score into an answer.
  const rescued = out.filter((r) => r.raw < GATE && r.exp >= GATE);
  const lost = out.filter((r) => r.raw >= GATE && r.exp < GATE);
  const movedChapter = out.filter((r) => r.rawChapter !== r.expChapter);

  console.log(`  measured                     ${out.length}`);
  console.log(`  median change in top score   ${median >= 0 ? '+' : ''}${median.toFixed(3)}`);
  console.log(`  scored HIGHER with concepts  ${better.length}  (${pct(better.length, out.length)})`);
  console.log(`  scored LOWER with concepts   ${worse.length}  (${pct(worse.length, out.length)})`);
  console.log('');
  console.log(`  RESCUED — under ${GATE} raw, over it expanded   ${rescued.length}  (${pct(rescued.length, out.length)})`);
  console.log(`  LOST    — over ${GATE} raw, under it expanded   ${lost.length}  (${pct(lost.length, out.length)})`);
  console.log(`  top chapter changed                        ${movedChapter.length}  (${pct(movedChapter.length, out.length)})`);

  const byKind = new Map<string, Result[]>();
  for (const r of out) byKind.set(r.kind, [...(byKind.get(r.kind) ?? []), r]);
  console.log('\n  by question kind:');
  for (const [k, rs] of byKind) {
    const d = rs.map((r) => r.exp - r.raw).sort((a, b) => a - b);
    const m = d[Math.floor(d.length / 2)] ?? 0;
    const resc = rs.filter((r) => r.raw < GATE && r.exp >= GATE).length;
    console.log(`    ${k.padEnd(14)} n=${String(rs.length).padStart(3)}  median ${m >= 0 ? '+' : ''}${m.toFixed(3)}  rescued ${resc}`);
  }

  console.log('\n  --- biggest rescues (raw score -> expanded) ---');
  for (const r of rescued.sort((a, b) => b.exp - b.raw - (a.exp - a.raw)).slice(0, 8)) {
    console.log(`    ${r.raw.toFixed(3)} -> ${r.exp.toFixed(3)}  ${r.row.subject.padEnd(18)} ${r.rawChapter.slice(0, 30)} -> ${r.expChapter.slice(0, 30)}`);
  }
  if (lost.length) {
    console.log('\n  --- LOST: expansion pushed these under the gate ---');
    for (const r of lost.slice(0, 8)) {
      console.log(`    ${r.raw.toFixed(3)} -> ${r.exp.toFixed(3)}  ${r.row.subject.padEnd(18)} ${r.rawChapter.slice(0, 30)}`);
    }
  }
  console.log('');
  await db.$disconnect();
}

main();
