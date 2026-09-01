/**
 * Splits stranded chapters into the two causes that look identical from outside.
 *
 *   node scripts/corpus/stranded-causes.mjs
 *
 * A chapter with fewer than five passages cannot be retrieved by any query ever
 * asked, and the tutor answers its questions out of a neighbouring chapter —
 * fluently, with a citation. There are 155 of them. They have two causes and
 * only one is fixable by writing a table-of-contents override:
 *
 *   MIS-FILED — the book's text is in the corpus, and the locator put the
 *   chapter in the wrong place, so its pages were absorbed by a neighbour. This
 *   is what happened to Alcohols, which went from 2 passages to 37 once its
 *   entry was corrected. Fixable, and worth doing.
 *
 *   MISSING — the pages were never ingested. The GS/LS chemistry book has 527
 *   passages spanning pages 18 to 392 with a 34-page hole at 274-307, exactly
 *   where "Amines and α-amino acids" sits. No override can fix that, because
 *   there is nothing for the locator to find. It needs the pages re-read.
 *
 * The test is a contiguous run of blank pages inside the span the chapter ought
 * to occupy. Two weaker tests were written first and both reported zero missing
 * chapters, which was known to be wrong before either was run:
 *
 *   Book-wide page density said the chemistry book was healthy. A 34-page hole
 *   in a 375-page book is invisible to any measure of the whole.
 *
 *   "Is the chapter's span empty" said the same. A disputed span nearly always
 *   holds text, because it contains the neighbour that swallowed the chapter.
 *
 * Only a *run* of blank pages distinguishes them, and the reason all three were
 * not equally believable is that one chapter had been checked by hand first. A
 * classifier with no known answer to agree with is a classifier that confirms
 * whatever it was written to expect.
 *
 * Attribution is by taxonomy, never by subject and track. Several subjects have
 * two or three books — the seeder writes `chapter.name` from the taxonomy title
 * verbatim, so matching on that title is exact where matching on subject is a
 * guess.
 */
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();
const TAXONOMY = path.resolve('corpus/taxonomy');

/** Which book names each chapter, read from the taxonomy the seeder used. */
function chapterToBook() {
  const map = new Map();
  if (!fs.existsSync(TAXONOMY)) return map;

  for (const file of fs.readdirSync(TAXONOMY).filter((f) => f.endsWith('.json'))) {
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(path.join(TAXONOMY, file), 'utf8'));
    } catch {
      continue;
    }
    const book = parsed.book ?? file.replace(/\.json$/, '');
    // The hash-named twin of every book duplicates it; the readable name wins.
    if (/^[0-9a-f]{40,}$/.test(book)) continue;

    for (const chapter of parsed.chapters ?? []) {
      if (!chapter.title) continue;
      if (!map.has(chapter.title)) {
        map.set(chapter.title, {
          book,
          pdfPage: chapter.pdfPage ?? null,
          pdfPageEnd: chapter.pdfPageEnd ?? null,
          index: chapter.index,
          // The whole chapter list, so a chapter with no page of its own can
          // still be bracketed by the neighbours that do have one.
          siblings: parsed.chapters ?? [],
        });
      }
    }
  }
  return map;
}

