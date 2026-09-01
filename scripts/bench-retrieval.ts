/**
 * How much better than chance is retrieval, per subject and per kind of question?
 *
 *   npm run bench:retrieval
 *
 * The obvious measurement — "how often is the right chapter the top hit" — is
 * three kinds of wrong on this corpus, and each one flatters or damns the wrong
 * subjects.
 *
 * CONCENTRATION. LS Français scores 100% because 45 of its 46 questions sit in
 * two chapters: naming the right one is nearly free. GS Français spreads across
 * eight and scores 8%. Read as quality that says one section is broken and the
 * other perfect, from the same book, the same 188 passages. What it actually
 * measures is how many chapters a subject has and how evenly its questions fall
 * across them. So every score here is reported against the score a coin would
 * get on that same subject, and the number that matters is the distance between
 * them.
 *
 * SELF-GRADING. A past-exam question was filed to its chapter by the loader,
 * using the nearest passage by embedding — the same mechanism being tested. So
 * for those, "did retrieval find the chapter" partly asks whether the embedding
 * agrees with itself. Textbook questions come with their chapter from the book
 * and are not circular. Both are reported, separately, and the textbook column
 * is the honest one where it has enough rows to mean anything.
 *
 * MIXING THE KINDS. The Lebanese Bac asks three sorts of question and only one
 * of them has an answer sitting in a chapter. A comprehension question — the
 * answer is in a passage printed on the exam paper — cannot be scored on
 * whether the right chapter came back, because no chapter contains it; scoring
 * it that way measures nothing and drags down every average it is in. An essay
 * prompt has no fact to retrieve at all, so what is worth measuring there is
 * whether a marking scheme is reachable, which is what the essay path grounds
 * on. Each kind is routed and reported separately below, and the concept table
 * is the one that is about chapter retrieval.
 *
 * The old single-number-per-subject view is still printed, under ALL KINDS
 * TOGETHER, so a run of this before and after routing can be compared line for
 * line rather than taken on trust.
 */

import { classifyQuestionKind, type QuestionKind } from '@/lib/question-kind';
import { db } from '@/lib/db';
import { STRUCTURE_THRESHOLD } from '@/lib/retrieval';

/**
 * Probes per subject per source.
 *
 * Higher than the twenty this used to take, because the sample is now cut three
 * ways: twenty probes split across concept, comprehension and essay leaves
 * cells of four, and a lift computed on four questions is noise with a decimal
 * point on it. Forty-five keeps most subject-and-kind cells above the reporting
 * floor without turning the run into a coffee break.
 */
const PER_SUBJECT = 45;

/** Cells thinner than this are counted but not scored. */
const MIN_CELL = 5;

type Probe = {
  subject: string;
  lang: string;
  track: string;
  source: string;
  chapters: number;
  contentText: string;
  hit1: string | null;
  hitTop: string[];
  chapterId: string;
  /** Similarity of the nearest question in this subject that carries a scheme. */
  schemeSimilarity: number | null;
};

/** Chance of hitting the right chapter by picking at random. */
function baseline(chapters: number, k: number): number {
  if (chapters <= 0) return 0;
  return Math.min(1, k / chapters);
}

/**
 * How much of the available headroom retrieval actually captured.
 *
 * 0 means no better than guessing; 1 means perfect. Negative means worse than
 * a coin, which is a real result and worth seeing rather than clamping away.
 */
function lift(observed: number, chance: number): number {
  if (chance >= 1) return observed >= 1 ? 1 : 0;
  return (observed - chance) / (1 - chance);
}

type Cell = {
  subject: string;
  lang: string;
  track: string;
  n: number;
  top1: number;
  top6: number;
  chapters: number;
  /** Essay probes only: how many had a marking scheme above threshold. */
  scheme: number;
};

