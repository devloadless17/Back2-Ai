/**
 * Finds which printed exercise each flattened science row came from.
 *
 *   npx tsx scripts/corpus/place-flattened-rows.ts --out corpus/.mapping/flattened-placements.json
 *
 * THE ROWS THIS IS FOR. A few hundred science questions lost their mathematics
 * to the PDF text layer: the reader returns `2f(x) x lnx= +` where the paper
 * prints `f(x) = x² + ln x`. Every repair we have refused them — the Mathpix
 * rebuild had no matching record, and the figure pipeline found nothing to cut,
 * because there is no figure, only mathematics set as text. The glyphs cannot
 * be reconstructed from anything the corpus holds.
 *
 * So instead of rebuilding the text we locate the exercise on its own paper and
 * let `render_exercise_bands.py` photograph it. This script does the locating.
 *
 * IT MATCHES ON WORDS, NEVER ON THE MATHEMATICS. Both texts have their symbols
 * mangled, in different ways, so symbols carry no signal at all. Prose survives
 * both readers, and it is enough.
 *
 * THE HASH ROUTE DOES NOT WORK HERE, THOUGH IT IS THE OBVIOUS ONE. `source_ref`
 * is the key `backfill-visuals` matches on, and it resolves only 30 of these 223
 * rows: 114 carry no `source_ref` at all, and 52 more name papers C1 never
 * positioned. Matching the wording places 123. Both numbers were measured
 * before this script was written; neither was assumed.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { db } from '../../src/lib/db';

import { bag, decide, words, overlap, type Ranked } from './exercise-band-rules';

const ROOT = process.cwd();
const C1 = path.join(ROOT, 'corpus/.mapping/positioned-structure.json');
const EXAMS = path.join(ROOT, 'corpus/exams.json');

const argv = process.argv.slice(2);
const arg = (name: string) => {
  const i = argv.indexOf(name);
  return i < 0 ? null : argv[i + 1] ?? null;
};
const OUT = arg('--out') ?? path.join(ROOT, 'corpus/.mapping/flattened-placements.json');
/*
 * Rows that already carry a band are normally skipped, since they are done.
 * `--all` puts them back in, which is how a change to the matching rules is
 * checked against the bands already loaded: a rule that would now REFUSE one of
 * them has refused it for a reason, and that band should come back out.
 */
const ALL = argv.includes('--all');

/** The eight science subjects, in both printed editions. */
const SCIENCE = [
  'Mathematics', 'Physics', 'Chemistry', 'Life Sciences',
  'Mathematiques', 'Physique', 'Chimie', 'Sciences de la vie',
];


type Span = { page: number; yStart: number; yEnd: number; pageHeight: number };
type C1Paper = {
  sha256: string;
  paper: string;
  containers: Array<{ ordinal: number; spans: Span[]; leadInSpans: Span[] }>;
};





const exerciseText = (ex: {
  title?: string;
  statement?: string;
  parts?: Array<{ text?: string }>;
}) => [ex.title ?? '', ex.statement ?? '', ...(ex.parts ?? []).map((p) => p.text ?? '')].join(' ');

async function main() {
  const c1 = JSON.parse(readFileSync(C1, 'utf-8')) as C1Paper[];
  const exams = (JSON.parse(readFileSync(EXAMS, 'utf-8')) as Array<Record<string, never>>).filter(
    (e: Record<string, unknown>) => e.sha256,
  ) as unknown as Array<{ sha256: string; path: string; language: string; session: string; exercises: unknown[] }>;

  // The rows that render flattened and have nothing to show in their place.
  const rows = await db.$queryRawUnsafe<Array<{ id: string; subject: string; lang: string; body: string }>>(
    `select q.id, s.name as subject, s.language::text as lang, q.content_text as body
       from questions q
       join chapters ch on ch.id = q.chapter_id
       join subjects s on s.id = ch.subject_id
      where q.source_type = 'past_exam'
        and q.content_latex is null
        and s.name = any($1::text[])
        and coalesce(array_length(q.content_images, 1), 0) = 0
        and ($2::boolean or not exists (
          select 1 from question_visuals qv where qv.question_id = q.id and qv.status = 'active'))`,
    SCIENCE,
    ALL,
  );

  const candidates = exams.flatMap((e) =>
    e.exercises
      .map((ex, i) => {
        const w = words(exerciseText(ex as Parameters<typeof exerciseText>[0]));
        return { sha: e.sha256, paper: e.path, ordinal: i + 1, lang: e.language, session: e.session, words: w, bag: bag(w) };
      })
      .filter((c) => c.words.length),
  );

  const spanOf = new Map<string, Span[]>();
  for (const p of c1) {
    for (const c of p.containers) {
      spanOf.set(`${p.sha256}#${c.ordinal}`, [...(c.leadInSpans ?? []), ...(c.spans ?? [])]);
    }
  }

  const placed: Array<Record<string, unknown>> = [];
  const tally = { rows: rows.length, tooShort: 0, noMatch: 0, ambiguous: 0, noSpan: 0, weakAnchor: 0, placed: 0 };

  for (const r of rows) {
    const rowWords = words(r.body ?? '');
    const rowBag = bag(rowWords);
    if (rowBag.size < 8) {
      tally.tooShort++;
      continue;
    }

    const ranked: Array<Ranked & { c: (typeof candidates)[number] }> = candidates
      .filter((c) => c.lang === r.lang) // an edition only matches its own language
      .map((c) => ({ score: overlap(rowBag, c.bag), candidate: c, c }))
      .filter((k) => k.score > 0.4)
      .sort((x, y) => y.score - x.score);

    const verdict = decide(rowWords, ranked);
    if (!verdict.accept) {
      if (verdict.reason === 'no-match') tally.noMatch++;
      else if (verdict.reason === 'ambiguous') tally.ambiguous++;
      else tally.weakAnchor++;
      continue;
    }
    const run = verdict.run;

    // Among reprints of one exercise, take the first that C1 actually positioned.
    const tied = verdict.tied as typeof ranked;
    const pick = tied.find((k) => (spanOf.get(`${k.c.sha}#${k.c.ordinal}`) ?? []).length) ?? ranked[0]!;
    const spans = spanOf.get(`${pick.c.sha}#${pick.c.ordinal}`) ?? [];
    if (!spans.length) {
      tally.noSpan++;
      continue;
    }

    tally.placed++;
    placed.push({
      id: r.id,
      subject: r.subject,
      path: pick.c.paper,
      sha: pick.c.sha,
      ordinal: pick.c.ordinal,
      score: +pick.score.toFixed(3),
      run,
      spans,
    });
  }

  writeFileSync(OUT, JSON.stringify(placed, null, 1));
  console.log(tally);
  const bySubject = placed.reduce<Record<string, number>>(
    (a, p) => ((a[p.subject as string] = (a[p.subject as string] ?? 0) + 1), a),
    {},
  );
  console.log('placed by subject:', bySubject);
  const runs = placed.map((p) => p.run as number).sort((a, b) => a - b);
  if (runs.length) console.log(`shared word-run: min ${runs[0]}, median ${runs[runs.length >> 1]}, max ${runs.at(-1)}`);
  console.log(`-> ${OUT}`);
  await db.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
