import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync } from 'node:fs';
import path from 'node:path';

import { db } from '../../src/lib/db';

/**
 * Attaches the printed page to questions that refer to a figure they do not have.
 *
 *   npm run corpus:figures -- --subject Physics --limit 20 --dry
 *   npm run corpus:figures -- --subject Physics
 *
 * 887 questions say "Doc. 1", "Document-2" or "the adjacent circuit", and not one
 * of them carries an image. A physics question whose circuit diagram is missing
 * cannot be answered at all: the student is shown a reference to something that
 * was dropped at ingestion, with no way to tell that anything is missing.
 *
 * The diagram is usually a vector drawing rather than an embedded bitmap, so
 * `pdfimages` has nothing to pull out and the page has to be rendered. This
 * renders the whole page rather than guessing a crop box. A wrong crop removes
 * the diagram again and does it silently; a whole page always contains the
 * figure, in the context the examiner printed it. Tighter crops are worth doing
 * once there is layout detection to base them on — not as a guess now.
 *
 * Which page a question came from was never recorded: `source_page_from` is null
 * on all 5,434 rows. It is recovered by matching the question's opening words
 * against each page's text, which is reliable because ~70% of these papers are
 * born-digital and `pdftotext` reads them exactly. A question whose page cannot
 * be identified is skipped and counted, never given a plausible wrong page.
 *
 * Pages are rendered once and shared. Several questions sit on one page, and
 * rendering per question would multiply both the work and the bytes shipped.
 */
const CORPUS_ROOT = 'corpus/exams';
const OUT_DIR = 'public/figures';
/**
 * 1-bit PNG at 150dpi, not JPEG.
 *
 * These pages are black line art on white — circuit diagrams, axes, gridlines —
 * which is the worst case for JPEG: every sharp edge becomes ringing, and the
 * file stays large because the noise it invents is expensive to encode. The
 * same page is 185kB as JPEG at 100dpi and 64kB as a 1-bit PNG at 150dpi:
 * sharper and a quarter of the size. Across ~700 pages that is 42MB rather than
 * 123MB, and every one of these is committed and shipped on every deploy.
 *
 * `--tone grey` exists for the exception. Geography and sociology papers carry
 * photographs and shaded maps, and one bit per pixel destroys those — a
 * photograph thresholded to black and white is not a smaller photograph, it is
 * a different image.
 */
const DPI = 150;
const GREY_DPI = 110;
/** Shorter than this and the opening of a question can match the wrong exercise. */
const MIN_ANCHOR = 25;