function tally(probes: Probe[], key: (p: Probe) => string): Map<string, Cell> {
  const cells = new Map<string, Cell>();
  for (const probe of probes) {
    const id = key(probe);
    const cell = cells.get(id) ?? {
      subject: probe.subject,
      lang: probe.lang,
      track: probe.track,
      n: 0,
      top1: 0,
      top6: 0,
      chapters: probe.chapters,
      scheme: 0,
    };
    cell.n += 1;
    cell.chapters = Math.max(cell.chapters, probe.chapters);
    if (probe.hit1 === probe.chapterId) cell.top1 += 1;
    if (probe.hitTop.includes(probe.chapterId)) cell.top6 += 1;
    if ((probe.schemeSimilarity ?? 0) >= STRUCTURE_THRESHOLD) cell.scheme += 1;
    cells.set(id, cell);
  }
  return cells;
}

function band(value: number): string {
  return value >= 0.9 ? 'excellent'
    : value >= 0.75 ? 'good'
    : value >= 0.5 ? 'fair'
    : value >= 0.25 ? 'weak'
    : 'AT CHANCE';
}

/** The per-subject lift table, as this benchmark has always printed it. */
function chapterTable(cells: Map<string, Cell>): void {
  console.log('  section  subject               ch   n   top1   chance   LIFT');
  const ranked = [...cells.values()]
    .filter((c) => c.n >= MIN_CELL)
    .map((c) => ({ c, l: lift(c.top1 / c.n, baseline(c.chapters, 1)) }))
    .sort((a, b) => b.l - a.l);

  if (ranked.length === 0) {
    console.log(`  (no subject has ${MIN_CELL} probes of this kind)`);
    return;
  }

  for (const { c, l } of ranked) {
    const chance = baseline(c.chapters, 1);
    console.log(
      `  ${c.track.padEnd(8)}${c.subject.slice(0, 20).padEnd(22)}${String(c.chapters).padStart(3)}` +
      `${String(c.n).padStart(4)}${((c.top1 / c.n) * 100).toFixed(0).padStart(6)}%` +
      `${(chance * 100).toFixed(0).padStart(8)}%${l.toFixed(2).padStart(7)}   ${band(l)}`,
    );
  }
}

/*
 * The roll-ups above weight each probe's own chance, which needs the chance
 * carried per probe rather than per subject. Simpler to compute it here than to
 * thread it through: every probe in a subject has the same chapter count.
 */
function weighted(probes: Probe[], key: (p: Probe) => string): Map<string, { n: number; top1: number; chance: number }> {
  const out = new Map<string, { n: number; top1: number; chance: number }>();
  for (const probe of probes) {
    const id = key(probe);
    const e = out.get(id) ?? { n: 0, top1: 0, chance: 0 };
    e.n += 1;
    if (probe.hit1 === probe.chapterId) e.top1 += 1;
    e.chance += baseline(probe.chapters, 1);
    out.set(id, e);
  }
  return out;
}

function printWeighted(title: string, probes: Probe[], key: (p: Probe) => string): void {
  console.log(`\n${title}`);
  const rows = [...weighted(probes, key)].map(([id, e]) => {
    const observed = e.top1 / e.n;
    const chance = e.chance / e.n;
    return { id, n: e.n, observed, chance, l: lift(observed, chance) };
  });
  for (const row of rows.sort((a, b) => b.l - a.l)) {
    console.log(
      `  ${row.id.padEnd(8)}${row.n} probes   top1 ${(row.observed * 100).toFixed(0)}%   ` +
      `chance ${(row.chance * 100).toFixed(0)}%   lift ${row.l.toFixed(2)}`,
    );
  }
}

