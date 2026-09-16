import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { db } from '@/lib/db';

/**
 * A spreadsheet a teacher can check, without giving them the repository.
 *
 *   npm run review:export -- --subject "Mathematiques" --track GS --limit 100
 *   npm run review:export -- --limit 200 --out review.csv
 *
 * 4,772 questions are unverified and 26 are verified. Every measurement this
 * project has is about what the tutor is GIVEN — retrieval coverage, which
 * column it reads, whether the symbols render. Nobody has checked what is
 * actually stored against the paper it came from, and no amount of engineering
 * substitutes for a person who teaches the subject reading it.
 *
 * WHY A CSV AND NOT A REVIEW SCREEN. A teacher has a laptop, an hour between
 * classes, and no account. The review queue in the admin area is the right tool
 * for someone on the team and the wrong one for someone who should never need a
 * login. A spreadsheet opens on any machine, works offline on the bus, and can
 * be handed to three teachers at once for different subjects.
 *
 * WRITTEN WITH A BOM, deliberately. Excel on Windows reads a BOM-less UTF-8 CSV
 * as the system codepage and turns every Arabic question into mojibake — which
 * the teacher would report as a corpus fault. Three bytes prevent a wasted
 * afternoon.
 *
 * ORDERED BY WHAT STUDENTS ACTUALLY MEET. A reviewer's hour should go to the
 * chapters the examiners keep setting, not to whatever the database returns
 * first, so rows come out by how many years the chapter has been examined in.
 */

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** One CSV field: quoted always, so a newline or comma inside cannot split a row. */
function cell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

const COLUMNS = [
  'id',
  'subject',
  'chapter',
  'year',
  'question',
  'official_solution',
  'bareme',
  'verdict',
  'notes',
];

async function main() {
  const limit = Number(arg('limit') ?? '100');
  const subject = arg('subject') ?? null;
  const track = arg('track') ?? null;
  const out = arg('out') ?? 'review.csv';

  const rows = await db.$queryRaw<
    {
      id: string;
      subject: string;
      chapter: string;
      year: number | null;
      question: string;
      official_solution: string | null;
      bareme: unknown;
    }[]
  >`
    SELECT q.id::text,
           t.code || ' ' || s.name AS subject,
           c.name AS chapter,
           ec.year,
           q.content_text AS question,
           q.official_solution,
           q.bareme
      FROM questions q
      JOIN chapters c ON c.id = q.chapter_id
      JOIN subjects s ON s.id = c.subject_id
      JOIN tracks t ON t.id = s.track_id
      LEFT JOIN exam_cycles ec ON ec.id = q.source_exam_id
     WHERE q.verified_status = 'unverified'
       AND (${subject}::text IS NULL OR s.name = ${subject}::text)
       AND (${track}::text IS NULL OR t.code = ${track}::text)
       AND length(q.content_text) BETWEEN 60 AND 6000
     ORDER BY (
       -- How many years this chapter has been set. A reviewer's hour belongs
       -- to the chapters students actually meet.
       SELECT count(DISTINCT e2.year)
         FROM question_chapters qc
         JOIN questions q2 ON q2.id = qc.question_id
         JOIN exam_cycles e2 ON e2.id = q2.source_exam_id
        WHERE qc.chapter_id = c.id
     ) DESC, md5(q.id::text)
     LIMIT ${limit}`;

  if (rows.length === 0) {
    console.log('  nothing unverified matches that filter');
    await db.$disconnect();
    return;
  }

  const lines = [COLUMNS.join(',')];
  for (const row of rows) {
    const bareme = Array.isArray(row.bareme)
      ? (row.bareme as { criterion?: string; points?: number }[])
          .map((b) => `${b.criterion ?? ''} (${b.points ?? '?'})`)
          .join('\n')
      : '';

    lines.push(
      [
        cell(row.id),
        cell(row.subject),
        cell(row.chapter),
        cell(row.year ?? ''),
        cell(row.question.replace(/\r/g, '')),
        cell((row.official_solution ?? '').replace(/\r/g, '')),
        cell(bareme),
        cell(''), // verdict — ok / wrong / unsure
        cell(''), // notes
      ].join(','),
    );
  }

  // ﻿: see the note above on Excel and Arabic.
  const file = path.isAbsolute(out) ? out : path.join(process.cwd(), out);
  writeFileSync(file, '﻿' + lines.join('\r\n') + '\r\n', 'utf8');

  console.log('');
  console.log(`  ${rows.length} question(s) → ${file}`);
  console.log('');
  console.log('  Give the file to the reviewer with these instructions:');
  console.log('');
  console.log('    Fill the "verdict" column only. One of:');
  console.log('      ok      the question and its solution match the paper');
  console.log('      wrong   something is missing, garbled or incorrect');
  console.log('      unsure  you cannot tell from what is shown');
  console.log('    Put anything you want to say in "notes". Change nothing else,');
  console.log('    and do not touch the "id" column — it is how the marks come back.');
  console.log('');
  console.log(`  Then: npm run review:import -- --file ${out}`);
  console.log('');

  await db.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
