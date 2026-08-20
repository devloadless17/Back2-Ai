/**
 * How much better than chance is retrieval, per subject?
 *
 *   npm run bench:retrieval
 *
 * The obvious measurement — "how often is the right chapter the top hit" — is
 * two kinds of wrong on this corpus, and both flatter or damn the wrong
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
 */

import { db } from '@/lib/db';

type Row = {
  subject: string; lang: string; track: string; source: string;
  n: bigint; top1: bigint; top6: bigint; chapters: bigint;
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

async function main() {
  const rows: Row[] = await db.$queryRaw`
    WITH pool AS (
      SELECT q.id, q.chapter_id, q.embedding, c.subject_id, s.name AS subject,
             s.language AS lang, t.code AS track, q.source_type::text AS source,
             row_number() OVER (PARTITION BY s.id, q.source_type ORDER BY q.id) AS rn
      FROM questions q
      JOIN chapters c ON c.id = q.chapter_id
      JOIN subjects s ON s.id = c.subject_id
      JOIN tracks t ON t.id = s.track_id
      WHERE q.embedding IS NOT NULL AND q.verified_status <> 'rejected'
    ),
    picked AS (SELECT * FROM pool WHERE rn <= 20),
    scored AS (
      SELECT p.subject, p.lang, p.track, p.source, p.chapter_id,
        (SELECT count(*) FROM chapters ch3
          WHERE ch3.subject_id = p.subject_id
            AND EXISTS (SELECT 1 FROM chapter_content_chunks l3 WHERE l3.chapter_id = ch3.id)) AS chapters,
        (SELECT array_agg(x.chapter_id ORDER BY x.d)
           FROM (SELECT l.chapter_id, cc.embedding <=> p.embedding AS d
                 FROM content_chunks cc
                 JOIN chapter_content_chunks l ON l.chunk_id = cc.id
                 JOIN chapters ch2 ON ch2.id = l.chapter_id
                 WHERE ch2.subject_id = p.subject_id AND cc.embedding IS NOT NULL
                 ORDER BY cc.embedding <=> p.embedding LIMIT 6) x) AS hits
      FROM picked p
    )
    SELECT subject, lang, track, source, max(chapters) AS chapters, count(*) AS n,
      count(*) FILTER (WHERE hits[1] = chapter_id) AS top1,
      count(*) FILTER (WHERE chapter_id = ANY(hits)) AS top6
    FROM scored WHERE hits IS NOT NULL
    GROUP BY subject, lang, track, source`;

  const rowLift = (r: Row) => {
    const n = Number(r.n);
    const ch = Number(r.chapters);
    return {
      n, ch,
      t1: Number(r.top1) / n,
      t6: Number(r.top6) / n,
      b1: baseline(ch, 1),
      b6: baseline(ch, 6),
    };
  };

  const exam = rows.filter((r) => r.source === 'past_exam');
  const book = rows.filter((r) => r.source === 'textbook');

  console.log('LIFT OVER CHANCE — 0 is guessing, 1 is perfect. Past-exam rows only.\n');
  console.log('  section  subject               ch   n   top1   chance   LIFT');
  const ranked = exam
    .map((r) => ({ r, m: rowLift(r) }))
    .filter((x) => x.m.n >= 5)
    .map((x) => ({ ...x, l: lift(x.m.t1, x.m.b1) }))
    .sort((a, b) => b.l - a.l);
  for (const { r, m, l } of ranked) {
    const bar = l >= 0.9 ? 'excellent' : l >= 0.75 ? 'good' : l >= 0.5 ? 'fair' : l >= 0.25 ? 'weak' : 'AT CHANCE';
    console.log(
      `  ${r.track.padEnd(8)}${r.subject.slice(0, 20).padEnd(22)}${String(m.ch).padStart(3)}${String(m.n).padStart(4)}` +
      `${(m.t1 * 100).toFixed(0).padStart(6)}%${(m.b1 * 100).toFixed(0).padStart(8)}%${l.toFixed(2).padStart(7)}   ${bar}`,
    );
  }

  const group = (rs: Row[], key: (r: Row) => string) => {
    const m = new Map<string, { n: number; t1: number; b1: number }>();
    for (const r of rs) {
      const x = rowLift(r);
      const e = m.get(key(r)) ?? { n: 0, t1: 0, b1: 0 };
      e.n += x.n; e.t1 += x.t1 * x.n; e.b1 += x.b1 * x.n;
      m.set(key(r), e);
    }
    return m;
  };
  for (const [title, key] of [['LANGUAGE', (r: Row) => r.lang], ['SECTION', (r: Row) => r.track]] as const) {
    console.log(`\nBY ${title} (weighted, past-exam)`);
    const m = group(exam, key);
    for (const [k, e] of [...m].sort((a, b) => lift(b[1].t1 / b[1].n, b[1].b1 / b[1].n) - lift(a[1].t1 / a[1].n, a[1].b1 / a[1].n))) {
      const obs = e.t1 / e.n, ch = e.b1 / e.n;
      console.log(`  ${k.padEnd(8)}${e.n} probes   top1 ${(obs * 100).toFixed(0)}%   chance ${(ch * 100).toFixed(0)}%   lift ${lift(obs, ch).toFixed(2)}`);
    }
  }

  const bn = book.reduce((a, r) => a + Number(r.n), 0);
  console.log(`\nNOT SELF-GRADED: ${bn} textbook questions carry a chapter from the book itself.`);
  if (bn >= 10) {
    const m = group(book, () => 'all');
    const e = m.get('all')!;
    const obs = e.t1 / e.n, ch = e.b1 / e.n;
    console.log(`  top1 ${(obs * 100).toFixed(0)}%   chance ${(ch * 100).toFixed(0)}%   lift ${lift(obs, ch).toFixed(2)}`);
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