async function main() {
  const rows = await db.$queryRaw<
    {
      subject: string; lang: string; track: string; source: string;
      chapter_id: string; chapters: bigint; content_text: string;
      hits: string[] | null; scheme_similarity: number | null;
    }[]
  >`
    WITH pool AS (
      SELECT q.id, q.chapter_id, q.embedding, q.content_text, c.subject_id, s.name AS subject,
             s.language AS lang, t.code AS track, q.source_type::text AS source,
             row_number() OVER (PARTITION BY s.id, q.source_type ORDER BY q.id) AS rn
      FROM questions q
      JOIN chapters c ON c.id = q.chapter_id
      JOIN subjects s ON s.id = c.subject_id
      JOIN tracks t ON t.id = s.track_id
      WHERE q.embedding IS NOT NULL AND q.verified_status <> 'rejected'
    ),
    picked AS (SELECT * FROM pool WHERE rn <= ${PER_SUBJECT})
    SELECT p.subject, p.lang::text AS lang, p.track, p.source, p.chapter_id, p.content_text,
      (SELECT count(*) FROM chapters ch3
        WHERE ch3.subject_id = p.subject_id
          AND EXISTS (SELECT 1 FROM chapter_content_chunks l3 WHERE l3.chapter_id = ch3.id)) AS chapters,
      (SELECT array_agg(x.chapter_id ORDER BY x.d)
         FROM (SELECT l.chapter_id, cc.embedding <=> p.embedding AS d
               FROM content_chunks cc
               JOIN chapter_content_chunks l ON l.chunk_id = cc.id
               JOIN chapters ch2 ON ch2.id = l.chapter_id
               WHERE ch2.subject_id = p.subject_id AND cc.embedding IS NOT NULL
               ORDER BY cc.embedding <=> p.embedding LIMIT 6) x) AS hits,
      /*
       * What the essay path would find: the nearest question in this subject
       * carrying a barème or an official solution, excluding the probe itself
       * so a question cannot be grounded on its own answer key.
       */
      (SELECT 1 - (q2.embedding <=> p.embedding)
         FROM questions q2
         JOIN chapters ch4 ON ch4.id = q2.chapter_id
        WHERE ch4.subject_id = p.subject_id
          AND q2.id <> p.id
          AND q2.embedding IS NOT NULL
          AND q2.verified_status <> 'rejected'
          AND (q2.bareme IS NOT NULL OR q2.official_solution IS NOT NULL)
        ORDER BY q2.embedding <=> p.embedding LIMIT 1) AS scheme_similarity
    FROM picked p`;

  const probes: Probe[] = rows
    .filter((r) => r.hits && r.hits.length > 0)
    .map((r) => ({
      subject: r.subject,
      lang: r.lang,
      track: r.track,
      source: r.source,
      chapters: Number(r.chapters),
      contentText: r.content_text,
      chapterId: r.chapter_id,
      hit1: r.hits![0] ?? null,
      hitTop: r.hits!,
      schemeSimilarity: r.scheme_similarity === null ? null : Number(r.scheme_similarity),
    }));

  const kindOf = new Map<Probe, QuestionKind>();
  let unsure = 0;
  for (const probe of probes) {
    const result = classifyQuestionKind(probe.contentText);
    kindOf.set(probe, result.kind);
    if (result.confidence === 'low') unsure += 1;
  }

  const exam = probes.filter((p) => p.source === 'past_exam');
  const book = probes.filter((p) => p.source === 'textbook');
  const ofKind = (kind: QuestionKind) => exam.filter((p) => kindOf.get(p) === kind);

  const concept = ofKind('concept');
  const comprehension = ofKind('comprehension');
  const essay = ofKind('essay');

  console.log('\nWHAT THE CORPUS IS ASKING — past-exam probes, routed by question type\n');
  for (const [name, set] of [['concept', concept], ['comprehension', comprehension], ['essay', essay]] as const) {
    console.log(`  ${name.padEnd(15)}${String(set.length).padStart(5)}   ${((set.length / exam.length) * 100).toFixed(0)}%`);
  }
  console.log(`  ${'(unsure)'.padEnd(15)}${String(unsure).padStart(5)}   pointing at something not supplied`);

  console.log('\n\n=== CONCEPT ===================================================');
  console.log('The chapter path, unchanged, and the only kind chapter retrieval');
  console.log('can honestly be scored on. 0 is guessing, 1 is perfect.\n');
  chapterTable(tally(concept, (p) => `${p.track}/${p.subject}`));
  printWeighted('BY LANGUAGE (weighted, concept only)', concept, (p) => p.lang);
  printWeighted('BY SECTION (weighted, concept only)', concept, (p) => p.track);

  console.log('\n\n=== COMPREHENSION =============================================');
  console.log('The answer is in a passage printed on the exam paper. No chapter');
  console.log('contains it, so retrieval now asks for the passage instead of');
  console.log('answering from the nearest chapter. The lift column is what the');
  console.log('old benchmark was reporting for these — a number about a question');
  console.log('chapter retrieval was never going to answer.\n');
  const comprehensionCells = tally(comprehension, (p) => `${p.track}/${p.subject}`);
  chapterTable(comprehensionCells);
  console.log(
    `\n  ${comprehension.length} probes of ${exam.length} were being scored, and answered, against a chapter.`,
  );

  console.log('\n\n=== ESSAY =====================================================');
  console.log('No fact to retrieve. What the essay path grounds on is the barème');
  console.log('and, where there is one, the official solution — so what is worth');
  console.log(`measuring is whether one is reachable above threshold (${STRUCTURE_THRESHOLD}).\n`);
  console.log('  section  subject                 n   scheme reachable');
  const essayCells = tally(essay, (p) => `${p.track}/${p.subject}`);
  const essayRanked = [...essayCells.values()]
    .filter((c) => c.n >= MIN_CELL)
    .sort((a, b) => b.scheme / b.n - a.scheme / a.n);
  for (const c of essayRanked) {
    console.log(
      `  ${c.track.padEnd(8)}${c.subject.slice(0, 20).padEnd(22)}${String(c.n).padStart(4)}` +
      `${((c.scheme / c.n) * 100).toFixed(0).padStart(9)}%   ${c.scheme} of ${c.n}`,
    );
  }
  const reachable = essay.filter((p) => (p.schemeSimilarity ?? 0) >= STRUCTURE_THRESHOLD).length;
  console.log(
    `\n  ${reachable} of ${essay.length} essay probes can be grounded on a marking scheme` +
    ` (${essay.length ? ((reachable / essay.length) * 100).toFixed(0) : '0'}%).`,
  );
  console.log('  The rest fall through to chapter material, as they did before.');

  /*
   * A scheme with no embedding is a scheme no search can reach, and the essay
   * table above reads as "this subject has no barème" when the truth is "its
   * barèmes have not been embedded since the last re-extraction". Worth stating
   * rather than leaving to be inferred from a suspicious zero.
   */
  const [pending] = await db.$queryRaw<{ held: bigint; searchable: bigint }[]>`
    SELECT count(*) AS held,
           count(*) FILTER (WHERE embedding IS NOT NULL) AS searchable
    FROM questions
    WHERE bareme IS NOT NULL OR official_solution IS NOT NULL`;
  if (pending) {
    const held = Number(pending.held);
    const searchable = Number(pending.searchable);
    console.log(
      `
  ${searchable} of ${held} questions carrying a scheme are searchable; ` +
      `${held - searchable} are waiting on an embedding and cannot be found at all.`,
    );
  }

  console.log('\n\n=== ALL KINDS TOGETHER ========================================');
  console.log('What this benchmark reported before routing existed. Kept so a run');
  console.log('before and after can be compared line for line.\n');
  chapterTable(tally(exam, (p) => `${p.track}/${p.subject}`));
  printWeighted('BY LANGUAGE (weighted, all kinds)', exam, (p) => p.lang);
  printWeighted('BY SECTION (weighted, all kinds)', exam, (p) => p.track);

  console.log(`\n\nNOT SELF-GRADED: ${book.length} textbook questions carry a chapter from the book itself.`);
  if (book.length >= 10) {
    const bookConcept = book.filter((p) => kindOf.get(p) === 'concept');
    for (const [name, set] of [['all kinds', book], ['concept only', bookConcept]] as const) {
      if (set.length === 0) continue;
      const observed = set.filter((p) => p.hit1 === p.chapterId).length / set.length;
      const chance = set.reduce((a, p) => a + baseline(p.chapters, 1), 0) / set.length;
      console.log(
        `  ${name.padEnd(14)}${String(set.length).padStart(4)} probes   top1 ${(observed * 100).toFixed(0)}%   ` +
        `chance ${(chance * 100).toFixed(0)}%   lift ${lift(observed, chance).toFixed(2)}`,
      );
    }
  } else {
    console.log('  Too few to draw on. Hand-labelling ~100 exam questions would give');
    console.log('  the first measurement of this system that is not partly circular.');
  }
}

main()
  .catch((e) => {
    console.error('Benchmark failed:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
