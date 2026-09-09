/**
 * Loads the real curriculum taxonomy from the transcribed CRDP books.
 *
 * Reads `scripts/corpus/catalog.csv` (which book, which subject, which tracks)
 * and `corpus/taxonomy/<book>.json` (the chapter list parsed from each book's
 * own table of contents), and writes tracks, subjects, units and chapters.
 *
 * This is the authoritative taxonomy: every chapter name here was read off a
 * real textbook's contents page by `scripts/corpus/taxonomy.py`, and every
 * (subject, track, language) triple comes from the book's own ingestion record.
 * Nothing in this path is invented.
 *
 * A book that serves two tracks produces a subject row in EACH of them. That is
 * deliberate: `Subject` carries `trackId` and everything downstream keys off it
 * — retrieval scopes by the subject list of the student's locked track, and
 * chapter mastery is per chapter. A single shared subject would mean a GS
 * student's mastery moving because LS students answered. Duplicating costs one
 * extra embedding per shared chunk, which is cents, and keeps every per-track
 * number honest.
 *
 * Idempotent: chapters are matched on (subject, orderIndex) and updated in
 * place, so re-running after a taxonomy fix does not create duplicates and does
 * not orphan any content already filed under a chapter.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { Language, PrismaClient } from '@prisma/client';

const ROOT = path.resolve(__dirname, '..');
const CATALOG = path.join(ROOT, 'scripts', 'corpus', 'catalog.csv');
const TAXONOMY = path.join(ROOT, 'corpus', 'taxonomy');

/**
 * The four official branches of the Lebanese Baccalaureate.
 *
 * Codes are the English initialisms, because that is what the 38 transcribed
 * books and every file in `corpus/taxonomy/` are already filed under. The
 * French names are kept as the display names — they are what appears on the
 * ministry's own papers.
 */
export const TRACK_NAMES: Record<string, string> = {
  GS: 'Sciences Générales',
  LS: 'Sciences de la Vie',
  SE: 'Sociologie et Économie',
  LH: 'Lettres et Humanités',
};

