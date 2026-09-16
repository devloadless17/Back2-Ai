import { readFileSync } from 'node:fs';
import path from 'node:path';

import { embed, embedMany } from '@/lib/ai/embeddings';
import { db } from '@/lib/db';
import { searchContentChunks } from '@/lib/vector';

/**
 * A concept gate per subject, measured from both populations.
 *
 *   npm run calibrate:subject-gates
 *   npm run calibrate:subject-gates -- --apply
 *
 * WHY ONE GATE PER SCRIPT IS NOT ENOUGH. `conceptThresholdFor` holds two
 * numbers, 0.50 for Latin and 0.45 for Arabic, and every subject is judged by
 * one of them. Where real student questions actually score is nothing like
 * uniform — p10 runs from 0.286 in LH Mathematics to 0.716 in GS Physique. The
 * same gate refuses two thirds of real GS جغرافيا questions and does nothing
 * whatsoever in GS Chimie. One number cannot be right for both.
 *
 * WHY THIS IS NOT "LOWER THE GATE WHERE IT REFUSES TOO MUCH". That is the
 * dangerous half of the idea, and doing it alone would trade wrong refusals for
 * wrong ANSWERS, which is the worse error for a product students revise from.
 * The gate exists so that a question the corpus cannot answer is refused rather
 * than answered confidently out of the nearest chapter.
 *
 * So both populations are measured against every subject:
 *
 *   on-syllabus    the subject's own probes, which its corpus does answer
 *   off-syllabus   thirty genuinely foreign questions — recipes, football,
 *                  visas — which it must never answer
 *
 * A subject's gate is only moved when the two populations SEPARATE: the new
 * value sits strictly above every off-syllabus score and at or below the tenth
 * percentile of real ones. Where they overlap — and they will, for subjects
 * whose material is thin or whose language the embedding handles poorly — no
 * number separates them, so the subject keeps the language default and is
 * reported as unseparable rather than quietly tuned.
 *
 * Costs embeddings and nothing else. No model calls.
 */

const APPLY = process.argv.includes('--apply');

/** Genuinely foreign questions — the population that must stay refused. */
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
];

/** The language defaults this replaces, and the floor a subject falls back to. */
const LANGUAGE_GATE: Record<string, number> = { ar: 0.45, fr: 0.5, en: 0.5 };

/**
 * How far above the worst off-syllabus score a gate must sit.
 *
 * Not zero. The thirty foreign questions are a sample of "everything a student
 * might ask that is not on their programme", which is unbounded — tuning to sit
 * exactly one thousandth above the highest one we happened to write would fit
 * the sample rather than the population. A gate is only lowered when there is
 * real daylight.
 */
const SAFETY = 0.02;

/** Never go below this however well a subject separates. */
const FLOOR = 0.3;

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))));
  return sorted[i]!;
}