async function main() {
  const byTitle = chapterToBook();

  const stranded = await db.$queryRaw`
    SELECT c.name AS chapter, s.name AS subject, t.code AS track,
           (SELECT COUNT(*)::int FROM chapter_content_chunks j WHERE j.chapter_id = c.id) AS passages,
           (SELECT COUNT(*)::int FROM questions q WHERE q.chapter_id = c.id) AS questions
    FROM chapters c
    JOIN subjects s ON s.id = c.subject_id
    JOIN tracks t ON t.id = s.track_id
    WHERE (SELECT COUNT(*) FROM chapter_content_chunks j WHERE j.chapter_id = c.id) < 5
    ORDER BY 5 DESC`;

  /*
   * Where each book actually has text, page by page.
   *
   * A set rather than a range, because the question is not how far a book
   * reaches but whether it has a hole — and a hole is invisible to any measure
   * of total coverage. The GS/LS chemistry book runs from page 18 to 392 with
   * 527 passages and is missing 274-307 entirely; by any book-wide density it
   * looks healthy, which is exactly how that chapter stayed lost.
   */
  const pageRows = await db.$queryRaw`
    SELECT sd.book_key AS book, cc.source_page_from AS page
    FROM source_documents sd
    JOIN content_chunks cc ON cc.source_document_id = sd.id
    WHERE cc.source_page_from IS NOT NULL`;

  const pagesByBook = new Map();
  for (const row of pageRows) {
    if (!pagesByBook.has(row.book)) pagesByBook.set(row.book, new Set());
    pagesByBook.get(row.book).add(row.page);
  }

  /**
   * The pages a chapter ought to occupy.
   *
   * Its own if the locator placed it. Otherwise the space between the nearest
   * placed chapter before it and the nearest after — which is precisely the
   * span a neighbour will have swallowed if the chapter was mis-filed, and
   * precisely the span that will be empty if the pages were never read.
   */
  function expectedRange(attribution) {
    if (!attribution) return null;
    if (attribution.pdfPage != null) {
      return [attribution.pdfPage, attribution.pdfPageEnd ?? attribution.pdfPage];
    }

    const siblings = attribution.siblings ?? [];
    const self = siblings.findIndex((c) => c.index === attribution.index);
    if (self < 0) return null;

    /*
     * The previous chapter's START, never its claimed end.
     *
     * Its end is the very thing under suspicion: when a chapter cannot be
     * located, the neighbour before it is handed the pages it should have had,
     * so its `pdfPageEnd` already covers the missing chapter. Measuring from
     * that end asks "is there text in the pages the neighbour claimed?" — to
     * which the answer is always yes, and every chapter came back mis-filed.
     * Measuring from the neighbour's start looks at the whole disputed span.
     */
    let before = null;
    for (let i = self - 1; i >= 0; i -= 1) {
      if (siblings[i]?.pdfPage != null) { before = siblings[i].pdfPage; break; }
    }
    let after = null;
    for (let i = self + 1; i < siblings.length; i += 1) {
      if (siblings[i]?.pdfPage != null) { after = siblings[i].pdfPage; break; }
    }
    if (before == null || after == null || after <= before) return null;
    return [before, after];
  }

  const seen = new Set();
  const rows = [];
  for (const s of stranded) {
    if (seen.has(s.chapter)) continue; // the same chapter exists once per track
    seen.add(s.chapter);

    const attribution = byTitle.get(s.chapter);
    const book = attribution?.book ?? null;
    const range = expectedRange(attribution);
    const pages = book ? pagesByBook.get(book) : null;

    let cause = 'unknown';
    let detail = '';
    if (pages && range) {
      const [lo, hi] = range;
      const width = hi - lo + 1;

      /*
       * The longest run of consecutive pages with no text.
       *
       * Not "is the span empty" — a disputed span nearly always holds some
       * text, because it includes the neighbour that swallowed it, so that test
       * called every chapter mis-filed. A chapter whose pages were never read
       * leaves a *contiguous hole*: the GS/LS chemistry book has text on
       * 251-273 and again from 308, and nothing across the 34 pages between.
       * That run is the fingerprint.
       */
      let run = 0;
      let longest = 0;
      let withText = 0;
      for (let page = lo; page <= hi; page += 1) {
        if (pages.has(page)) {
          withText += 1;
          run = 0;
        } else {
          run += 1;
          if (run > longest) longest = run;
        }
      }

      // Five pages is about a chapter's worth in these books, and short enough
      // to catch a small one without firing on ordinary front matter.
      cause = longest >= 5 ? 'PAGES MISSING' : 'mis-filed';
      detail = longest >= 5 ? `${longest} blank pages in ${width}` : `${withText}/${width} pages have text`;
    }

    rows.push({ chapter: s.chapter, subject: s.subject, questions: s.questions, book: book ?? '(not in any taxonomy)', cause, detail });
  }

  const misfiled = rows.filter((r) => r.cause === 'mis-filed');
  const missing = rows.filter((r) => r.cause === 'PAGES MISSING');
  const unknown = rows.filter((r) => r.cause === 'unknown');
  const qOf = (list) => list.reduce((n, r) => n + r.questions, 0);

  console.log('');
  console.log(`  distinct stranded chapters   ${rows.length}   holding ${qOf(rows)} questions`);
  console.log('');
  console.log(`  mis-filed      ${String(misfiled.length).padStart(3)} chapters, ${String(qOf(misfiled)).padStart(3)} questions   text is in the book — an override fixes these`);
  console.log(`  pages missing  ${String(missing.length).padStart(3)} chapters, ${String(qOf(missing)).padStart(3)} questions   never ingested — the pages must be re-read`);
  console.log(`  unattributed   ${String(unknown.length).padStart(3)} chapters, ${String(qOf(unknown)).padStart(3)} questions   no taxonomy names this chapter`);
  console.log('');

  console.log('  worst by questions lost:');
  for (const r of rows.slice(0, 14)) {
    console.log(
      `   ${String(r.questions).padStart(3)}q  ${String(r.cause).padEnd(14)} ${String(r.detail).padEnd(20)} ${r.chapter.slice(0, 38)}`,
    );
  }
  console.log('');

  await db.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