export type CatalogRow = {
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

export type TaxonomyResult = {
  /** False when there is no catalog on disk — a clone without the corpus. */
  corpusPresent: boolean;
  subjects: number;
  units: number;
  chapters: number;
  /**
   * Chapters a later book named that an earlier book in the same subject had
   * already created, so no second row was made. Almost all of these are a
   * workbook repeating its textbook's chapters. Reported rather than counted
   * silently: if this number is large in a subject with one book, the dedup is
   * fusing chapters that are not the same and the corpus is worse for it.
   */
  sharedChapters: number;
  /** Books the catalog names but whose chapter list could not be read. */
  skipped: string[];
};

/*
 * Back matter is not a chapter.
 *
 * Every one of these appears in a real contents page and the parser cannot tell
 * it from a chapter, but filing questions under "Answers and Hints" would put a
 * mastery bar on a section that teaches nothing. Matched on the title because
 * that is the only signal the contents page gives.
 */
const BACK_MATTER =
  /^(self[\s-]*eval|answers?\b|corrig|solutions?\b|index\b|glossar|bibliograph|table\s+of\s+contents|appendix|annexe)/i;

/**
 * Tidies a title read off a scanned contents page.
 *
 * Mathpix returns titles with the maths still wrapped in LaTeX, so a chapter
 * arrives as `Amines and $\alpha$-amino acids` or `Special Relativity
 * ( ${ }^{*}$ )`. Those render as literal dollar signs in a sidebar, and the
 * `*` markers are the book's own footnote for optional material, not part of
 * the name.
 *
 * Deliberately conservative: it unwraps a handful of known commands and strips
 * empty maths, and leaves anything it does not recognise alone rather than
 * mangling a title it did not understand.
 */
export function cleanChapterTitle(raw: string): string {
  const GREEK: Record<string, string> = {
    alpha: 'α',
    beta: 'β',
    gamma: 'γ',
    delta: 'δ',
    lambda: 'λ',
    mu: 'μ',
    pi: 'π',
    sigma: 'σ',
    omega: 'ω',
  };

  return (
    raw
      // `$\alpha$` and friends — the commonest case by far.
      .replace(/\$\s*\\([a-zA-Z]+)\s*\$/g, (match, name: string) => GREEK[name.toLowerCase()] ?? match)
      // `${ }^{*}$` — Mathpix's rendering of a footnote asterisk.
      .replace(/\$\{\s*\}\s*\^\{?\s*\*\s*\}?\$/g, '*')
      // Any maths that is now empty or whitespace-only.
      .replace(/\$\s*\$/g, '')
      // `( * )` left behind by the above.
      .replace(/\(\s*\*\s*\)/g, '(*)')
      .replace(/\s{2,}/g, ' ')
      .trim()
      // A trailing footnote marker adds nothing to a chapter name.
      .replace(/\s*\(\*\)\s*$/, '')
      .trim()
  );
}

/**
 * Decides whether a parsed chapter list is trustworthy enough to seed.
 *
 * The English books' contents pages defeated the parser: it came back with
 * "Part A", "Part C", "Part D", "The Authors" and "Writing Topics" twice. Those
 * are the book's structural furniture, not chapters, and seeding them puts
 * "Part D" in a student's sidebar with a mastery bar beside it.
 *
 * A curriculum is the spine this whole product hangs off, so the rule is: when
 * a list looks like furniture rather than chapters, seed nothing for that book
 * and say so. A missing subject is obviously missing and gets fixed; a subject
 * full of "Part C" looks like a working feature and does not.
 *
 * Two signals, both cheap and both specific:
 *   * a bare structural label — "Part A", "Section 2", "Unit B" with nothing
 *     after it; and
 *   * a duplicated title, which a real contents page does not have.
 */
const STRUCTURAL_LABEL = /^(part|section|unit|partie|chapter|chapitre)\s+[A-Za-z0-9]{1,3}$/i;

export function looksUnparsed(chapters: { title: string; unit?: string | null }[]): boolean {
  if (chapters.length === 0) return true;

  // No Grade 12 textbook has one or two chapters. A list this short means the
  // parser found a stray heading, not a contents page — "The Authors" on its
  // own was seeding an entire subject.
  if (chapters.length < 3) return true;

  const structural = chapters.filter((c) => STRUCTURAL_LABEL.test(c.title)).length;

  /*
   * Duplicates are counted per unit, not across the book.
   *
   * The English "Themes" textbook repeats the same three chapter names —
   * "The World Within Us", "The World Around Us", "New Worlds" — inside each of
   * its three thematic units. That is the book's actual design, and judging the
   * titles alone declared a correctly-parsed contents page unreadable. A
   * duplicate only means something when the same title appears twice in the
   * same unit.
   */
  const seen = new Set<string>();
  let duplicated = 0;
  for (const chapter of chapters) {
    const key = `${chapter.unit ?? ''}::${chapter.title.toLowerCase()}`;
    if (seen.has(key)) duplicated += 1;
    seen.add(key);
  }

  // Two in five is well past anything a real contents page produces, and well
  // clear of a book that legitimately opens with one "Part 1" heading.
  return (structural + duplicated) / chapters.length >= 0.4;
}

/** Minimal CSV reader — the catalog has quoted fields containing commas. */
export function parseCsv(text: string): CatalogRow[] {
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
    // The catalog is written with a BOM by Excel; strip it off the first header.
    (r) => Object.fromEntries(header.map((h, i) => [h.replace(/^﻿/, '').trim(), r[i] ?? ''])) as CatalogRow,
  );
}

