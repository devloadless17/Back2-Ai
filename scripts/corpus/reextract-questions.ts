import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { db } from '../../src/lib/db';

/**
 * Re-reads a question's body from its own PDF, keeping the printed layout.
 *
 *   npm run corpus:reextract -- --subject Physics --limit 20 --dry
 *   npm run corpus:reextract -- --subject Physics
 *
 * The reader used at ingestion returns text in its own order and drops the
 * spatial arrangement, which on an exam page is most of the meaning. The worst
 * question in the corpus had 46 lines of debris: every vector arrow gone,
 * `dv/dt` collapsed to a bare "dx .", and the labels belonging to the diagram —
 * x, O, G, A, Doc. 1 — dumped into the middle of the prose as separate lines,
 * with the page number after them. It reads as noise because it is noise: the
 * page was read as a bag of text runs rather than as a page.
 *
 * `pdftotext -layout` reads the same page in reading order and keeps columns
 * apart, so the diagram's labels stay beside the diagram instead of landing in
 * the sentence. With `-enc UTF-8` it also returns the symbols: 1,068 of the
 * repaired questions carry Greek letters and 1,055 carry a real −, × or °.
 *
 * What it does not recover is structure. A fraction is still two lines, because
 * in the PDF a fraction is a numerator placed above a denominator with a rule
 * drawn between them — there is no markup saying "this is a fraction", and no
 * extractor can infer one without reading the page. That half needs a reading
 * rather than an extraction. This is the free half, and it is the larger one.
 *
 * Only born-digital papers qualify: ~70% carry a real text layer, and on the
 * other 30% pdftotext returns nothing at all, which is why the result is
 * checked for length before anything is written.
 *
 * The result goes to `content_latex`, which the renderer prefers, and NOT over
 * `content_text`. That column is what the original reader returned and is the
 * only evidence of what it saw; overwriting it would destroy the ability to
 * judge any future reader against it. `embedding` is cleared so retrieval
 * matches the text now shown rather than the wreckage it replaced.
 */
const CORPUS_ROOT = 'corpus/exams';
/** Shorter than this and a question's opening can match the wrong exercise. */
const MIN_ANCHOR = 32;
/** Below this the extraction is a scanned page returning nothing useful. */
const MIN_EXTRACT = 200;

type Row = {
  id: string;
  content_text: string;
  cycle_title: string;
  language: string;
  order_index: number;
  source_exam_id: string;
};

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token?.startsWith('--')) continue;
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[token.slice(2)] = next;
      i += 1;
    } else {
      out[token.slice(2)] = true;
    }
  }
  return out;
}

/**
 * Whether a filename claims this language.
 *
 * `_en` alone is not enough: `SE_Eng_2024_1.pdf` is the English-language exam,
 * not the English edition of a science paper, and a substring test happily
 * matches the `_Eng` in it. The marker has to end where the language does.
 */
function matchesLanguage(file: string, lang: 'en' | 'fr'): boolean {
  return new RegExp(`_${lang}(?![a-z])`, 'i').test(file);
}

function normalise(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').replace(/[^a-z0-9 ]/g, '').trim();
}

function layoutText(pdf: string, from: number, to: number): string {
  try {
    return execFileSync(
      'pdftotext',
      /*
       * UTF-8 explicitly. Without it poppler falls back to Latin-1 and every
       * character outside it is dropped rather than substituted — α vanishes to
       * nothing and U+2212 MINUS becomes a hyphen. "α = 10⁻ᵖᴴ/C" then reads
       * " = 10- pH/C", which is not a damaged formula but a different one, and
       * nothing in the output says a character was lost.
       */
      ['-layout', '-enc', 'UTF-8', '-f', String(from), '-l', String(to), pdf, '-'],
      { encoding: 'utf8', maxBuffer: 20_000_000 },
    );
  } catch {
    return '';
  }
}

function pageCount(pdf: string): number {
  try {
    const info = execFileSync('pdfinfo', [pdf], { encoding: 'utf8' });
    return Number(/Pages:\s+(\d+)/.exec(info)?.[1] ?? 0);
  } catch {
    return 0;
  }
}