async function main() {
  const raw = JSON.parse(
    readFileSync(path.join(process.cwd(), 'corpus', 'retrieval-probes.json'), 'utf8'),
  ) as Record<string, string>;

  const probeRows = await db.$queryRaw<
    { id: string; subjectId: string; subject: string; track: string; lang: string }[]
  >`
    SELECT DISTINCT ON (cc.id)
           cc.id, sub.id AS "subjectId", sub.name AS subject,
           t.code AS track, sub.language::text AS lang
      FROM content_chunks cc
      JOIN chapter_content_chunks l ON l.chunk_id = cc.id
      JOIN chapters c ON c.id = l.chapter_id
      JOIN subjects sub ON sub.id = c.subject_id
      JOIN tracks t ON t.id = sub.track_id
     WHERE cc.id = ANY(${Object.keys(raw)}::uuid[]) AND cc.embedding IS NOT NULL`;

  const subjects = new Map<
    string,
    { label: string; lang: string; on: number[]; off: number[] }
  >();

  console.log('\n  embedding the off-syllabus set once…');
  const foreignVectors = await embedMany(OFF_SYLLABUS, 'query');

  let done = 0;
  for (const row of probeRows) {
    const entry =
      subjects.get(row.subjectId) ??
      { label: `${row.track} ${row.subject}`, lang: row.lang, on: [], off: [] };
    const hits = await searchContentChunks(await embed(raw[row.id]!, 'query'), [row.subjectId], 20, raw[row.id]!);
    const own = hits.find((h) => h.id === row.id);
    if (own) entry.on.push(own.similarity);
    subjects.set(row.subjectId, entry);
    done += 1;
    process.stdout.write(`\r  on-syllabus ${done}/${probeRows.length}`);
  }
  console.log('');

  // Every foreign question against every subject that has probes.
  const ids = [...subjects.keys()];
  let n = 0;
  for (const subjectId of ids) {
    const entry = subjects.get(subjectId)!;
    for (let i = 0; i < foreignVectors.length; i += 1) {
      const hits = await searchContentChunks(foreignVectors[i]!, [subjectId], 5, OFF_SYLLABUS[i]!);
      if (hits[0]) entry.off.push(hits[0].similarity);
    }
    n += 1;
    process.stdout.write(`\r  off-syllabus ${n}/${ids.length}`);
  }
  console.log('\n');

  console.log('  gate per subject, from both populations\n');
  console.log(
    '  ' + 'subject'.padEnd(28) + 'real p10'.padStart(9) + 'worst off'.padStart(11) +
      'now'.padStart(7) + 'proposed'.padStart(10) + '   effect',
  );

  const updates: { id: string; gate: number }[] = [];
  let rescued = 0;
  let totalReal = 0;

  const rows = [...subjects.entries()].filter(([, e]) => e.on.length >= 3 && e.off.length > 0);
  rows.sort((a, b) => a[1].label.localeCompare(b[1].label));

  for (const [subjectId, e] of rows) {
    const on = e.on.slice().sort((a, b) => a - b);
    const off = e.off.slice().sort((a, b) => a - b);
    const current = LANGUAGE_GATE[e.lang] ?? 0.5;
    const worstOff = off[off.length - 1]!;
    const p10 = quantile(on, 0.1);

    const refusedNow = on.filter((v) => v < current).length;
    totalReal += on.length;

    /*
     * THE GATE GOES AT p10, NOT AT THE LOWEST SAFE VALUE.
     *
     * Any value between `worstOff + SAFETY` and `p10` separates the two
     * populations, and the first instinct is to take the lowest — it admits the
     * most. That is wrong: by construction p10 already admits nine real
     * questions in ten, so going lower rescues almost nothing while spending
     * every bit of margin that stands between this subject and a confident
     * answer to a question about football.
     *
     * The floor and the safety margin remain as guards on the arithmetic, not
     * as the target. The target is the cheapest gate that does the job.
     */
    const lowestSafe = Math.max(FLOOR, worstOff + SAFETY);
    const separable = lowestSafe <= p10;
    const proposed = separable
      ? Math.min(current, Number(Math.max(p10, lowestSafe).toFixed(3)))
      : current;

    const refusedAfter = on.filter((v) => v < proposed).length;
    const gain = refusedNow - refusedAfter;
    rescued += gain;

    const note = !separable
      ? '   overlap — keeps default'
      : gain > 0
        ? `   +${gain}/${on.length} real questions answered`
        : '   no change';

    console.log(
      '  ' + e.label.padEnd(28) + p10.toFixed(3).padStart(9) + worstOff.toFixed(3).padStart(11) +
        current.toFixed(2).padStart(7) + proposed.toFixed(3).padStart(10) + note,
    );

    if (proposed !== current) updates.push({ id: subjectId, gate: proposed });
  }

  console.log(
    `\n  ${updates.length} subject(s) would move. ${rescued} of ${totalReal} real questions ` +
      `change from refused to answered.`,
  );

  if (APPLY) {
    for (const u of updates) {
      await db.$executeRaw`UPDATE subjects SET concept_gate = ${u.gate} WHERE id = ${u.id}::uuid`;
    }
    console.log(`  applied to ${updates.length} subject(s).\n`);
  } else {
    console.log('  Nothing written. Re-run with --apply.\n');
  }

  await db.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
