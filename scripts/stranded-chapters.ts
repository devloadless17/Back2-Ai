/**
 * Which chapters hold questions the tutor can never ground?
 *
 *   npm run report:stranded
 *
 * A chapter with no passages behind it cannot be retrieved by any query. The
 * tutor does not fail visibly when this happens — it answers from a
 * neighbouring chapter of the same subject, fluently, with a citation. So the
 * questions filed under such a chapter are worse than missing: they are
 * confidently wrong. This counts them and names the book to fix.
 *
 * ATTRIBUTION IS THE HARD PART, and the first version of this report got it
 * wrong. It picked the book by (subject, track) and took the first row, which
 * is correct only where a subject has one book. Philosophie LH has two, and
 * "اللغة والفكر" was reported against `falsafa-arabiya-lh` when the chapter is
 * named on the contents page of `falsafa-3amma-lh` — so the fix would have been
 * written into an override for a book that never had the chapter.
 *
 * The book is therefore the one whose TAXONOMY NAMES THE CHAPTER. That is the
 * same string the seeder wrote the chapter row from, so the match is exact
 * rather than fuzzy, and it is evidence rather than a guess.
 *
 * Where the taxonomy is silent — the chapter row predates the current parse, or
 * the book's contents page is unread — the chapter's surviving passages are
 * asked instead: a passage carries its source document. That is weaker (a
 * chapter with zero passages has nothing to say) but it is still evidence from
 * the corpus rather than from a join order, and it is labelled as the weaker
 * signal wherever it is used.
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { db } from '@/lib/db';

const ROOT = process.cwd();
const CATALOG = path.join(ROOT, 'scripts', 'corpus', 'catalog.csv');
const TAXONOMY = path.join(ROOT, 'corpus', 'taxonomy');
const OUT = path.join(ROOT, 'docs', 'STRANDED-CHAPTERS.md');

/** Fewer than this and the chapter cannot fill a retrieval window. */
const THIN = 5;

/** The seeder writes chapter.name from the taxonomy title verbatim. */
const fold = (s: string) => s.normalize('NFKC').replace(/\s+/g, ' ').trim();

type Book = {
  folder: string;
  name: string;
  subject: string;
  tracks: string[];
  titles: Set<string>;
};

async function books(): Promise<Book[]> {
  const csv = await readFile(CATALOG, 'utf8');
  const [header, ...lines] = csv.split(/\r?\n/).filter((l) => l.trim());
  const cols = header!.replace(/^﻿/, '').split(',');
  const at = (cells: string[], name: string) => cells[cols.indexOf(name)]?.trim() ?? '';

  const out: Book[] = [];
  for (const line of lines) {
    const cells = line.split(',');
    const folder = at(cells, 'folder');
    if (!folder) continue;
    let titles = new Set<string>();
    try {
      const tax = JSON.parse(
        await readFile(path.join(TAXONOMY, `${folder}.json`), 'utf8'),
      ) as { chapters?: { title?: string }[] };
      titles = new Set((tax.chapters ?? []).flatMap((c) => (c.title ? [fold(c.title)] : [])));
    } catch {
      // No taxonomy: the book stays a candidate for the passage-side signal
      // below, but it can never claim a chapter by name.
    }
    out.push({
      folder,
      name: at(cells, 'book_name') || folder,
      subject: at(cells, 'subject'),
      tracks: at(cells, 'tracks').split(';').map((t) => t.trim()).filter(Boolean),
      titles,
    });
  }
  return out;
}

type Row = {
  chapter: string;
  subject: string;
  track: string | null;
  passages: number;
  questions: number;
  /** book_key of the passages already filed here, when they agree on one. */
  passage_book: string | null;
  passage_books: number;
};

async function thinChapters(): Promise<Row[]> {
  const rows = await db.$queryRaw<Record<string, unknown>[]>`
    WITH counted AS (
      SELECT c.name                                AS chapter,
             s.name                                AS subject,
             t.code                                AS track,
             count(DISTINCT cc.chunk_id)           AS passages,
             count(DISTINCT q.id)                  AS questions,
             count(DISTINCT ch.source_document_id) AS passage_books,
             min(sd.book_key)                      AS passage_book
        FROM chapters c
        JOIN subjects s ON s.id = c.subject_id
        LEFT JOIN tracks t ON t.id = s.track_id
        LEFT JOIN chapter_content_chunks cc ON cc.chapter_id = c.id
        LEFT JOIN content_chunks ch ON ch.id = cc.chunk_id
        LEFT JOIN source_documents sd ON sd.id = ch.source_document_id
        LEFT JOIN questions q ON q.chapter_id = c.id
       GROUP BY c.id, c.name, s.name, t.code
    )
    SELECT * FROM counted
     WHERE questions > 0 AND passages < ${THIN}
     ORDER BY questions DESC, chapter`;
  // count(*) comes back as bigint, which the driver hands over as BigInt.
  return rows.map((r) => ({
    chapter: String(r.chapter),
    subject: String(r.subject),
    track: r.track === null ? null : String(r.track),
    passages: Number(r.passages),
    questions: Number(r.questions),
    passage_book: r.passage_book === null ? null : String(r.passage_book),
    passage_books: Number(r.passage_books),
  }));
}