type Row = {
  id: string;
  content_text: string;
  cycle_title: string;
  language: string;
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

/** Normalised for comparison: spacing and punctuation must not decide a match. */
function normalise(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').replace(/[^a-z0-9 ]/g, '').trim();
}

/**
 * Where `ocr_pdf.py` left the transcription of a paper whose text layer is dead.
 *
 * 129 of these papers extract nothing at all — `pdftotext` on
 * ls/2006 1/bio_en.pdf returns an empty string for every page — and those are
 * precisely the papers most likely to need this tool, because a paper that was
 * scanned rather than typeset is a paper whose diagrams were never text. Read
 * from the pdf's sha256 exactly as `extract_exams.py` finds it, so the two
 * agree on which transcription belongs to which paper.
 */
function ocrPage(pdf: string, page: number): string {
  try {
    const sha = createHash('sha256').update(readFileSync(pdf)).digest('hex').slice(0, 8);
    const root = path.join('corpus', 'text');
    if (!existsSync(root)) return '';
    const folder = readdirSync(root).find((name) => name.endsWith(`__${sha}`));
    if (!folder) return '';
    const file = path.join(root, folder, `page-${String(page).padStart(3, '0')}.md`);
    return existsSync(file) ? readFileSync(file, 'utf8') : '';
  } catch {
    return '';
  }
}

function pageText(pdf: string, page: number): string {
  let text = '';
  try {
    text = execFileSync('pdftotext', ['-f', String(page), '-l', String(page), pdf, '-'], {
      encoding: 'utf8',
      maxBuffer: 20_000_000,
    });
  } catch {
    text = '';
  }
  // A dead text layer reads as a handful of stray characters rather than as an
  // error, so the fallback is on emptiness of CONTENT, not on the call failing.
  return text.trim().length > 20 ? text : ocrPage(pdf, page);
}

function pageCount(pdf: string): number {
  try {
    const info = execFileSync('pdfinfo', [pdf], { encoding: 'utf8' });
    const n = Number(/Pages:\s+(\d+)/.exec(info)?.[1] ?? 0);
    if (n > 0) return n;
  } catch {
    // fall through to the transcription
  }
  try {
    const sha = createHash('sha256').update(readFileSync(pdf)).digest('hex').slice(0, 8);
    const root = path.join('corpus', 'text');
    if (!existsSync(root)) return 0;
    const folder = readdirSync(root).find((name) => name.endsWith(`__${sha}`));
    if (!folder) return 0;
    return readdirSync(path.join(root, folder)).filter((f) => /^page-\d+\.md$/.test(f)).length;
  } catch {
    return 0;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const subject = typeof args.subject === 'string' ? args.subject : null;
  const limit = Number(args.limit ?? 0) || 500;
  const dry = Boolean(args.dry);
  const grey = args.tone === 'grey';

  const rows = subject
    ? await db.$queryRaw<Row[]>`
        SELECT q.id, q.content_text, ec.title AS cycle_title, ec.language::text AS language
          FROM questions q
          JOIN exam_cycles ec ON ec.id = q.source_exam_id
          JOIN chapters c ON c.id = q.chapter_id
          JOIN subjects s ON s.id = c.subject_id
         WHERE q.content_text ~ 'Doc(ument)?[ .-]*[0-9]|adjacent (circuit|figure)'
           AND (q.content_images IS NULL OR array_length(q.content_images, 1) IS NULL)
           AND s.name = ${subject}
         ORDER BY ec.year DESC
         LIMIT ${limit}`
    : await db.$queryRaw<Row[]>`
        SELECT q.id, q.content_text, ec.title AS cycle_title, ec.language::text AS language
          FROM questions q
          JOIN exam_cycles ec ON ec.id = q.source_exam_id
         WHERE q.content_text ~ 'Doc(ument)?[ .-]*[0-9]|adjacent (circuit|figure)'
           AND (q.content_images IS NULL OR array_length(q.content_images, 1) IS NULL)
         ORDER BY ec.year DESC
         LIMIT ${limit}`;

  console.log(`  candidates: ${rows.length}${subject ? ` in ${subject}` : ''}`);
  mkdirSync(OUT_DIR, { recursive: true });

  const pageCache = new Map<string, string[]>();
  let attached = 0;
  let noPaper = 0;
  let noPage = 0;

  for (const row of rows) {
    const match = /^(.+?)\s+(GS|LS|LH|SE|SG|SV)\s+(\d{4})\s+—\s+session\s*(\d)/i.exec(row.cycle_title);
    if (!match) {
      noPaper += 1;
      continue;
    }
    const track = (match[2] ?? '').toLowerCase();
    const dir = path.join(CORPUS_ROOT, track, `${match[3]} ${match[4]}`);
    if (!existsSync(dir)) {
      noPaper += 1;
      continue;
    }

    const lang = row.language === 'fr' ? 'fr' : 'en';
    const pdfs = readdirSync(dir).filter(
      (file) => file.toLowerCase().endsWith('.pdf') && file.toLowerCase().includes(`_${lang}`),
    );
    if (pdfs.length === 0) {
      noPaper += 1;
      continue;
    }

    /*
     * Several anchors from across the question, not one from its opening.
     *
     * The stored statement is a RECONSTRUCTION: `load-exams` strips the
     * exercise header and reassembles what is left, so a question stored as
     * "Parkinson Disease Document 1 1- Pick out from document 1" sits on a page
     * reading "Exercise 4 (6.5 points) Parkinson disease is a neurodegenerative
     * ...". Its first sixty characters appear nowhere on the paper, and
     * anchoring there identified the page for none of fifteen Life Sciences
     * questions while the text was sitting in front of it.
     *
     * A reassembled statement still contains long runs copied verbatim — they
     * are just not at the start. Four samples spread through it, and a page
     * matching ANY of them is the page. Forty characters is far past
     * coincidence in a four-page paper, so a hit is a hit.
     */
    const whole = normalise(row.content_text);
    if (whole.length < MIN_ANCHOR) {
      noPage += 1;
      continue;
    }
    const anchors = [0, 0.25, 0.5, 0.75]
      .map((at) => whole.slice(Math.floor(whole.length * at), Math.floor(whole.length * at) + 40))
      .filter((a) => a.length === 40);
    if (anchors.length === 0) anchors.push(whole.slice(0, MIN_ANCHOR));

    let placed = false;
    for (const file of pdfs) {
      const pdf = path.join(dir, file);
      if (!pageCache.has(pdf)) {
        const total = pageCount(pdf);
        pageCache.set(
          pdf,
          Array.from({ length: total }, (_, i) => normalise(pageText(pdf, i + 1))),
        );
      }

      const page = (pageCache.get(pdf) ?? []).findIndex((text) => anchors.some((a) => text.includes(a)));
      if (page < 0) continue;

      const stem = createHash('sha1').update(pdf).digest('hex').slice(0, 12);
      const rel = `/figures/${stem}-p${page + 1}.png`;
      const abs = path.join(OUT_DIR, `${stem}-p${page + 1}.png`);

      if (!existsSync(abs) && !dry) {
        const prefix = path.join(OUT_DIR, `${stem}-p${page + 1}`);
        execFileSync('pdftoppm', [
          ...(grey ? ['-png', '-gray', '-r', String(GREY_DPI)] : ['-png', '-mono', '-r', String(DPI)]),
          '-f', String(page + 1), '-l', String(page + 1),
          '-singlefile', pdf, prefix,
        ]);
        const produced = `${prefix}.png`;
        if (existsSync(produced) && produced !== abs) renameSync(produced, abs);
      }

      if (!dry) {
        await db.$executeRaw`
          UPDATE questions SET content_images = ARRAY[${rel}] WHERE id = ${row.id}::uuid`;
      }
      attached += 1;
      placed = true;
      break;
    }
    if (!placed) noPage += 1;
  }

  console.log(`  attached             ${attached}`);
  console.log(`  paper not on disk    ${noPaper}`);
  console.log(`  page not identified  ${noPage}`);
  if (dry) console.log('\n  --dry: nothing written.');
  await db.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
