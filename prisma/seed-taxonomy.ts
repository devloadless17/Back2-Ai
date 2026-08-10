/**
 * Seeds the real curriculum taxonomy from the transcribed books.
 *
 *   npm run db:seed:taxonomy            # apply
 *   npm run db:seed:taxonomy -- --dry   # show what would change
 *
 * Reads scripts/corpus/catalog.csv (which book, which subject, which tracks)
 * and corpus/taxonomy/<book>.json (the chapter list parsed from each book's own
 * table of contents), and writes tracks, subjects, units and chapters.
 *
 * A book that serves two tracks produces a subject row in EACH of them.
 *
 * That is a deliberate choice. Subject already carries trackId, and everything
 * downstream keys off it: retrieval scopes by the subject list of the student's
 * locked track, and chapter mastery is per chapter. A single shared subject
 * would mean a GS student's mastery moving because LS students answered — and
 * it would need the scoping in src/lib/vector.ts rewritten. Duplicating costs
 * one extra embedding per shared chunk, which is cents, and keeps every
 * per-track number honest.
 *
 * Idempotent: chapters are matched on (subject, orderIndex) and updated in
 * place, so re-running after a taxonomy fix does not create duplicates and does
 * not orphan any content already filed under a chapter.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { PrismaClient, type Language } from '@prisma/client';

const db = new PrismaClient();
const ROOT = path.resolve(__dirname, '..');
const CATALOG = path.join(ROOT, 'scripts', 'corpus', 'catalog.csv');
const TAXONOMY = path.join(ROOT, 'corpus', 'taxonomy');

const TRACK_NAMES: Record<string, string> = {
  GS: 'Sciences Générales',
  LS: 'Sciences de la Vie',
  SE: 'Sociologie et Économie',
  LH: 'Lettres et Humanités',
};

type CatalogRow = {
  book_name: string;
  folder: string;
  sha8: string;
  subject: string;
  language: string;
  tracks: string;
  pages: string;
  note: string;
};

type Chapter = {
  index: number;
  title: string;
  unit?: string | null;
  pdfPage?: number | null;
  pdfPageEnd?: number | null;
  inferred?: boolean;
};

/** Minimal CSV reader — the catalog has quoted fields containing commas. */
function parseCsv(text: string): CatalogRow[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (c === '"') {
        quoted = false;
      } else {
        cell += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (c !== '\r') {
      cell += c;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }

  const [header, ...body] = rows.filter((r) => r.some((c) => c.trim()));
  if (!header) return [];
  return body.map(
    (r) => Object.fromEntries(header.map((h, i) => [h.trim(), r[i] ?? ''])) as CatalogRow,
  );
}

async function main() {
  const dry = process.argv.includes('--dry');
  const catalog = parseCsv(await readFile(CATALOG, 'utf8'));

  let subjects = 0;
  let units = 0;
  let chapters = 0;
  const skipped: string[] = [];

  for (const row of catalog) {
    if (!row.book_name || !row.folder) continue;

    let taxonomy: { chapters?: Chapter[] };
    try {
      taxonomy = JSON.parse(await readFile(path.join(TAXONOMY, `${row.folder}.json`), 'utf8'));
    } catch {
      skipped.push(`${row.book_name} — no taxonomy file`);
      continue;
    }

    const list = (taxonomy.chapters ?? []).filter((c) => c.title?.trim());
    if (list.length === 0) {
      skipped.push(`${row.book_name} — taxonomy has no chapters`);
      continue;
    }

    const language = row.language as Language;

    for (const code of row.tracks.split(';').map((t) => t.trim()).filter(Boolean)) {
      const track = await db.track.upsert({
        where: { code },
        update: {},
        create: { code, name: TRACK_NAMES[code] ?? code },
        select: { id: true },
      });

      // Subject identity is (track, name, language): "Mathematics" in English
      // for GS is a different corpus from "Mathématiques" in French for GS.
      let subject = await db.subject.findFirst({
        where: { trackId: track.id, name: row.subject, language },
        select: { id: true },
      });
      if (!subject) {
        if (dry) {
          subjects += 1;
          continue;
        }
        subject = await db.subject.create({
          data: { trackId: track.id, name: row.subject, language },
          select: { id: true },
        });
      }
      subjects += 1;

      // Units, in the order they appear in the book.
      const unitIds = new Map<string, string>();
      const unitNames = [...new Set(list.map((c) => c.unit).filter(Boolean))] as string[];
      for (const [i, name] of unitNames.entries()) {
        if (dry) {
          units += 1;
          continue;
        }
        const unit = await db.unit.upsert({
          where: { subjectId_orderIndex: { subjectId: subject.id, orderIndex: i } },
          update: { name },
          create: { subjectId: subject.id, name, orderIndex: i },
          select: { id: true },
        });
        unitIds.set(name, unit.id);
        units += 1;
      }

      // Chapters keyed on (subject, orderIndex) so a re-run updates in place
      // rather than duplicating — anything already filed under a chapter keeps
      // pointing at the same row.
      for (const [i, chapter] of list.entries()) {
        if (dry) {
          chapters += 1;
          continue;
        }
        await db.chapter.upsert({
          where: { subjectId_orderIndex: { subjectId: subject.id, orderIndex: i } },
          update: {
            name: chapter.title.trim(),
            unitId: chapter.unit ? unitIds.get(chapter.unit) ?? null : null,
          },
          create: {
            subjectId: subject.id,
            name: chapter.title.trim(),
            orderIndex: i,
            unitId: chapter.unit ? unitIds.get(chapter.unit) ?? null : null,
          },
        });
        chapters += 1;
      }
    }
  }

  console.log('');
  console.log(dry ? 'Would write:' : 'Written:');
  console.log(`  subjects  ${subjects}`);
  console.log(`  units     ${units}`);
  console.log(`  chapters  ${chapters}`);

  if (skipped.length) {
    console.log('');
    console.log('Skipped — no chapters to seed:');
    for (const s of skipped) console.log(`  ${s}`);
  }

  if (!dry) {
    const counts = await db.$queryRaw<{ code: string; subjects: bigint; chapters: bigint }[]>`
      SELECT t.code,
             COUNT(DISTINCT s.id) AS subjects,
             COUNT(c.id)          AS chapters
      FROM tracks t
      LEFT JOIN subjects s ON s.track_id = t.id
      LEFT JOIN chapters c ON c.subject_id = s.id
      GROUP BY t.code
      ORDER BY t.code
    `;
    console.log('');
    console.log('In the database now:');
    for (const r of counts) {
      console.log(`  ${r.code.padEnd(4)} ${Number(r.subjects)} subjects, ${Number(r.chapters)} chapters`);
    }
  }
}

main()
  .catch((error) => {
    console.error('Seeding the taxonomy failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