/**
 * Tidies what `-layout` leaves behind, without rewriting anything.
 *
 * Column alignment is padding rather than content and collapses to nothing in
 * HTML anyway; a page footer like "3/13" is furniture the examiner printed for
 * the invigilator, not part of the question. Everything else is left exactly as
 * the page has it, including the line breaks, which the renderer now keeps.
 */
function tidy(raw: string): string {
  const lines = raw
    .split('\n')
    .map((line) => line.replace(/[ \t]{3,}/g, '  ').trimEnd())
    // A page footer like "3/13" is furniture printed for the invigilator.
    .filter((line) => !/^\s*\d{1,2}\s*\/\s*\d{1,2}\s*$/.test(line));

  /*
   * Drop the masthead.
   *
   * These papers open with the ministry's Arabic header — session, year, the
   * candidate's details — and pdftotext renders those glyphs as bare colons,
   * dots and digits, because the embedded font carries no usable mapping. The
   * question then begins "2024 2024 1 : : . . ." before the examiner has said
   * anything, which reads as corruption rather than as a header to skip past.
   *
   * Everything before the first line carrying real words is cut. "Real" is four
   * or more consecutive letters — which that debris never produces, and which no
   * exercise title lacks.
   */
  const first = lines.findIndex((line) => /[A-Za-z؀-ۿ]{4,}/.test(line));

  return (first > 0 ? lines.slice(first) : lines)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const subject = typeof args.subject === 'string' ? args.subject : null;
  const limit = Number(args.limit ?? 0) || 200;
  const dry = Boolean(args.dry);

  const rows = await db.$queryRaw<Row[]>`
    SELECT q.id, q.content_text, q.order_index, q.source_exam_id,
           ec.title AS cycle_title, ec.language::text AS language
      FROM questions q
      JOIN exam_cycles ec ON ec.id = q.source_exam_id
      JOIN chapters c ON c.id = q.chapter_id
      JOIN subjects s ON s.id = c.subject_id
     WHERE q.content_latex IS NULL
       AND s.name = ${subject ?? ''}
       /*
        * Any stranded line at all, not five.
        *
        * Five was picked to find the worst and duly found them, but it also
        * skipped 1,715 questions with one to four — including the chemistry
        * question this whole thread started from, which has three: "C", "pH?"
        * and "= 10?", the wreckage of one fraction. A question needs only one
        * destroyed formula to be unanswerable, so the count says how ugly the
        * damage is, not whether it matters.
        */
       AND (SELECT count(*) FROM unnest(string_to_array(q.content_text, chr(10))) l
             WHERE length(trim(l)) BETWEEN 1 AND 3 AND trim(l) <> '') >= 1
     ORDER BY ec.year DESC, q.order_index ASC
     LIMIT ${limit}`;

  console.log(`  damaged candidates: ${rows.length}`);

  const cache = new Map<string, { pdf: string; pages: string[] }[]>();
  let rewritten = 0;
  let noPaper = 0;
  let noPage = 0;
  let tooShort = 0;

  for (const row of rows) {
    const match = /^(.+?)\s+(GS|LS|LH|SE|SG|SV)\s+(\d{4})\s+—\s+session\s*(\d)/i.exec(row.cycle_title);
    if (!match) { noPaper += 1; continue; }

    const dir = path.join(CORPUS_ROOT, (match[2] ?? '').toLowerCase(), `${match[3]} ${match[4]}`);
    const lang = row.language === 'fr' ? 'fr' : 'en';
    const cacheKey = `${dir}|${lang}`;

    if (!cache.has(cacheKey)) {
      const docs: { pdf: string; pages: string[] }[] = [];
      if (existsSync(dir)) {
        for (const file of readdirSync(dir)) {
          if (!file.toLowerCase().endsWith('.pdf')) continue;
          if (!matchesLanguage(file, lang)) continue;
          const pdf = path.join(dir, file);
          const total = pageCount(pdf);
          const pages = Array.from({ length: total }, (_, i) => layoutText(pdf, i + 1, i + 1));
          if (pages.join('').trim().length > MIN_EXTRACT) docs.push({ pdf, pages });
        }
      }
      cache.set(cacheKey, docs);
    }

    /*
     * Every candidate is searched, not just the first with text in it.
     *
     * A year's folder holds one paper per subject, and the only thing naming
     * which is which is a filename convention that changed partway through the
     * collection — `phy_en_ehteyejet.pdf` early, `SELH_Phys_2024_1_En_0.pdf`
     * later. Stopping at the first readable file picked whichever sorted first,
     * so a physics question was looked for in the English-language paper and
     * duly not found. The anchor decides which paper it is; the filename only
     * narrows the search.
     */
    const docs = cache.get(cacheKey) ?? [];
    if (docs.length === 0) { noPaper += 1; continue; }

    /*
     * The anchor shortens until it matches, then stops.
     *
     * A damaged opening may carry debris the page does not — a stray label, a
     * fragment of the previous exercise — and a fixed 60-character window then
     * matches nothing even though the question is plainly on the page. Falling
     * back to 45 and 32 recovers those. It stops at 32 because below that an
     * opening like "the aim of this exercise is to study" is printed on several
     * papers, and a shorter anchor stops identifying and starts guessing.
     */
    const full = normalise(row.content_text);
    let doc: { pdf: string; pages: string[] } | null = null;
    let start = -1;

    /*
     * Anchors are tried from further into the question as well as shorter.
     *
     * The opening is not always printed text. The loader prefixes some
     * questions with the exercise title it derived, and where the original
     * reader mangled the first line the debris is in the anchor but not on the
     * page. Offsets of 0, 80 and 160 characters step past that into prose the
     * examiner definitely printed; widths of 60, 45 and 32 tolerate a word lost
     * inside the window.
     *
     * It stops at 32 characters because below that, openings like "the aim of
     * this exercise is to study" appear on several papers, and the anchor stops
     * identifying a question and starts guessing at one.
     */
    outer: for (const offset of [0, 80, 160]) {
      if (offset > 0 && full.length < offset + MIN_ANCHOR) break;
      for (const width of [60, 45, MIN_ANCHOR]) {
        const anchor = full.slice(offset, offset + width);
        if (anchor.length < MIN_ANCHOR) continue;
        for (const candidate of docs) {
          const at = candidate.pages.findIndex((text) => normalise(text).includes(anchor));
          if (at >= 0) { doc = candidate; start = at; break outer; }
        }
      }
    }
    if (!doc || start < 0) { noPage += 1; continue; }

    /*
     * How far the exercise runs.
     *
     * Until the next question of the same paper begins, which is the only
     * boundary the data actually knows. Without it a one-page question absorbs
     * the next exercise; with a page cap it truncates a long one. Two pages is
     * the ceiling because no single exercise in this corpus spans more.
     */
    const next = await db.question.findFirst({
      where: { sourceExamId: row.source_exam_id, orderIndex: { gt: row.order_index } },
      orderBy: { orderIndex: 'asc' },
      select: { contentText: true },
    });

    let end = Math.min(start + 1, doc.pages.length - 1);
    if (next) {
      const nextAnchor = normalise(next.contentText).slice(0, 60);
      for (let page = start; page <= Math.min(start + 2, doc.pages.length - 1); page += 1) {
        if (page > start && normalise(doc.pages[page] ?? '').includes(nextAnchor)) {
          end = page;
          break;
        }
        end = page;
      }
    }

    const body = tidy(doc.pages.slice(start, end + 1).join('\n'));
    if (body.length < MIN_EXTRACT) { tooShort += 1; continue; }

    if (!dry) {
      await db.$executeRaw`
        UPDATE questions SET content_latex = ${body}, embedding = NULL WHERE id = ${row.id}::uuid`;
    }
    rewritten += 1;
  }

  console.log(`  rewritten            ${rewritten}`);
  console.log(`  no born-digital pdf  ${noPaper}`);
  console.log(`  page not identified  ${noPage}`);
  console.log(`  extract too short    ${tooShort}`);
  if (dry) console.log('\n  --dry: nothing written.');
  await db.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