type Attribution = { folder: string; how: 'taxonomy' | 'passages' } | { folder: null; how: 'unknown' };

function attribute(row: Row, all: Book[]): Attribution {
  // Books that could serve this chapter at all. Track is a filter, not the
  // decider: a book shared by GS and LS serves both.
  const serving = all.filter(
    (b) => b.subject === row.subject && (!row.track || b.tracks.includes(row.track)),
  );
  const named = serving.filter((b) => b.titles.has(fold(row.chapter)));

  if (named.length === 1) return { folder: named[0]!.folder, how: 'taxonomy' };

  // Two books both naming the chapter, or none naming it: ask the passages.
  // Only usable when they agree on one source document.
  if (row.passage_books === 1 && row.passage_book) {
    if (named.length > 1 && !named.some((b) => b.folder === row.passage_book)) {
      return { folder: null, how: 'unknown' };
    }
    return { folder: row.passage_book, how: 'passages' };
  }
  return { folder: null, how: 'unknown' };
}

async function main() {
  const all = await books();
  const found = await thinChapters();

  /*
   * Placeholder chapters are not a corpus gap and must not be counted as one.
   *
   * prisma/seed-data.ts writes a provisional syllabus so no screen is dead
   * before ingest — "Suites numériques", "Circuit RC" — under subjects with no
   * track. Every real book in catalog.csv serves at least one track, so a
   * subject without one can have no book behind it and will never be fixed by
   * an override. They are reported separately rather than dropped, because
   * "not in this report" and "not a problem" are different things: they are
   * still twelve questions a student could be shown with nothing behind them,
   * and `npm run db:prune` is what removes them.
   */
  const rows = found.filter((r) => r.track !== null);
  const placeholder = found.filter((r) => r.track === null);

  const byBook = new Map<string, { rows: Row[]; how: Set<string> }>();
  for (const row of rows) {
    const a = attribute(row, all);
    const key = a.folder ?? '(unattributed)';
    const entry = byBook.get(key) ?? { rows: [], how: new Set<string>() };
    entry.rows.push(row);
    entry.how.add(a.how);
    byBook.set(key, entry);
  }

  const total = (rs: Row[]) => rs.reduce((n, r) => n + r.questions, 0);
  const order = [...byBook.entries()].sort((a, b) => total(b[1].rows) - total(a[1].rows));

  const out: string[] = [
    '# Stranded questions',
    '',
    `Chapters holding questions but fewer than ${THIN} passages: retrieval cannot reach`,
    'their material, so the tutor answers them out of a neighbouring chapter — fluently,',
    'with a citation.',
    '',
    'Regenerate with `npm run report:stranded`. The book named against each group is the',
    'book whose taxonomy (`corpus/taxonomy/<book>.json`) actually lists the chapter, not',
    'the first book that happens to serve the subject. Groups marked `via passages` were',
    'attributed from the source document of the passages already filed there, which is',
    'the weaker signal — verify those before writing an override.',
  ];

  for (const [folder, { rows: rs, how }] of order) {
    const label =
      folder === '(unattributed)'
        ? 'NO BOOK IDENTIFIED — no taxonomy names these chapters'
        : folder;
    const signal = how.has('passages') && !how.has('taxonomy') ? '   (via passages)' : '';
    out.push('', `## ${label}${signal}`, '', `${total(rs)} questions across ${rs.length} chapter(s)`);
    if (folder !== '(unattributed)') {
      out.push('', `override: \`scripts/corpus/toc-overrides/${folder}.md\``);
    }
    out.push('', '```');
    for (const r of rs) {
      const name = r.chapter.length > 52 ? `${r.chapter.slice(0, 51)}…` : r.chapter;
      out.push(
        `${(r.track ?? '--').padEnd(4)} ${r.subject.padEnd(20)} ${name.padEnd(54)}` +
          `${String(r.passages).padStart(3)} passages ${String(r.questions).padStart(4)} questions`,
      );
    }
    out.push('```');
  }

  if (placeholder.length) {
    out.push(
      '',
      '## Not corpus — placeholder seed data',
      '',
      `${total(placeholder)} questions across ${placeholder.length} chapter(s), on subjects with no`,
      'track. These come from `prisma/seed-data.ts`, not from any book, so no override',
      'will fix them; `npm run db:prune` removes them.',
      '',
      '```',
    );
    for (const r of placeholder) {
      out.push(
        `     ${r.subject.padEnd(20)} ${r.chapter.padEnd(54)}` +
          `${String(r.passages).padStart(3)} passages ${String(r.questions).padStart(4)} questions`,
      );
    }
    out.push('```');
  }

  out.push('', `TOTAL: ${total(rows)} questions in ${rows.length} chapters across ${byBook.size} books.`, '');

  await writeFile(OUT, out.join('\n'), 'utf8');
  console.log(`${total(rows)} stranded questions, ${rows.length} chapters -> ${OUT}`);
  for (const [folder, { rows: rs, how }] of order) {
    console.log(`  ${String(total(rs)).padStart(4)}  ${folder}  (${[...how].join('+')})`);
  }
  await db.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
