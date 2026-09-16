import { readFileSync } from 'node:fs';
import path from 'node:path';

import { db } from '@/lib/db';

/**
 * Reads a reviewed spreadsheet back in.
 *
 *   npm run review:import -- --file review.csv
 *   npm run review:import -- --file review.csv --apply
 *
 * REPORTS BEFORE IT WRITES, and writes only with `--apply`. The file has been
 * out of our hands — opened in Excel, saved by someone who has never seen this
 * codebase, possibly sorted or partly filled — so the first run says what it
 * would do and changes nothing.
 *
 * WHAT A VERDICT MEANS:
 *
 *   ok      verified_status → verified. A human who teaches the subject has
 *           read it against the paper.
 *   wrong   verified_status → rejected, AND a review-queue item carrying their
 *           note. Rejected questions are excluded from practice, quizzes and
 *           retrieval everywhere, so this takes it out of circulation
 *           immediately rather than waiting for someone to act on the note.
 *   unsure  left unverified, note recorded. Not a failure — "I cannot tell from
 *           what is shown" is real information about the extract.
 *
 * `wrong` is the destructive one and it is deliberately immediate. A question a
 * teacher says is garbled should stop being served the moment they say so; the
 * queue entry is how it gets looked at, not a condition of removing it.
 */

const APPLY = process.argv.includes('--apply');

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/**
 * A CSV row-splitter that understands quoted fields.
 *
 * Not a split on commas. Every field this writes is quoted, question text
 * contains commas and newlines, and Excel re-quotes on save — so a naive split
 * would silently shift every column after the first comma in a question and
 * import verdicts against the wrong ids.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;

    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') field += ch;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

async function main() {
  const fileArg = arg('file') ?? 'review.csv';
  const file = path.isAbsolute(fileArg) ? fileArg : path.join(process.cwd(), fileArg);

  // Strip the BOM the exporter writes for Excel's sake.
  const text = readFileSync(file, 'utf8').replace(/^﻿/, '');
  const rows = parseCsv(text).filter((r) => r.some((c) => c.trim().length > 0));
  if (rows.length < 2) {
    console.log('  nothing in that file');
    await db.$disconnect();
    return;
  }

  const header = rows[0]!.map((h) => h.trim().toLowerCase());
  const idAt = header.indexOf('id');
  const verdictAt = header.indexOf('verdict');
  const notesAt = header.indexOf('notes');
  if (idAt < 0 || verdictAt < 0) {
    console.error('  the file needs an "id" and a "verdict" column');
    process.exit(1);
  }

  const marks: { id: string; verdict: string; note: string }[] = [];
  const unreadable: string[] = [];

  for (const row of rows.slice(1)) {
    const id = (row[idAt] ?? '').trim();
    const verdict = (row[verdictAt] ?? '').trim().toLowerCase();
    const note = (notesAt >= 0 ? row[notesAt] ?? '' : '').trim();
    if (!id || !verdict) continue;

    if (!['ok', 'wrong', 'unsure'].includes(verdict)) {
      unreadable.push(`${id.slice(0, 8)} → "${verdict}"`);
      continue;
    }
    marks.push({ id, verdict, note });
  }

  const ok = marks.filter((m) => m.verdict === 'ok');
  const wrong = marks.filter((m) => m.verdict === 'wrong');
  const unsure = marks.filter((m) => m.verdict === 'unsure');

  console.log('');
  console.log(`  ${rows.length - 1} row(s), ${marks.length} marked`);
  console.log(`    ok      ${ok.length}  → verified`);
  console.log(`    wrong   ${wrong.length}  → rejected, and queued with the note`);
  console.log(`    unsure  ${unsure.length}  → left unverified, note recorded`);
  if (unreadable.length > 0) {
    console.log(`\n  ${unreadable.length} verdict(s) not understood, skipped:`);
    for (const u of unreadable.slice(0, 5)) console.log(`    ${u}`);
  }

  if (!APPLY) {
    console.log('\n  Nothing changed. Re-run with --apply.\n');
    await db.$disconnect();
    return;
  }

  let applied = 0;
  for (const mark of marks) {
    const status =
      mark.verdict === 'ok' ? 'verified' : mark.verdict === 'wrong' ? 'rejected' : null;

    if (status) {
      const updated = await db.$executeRaw`
        UPDATE questions SET verified_status = ${status}::verified_status
         WHERE id = ${mark.id}::uuid`;
      if (updated === 0) continue;
      applied += 1;
    }

    // A note is worth keeping whatever the verdict — "unsure, the diagram is
    // missing" is the most actionable thing on the sheet.
    if (mark.note.length > 0 || mark.verdict === 'wrong') {
      await db.reviewQueueItem.create({
        data: {
          itemType: 'tagged_question',
          itemId: mark.id,
          flagReason: `Teacher review: ${mark.verdict}${mark.note ? ` — ${mark.note}` : ''}`,
          flaggedByUserId: null,
        },
      });
    }
  }

  console.log(`\n  ${applied} question(s) updated.\n`);
  await db.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