export async function loadCorpusTaxonomy(
  db: PrismaClient,
  options: { dry?: boolean } = {},
): Promise<TaxonomyResult> {
  const dry = options.dry ?? false;

  let catalogText: string;
  try {
    catalogText = await readFile(CATALOG, 'utf8');
  } catch {
    // No corpus checked out. Callers fall back to the placeholder taxonomy.
    return { corpusPresent: false, subjects: 0, units: 0, chapters: 0, sharedChapters: 0, skipped: [] };
  }

  const catalog = parseCsv(catalogText);
  const result: TaxonomyResult = {
    corpusPresent: true,
    subjects: 0,
    units: 0,
    chapters: 0,
    sharedChapters: 0,
    skipped: [],
  };

  /*
   * Where the next book's chapters start, per subject.
   *
   * Several subjects are taught from more than one book: GS mathematics is an
   * algebra/geometry volume and a calculus/statistics volume, LH Arabic is a
   * literature reader and a grammar book, LH English is three. Chapters were
   * keyed on (subject, orderIndex) starting from zero for every book, so the
   * second book overwrote the first one chapter for chapter — GS mathematics
   * ended up with 24 chapters instead of 46, and a student's syllabus silently
   * lost complex numbers, vectors, planes and lines and the whole of logic.
   *
   * Each book now gets its own contiguous range. Order follows the catalog, so
   * the indices are stable across runs and a re-run still updates in place.
   */
  const nextChapterIndex = new Map<string, number>();
  const nextUnitIndex = new Map<string, number>();
  const chaptersPerSubject = new Map<string, number>();

  /*
   * Chapter names already claimed in each subject, so two books teaching the
   * same chapter share one row.
   *
   * A textbook and its workbook cover the SAME chapters — "Learning from Our
   * Past" is chapter one of both `themes-lh-en` and `themes-workbook-lh-en` —
   * and giving each book its own contiguous range (above) meant each of those
   * chapters was created twice. The student's index then listed every chapter
   * twice, once holding the textbook's passages and once the workbook's, with
   * the second copy reading "No practice questions for this chapter yet". That
   * is what the duplicate-chapter complaint was: English SE carried 18 chapters
   * for 11 distinct names, GS and LS 6 for 3.
   *
   * Keyed on the title plus HOW MANY TIMES that title has already appeared in
   * the same book. `looksUnparsed` above records why a bare name will not do:
   * the English Themes readers repeat "The World Within Us", "The World Around
   * Us" and "New Worlds" inside each of their three thematic units, by design,
   * and a name-only key would fuse those three real chapters into one. Counting
   * occurrences keeps them apart (#0, #1, #2 within the book) while still
   * matching a workbook's first "Learning from Our Past" to its textbook's.
   *
   * Keying on the UNIT instead was tried and matched too little: the textbook
   * heads its unit "History: The World in the Making" and the workbook heads
   * the same unit "History - The World in the Making", so 13 of the 24
   * duplicates in the database survived on a colon.
   *
   * Matched on the exact folded name, not on similarity. Two SE readers print
   * "Socio-economic Issues: Employment, Immigration, Living Standards" and
   * "Socio-economic Issues: Emigration, Employment, Production, Living
   * Standards" — a human can see those are one chapter, and no rule here can,
   * so they stay separate. Merging on a guess would fuse two real chapters and
   * take a student's mastery with it; leaving a near-duplicate is recoverable.
   *
   * `load-chunks` already resolves chapters BY NAME, so the second book's
   * passages land on the shared row with no further change.
   */
  const namesPerSubject = new Map<string, Map<string, number>>();
  const foldName = (s: string) => s.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
  let sharedChapters = 0;

  for (const row of catalog) {
    if (!row.book_name || !row.folder) continue;

    let taxonomy: { chapters?: Chapter[] };
    try {
      taxonomy = JSON.parse(await readFile(path.join(TAXONOMY, `${row.folder}.json`), 'utf8'));
    } catch {
      result.skipped.push(`${row.book_name} — no taxonomy file`);
      continue;
    }

    const list = (taxonomy.chapters ?? [])
      .map((c) => ({ ...c, title: cleanChapterTitle(c.title ?? '') }))
      .filter((c) => c.title && !BACK_MATTER.test(c.title));

    if (list.length === 0) {
      result.skipped.push(`${row.book_name} — taxonomy has no chapters`);
      continue;
    }

    const unparsed = looksUnparsed(list.map((c) => ({ title: c.title, unit: c.unit })));
    if (unparsed) {
      result.skipped.push(
        `${row.book_name} — contents page did not parse into chapters (got "${list
          .slice(0, 3)
          .map((c) => c.title)
          .join('", "')}…"); re-run scripts/corpus/taxonomy.py for this book`,
      );
    }

    const language = row.language as Language;

    for (const code of row.tracks.split(';').map((t) => t.trim()).filter(Boolean)) {
      const track = dry
        ? await db.track.findUnique({ where: { code }, select: { id: true } })
        : await db.track.upsert({
            where: { code },
            update: {},
            create: { code, name: TRACK_NAMES[code] ?? code },
            select: { id: true },
          });

      /*
       * On a dry run the subject may not exist yet, and its id is what the unit
       * and chapter upserts key on. The loop still runs to the end with a null
       * id and every write guarded — the alternative, skipping ahead, was
       * reporting 83 chapters for a corpus of 650.
       */
      let subject = track
        ? await db.subject.findFirst({
            where: { trackId: track.id, name: row.subject, language },
            select: { id: true },
          })
        : null;

      if (!subject && !dry && track) {
        subject = await db.subject.create({
          data: { trackId: track.id, name: row.subject, language },
          select: { id: true },
        });
      }
      result.subjects += 1;

      /*
       * A book whose contents page did not parse gets its previously-seeded
       * chapters withdrawn, so a bad parse does not leave "Part D" sitting in
       * a student's sidebar forever. Only empty chapters go: anything with
       * questions or mastery filed under it is somebody's work and is reported
       * instead.
       */
      if (unparsed) {
        if (dry || !subject) continue;

        const stale = await db.chapter.findMany({
          where: { subjectId: subject.id },
          select: {
            id: true,
            name: true,
            _count: { select: { questions: true, contentChunks: true, chapterMastery: true } },
          },
        });

        for (const chapter of stale) {
          const used =
            chapter._count.questions + chapter._count.contentChunks + chapter._count.chapterMastery;
          if (used > 0) {
            result.skipped.push(
              `${row.book_name} — kept "${chapter.name}" from the bad parse; it has ${used} row(s) filed under it`,
            );
            continue;
          }
          await db.chapter.delete({ where: { id: chapter.id } });
        }
        continue;
      }

      // Units, in the order they appear in the book.
      const unitIds = new Map<string, string>();
      const unitNames = [...new Set(list.map((c) => c.unit).filter(Boolean))] as string[];
      const unitBase = subject ? nextUnitIndex.get(subject.id) ?? 0 : 0;
      if (subject) nextUnitIndex.set(subject.id, unitBase + unitNames.length);

      for (const [offset, name] of unitNames.entries()) {
        const i = unitBase + offset;
        result.units += 1;
        if (dry || !subject) continue;

        const unit = await db.unit.upsert({
          where: { subjectId_orderIndex: { subjectId: subject.id, orderIndex: i } },
          update: { name },
          create: { subjectId: subject.id, name, orderIndex: i },
          select: { id: true },
        });
        unitIds.set(name, unit.id);
      }

      // Chapters keyed on (subject, orderIndex) so a re-run updates in place
      // rather than duplicating — anything already filed under a chapter keeps
      // pointing at the same row.
      //
      // An index is allocated only for a name this subject has not seen, so a
      // workbook repeating its textbook's chapters consumes none. See
      // `namesPerSubject`.
      const subjectKey = subject ? subject.id : `dry:${row.subject}:${language}:${code}`;
      let nextIndex = nextChapterIndex.get(subjectKey) ?? 0;
      let claimed = namesPerSubject.get(subjectKey);
      if (!claimed) {
        claimed = new Map<string, number>();
        namesPerSubject.set(subjectKey, claimed);
      }

      const seenInThisBook = new Map<string, number>();
      for (const chapter of list) {
        const bare = foldName(chapter.title);
        const nth = seenInThisBook.get(bare) ?? 0;
        seenInThisBook.set(bare, nth + 1);
        const key = `${bare}#${nth}`;
        if (claimed.has(key)) {
          // Already a row in this subject, from an earlier book. Its passages
          // will find it by name; creating a second is what produced the
          // duplicated index.
          sharedChapters += 1;
          continue;
        }

        const i = nextIndex;
        nextIndex += 1;
        claimed.set(key, i);
        result.chapters += 1;
        nextChapterIndex.set(subjectKey, nextIndex);
        if (subject) chaptersPerSubject.set(subject.id, nextIndex);
        if (dry || !subject) continue;

        await db.chapter.upsert({
          where: { subjectId_orderIndex: { subjectId: subject.id, orderIndex: i } },
          update: {
            name: chapter.title,
            unitId: chapter.unit ? unitIds.get(chapter.unit) ?? null : null,
          },
          create: {
            subjectId: subject.id,
            name: chapter.title,
            orderIndex: i,
            unitId: chapter.unit ? unitIds.get(chapter.unit) ?? null : null,
          },
        });
      }

    }
  }


  /*
   * Trailing chapters from a longer previous run.
   *
   * Runs once per subject, after every book that feeds it has been placed — not
   * once per book. Inside the per-book loop it would look at a subject whose
   * second book had not been processed yet and delete that book's chapters as
   * "past the end of the list".
   *
   * Only empty ones go. A stale chapter with questions or mastery filed under it
   * is somebody's work, and silently cascading it away on a taxonomy re-run is
   * not a trade this project makes; it is reported for a human instead.
   */
  for (const [subjectId, total] of chaptersPerSubject) {
    if (dry) break;

    const trailing = await db.chapter.findMany({
      where: { subjectId, orderIndex: { gte: total } },
      select: {
        id: true,
        name: true,
        orderIndex: true,
        _count: { select: { questions: true, contentChunks: true, chapterMastery: true } },
      },
    });

    for (const stale of trailing) {
      const used =
        stale._count.questions + stale._count.contentChunks + stale._count.chapterMastery;
      if (used > 0) {
        result.skipped.push(
          `kept "${stale.name}" (index ${stale.orderIndex}); past the end of the list but has ${used} row(s) filed under it`,
        );
        continue;
      }
      await db.chapter.delete({ where: { id: stale.id } });
    }
  }
  result.sharedChapters = sharedChapters;
  return result;
}
