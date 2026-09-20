/**
 * Pulls Mathpix's cropped figures onto disk and rewrites the references.
 *
 *   npm run corpus:figures:fetch -- --dry
 *   npm run corpus:figures:fetch
 *
 * WHY THIS IS URGENT. Mathpix returns figures as links to its own CDN, not as
 * bytes: `![](https://cdn.mathpix.com/cropped/<id>-07.jpg?height=…&width=…)`.
 * Mathpix deletes outputs after 90 days. 1,820 of the 1,962 figure references
 * in this corpus are such links, across 512 papers — so a quarter of the
 * material we just paid to read becomes unanswerable three months from now,
 * and nothing on screen would say so. A physics question without its circuit
 * diagram is not a degraded question, it is an impossible one.
 *
 * The query string is not decoration: it carries the crop box, so the URL must
 * be fetched whole. Two references to the same page with different crops are
 * different images and are keyed separately.
 *
 * SAFE TO RE-RUN. A figure already on disk is not fetched again, and a
 * reference already rewritten is left alone. Text is only rewritten after every
 * image in that file has been stored, so a run interrupted halfway leaves
 * documents that still point at a CDN that still works, rather than at files
 * that are not there yet.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const TEXT_ROOT = path.join('corpus', 'text');
const FIGURE_DIR = 'figures';
const CONCURRENCY = 6;
const RETRIES = 3;
const REQUEST_TIMEOUT_MS = 60_000;

/**
 * Every way Mathpix points at a figure.
 *
 * TWO FORMS, and only the first was handled. Mathpix emits a plain Markdown
 * image for most crops, but wraps others in a LaTeX figure environment:
 *
 *   ![](https://cdn.mathpix.com/cropped/....jpg?height=..&width=..)
 *   egin{figure}\includegraphics[...]{https://cdn.mathpix.com/cropped/...}
 *
 * Matching only the Markdown left 1,070 figures — a third of them — pointing at
 * a CDN that deletes outputs after 90 days, with the run reporting zero missing
 * because it never looked. On a Geography or Physics paper the figure IS the
 * question, so this was a third of the documents quietly on a timer.
 *
 * Capture group 1 is the URL in both forms.
 */
const IMAGE_REF = /!\[\]\(([^)]+)\)|\includegraphics(?:\[[^\]]*\])?\{([^}]+)\}/g;

/** The url from either alternative of IMAGE_REF. */
function urlOf(match: RegExpMatchArray): string {
  return match[1] ?? match[2] ?? '';
}

type Args = Record<string, string | boolean>;

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token?.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) args[key] = true;
    else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

/**
 * A stable local name for one cropped image.
 *
 * Keyed on the WHOLE url, crop box included, because the same source page
 * appears several times in a paper cropped to different figures. Keying on the
 * path alone would collapse them and silently give three questions the same
 * diagram.
 */
function localNameFor(url: string): string {
  const digest = createHash('sha256').update(url).digest('hex').slice(0, 16);
  const ext = (url.split('?')[0]?.match(/\.(jpe?g|png|gif|webp)$/i)?.[1] ?? 'jpg').toLowerCase();
  return `${digest}.${ext === 'jpeg' ? 'jpg' : ext}`;
}

/**
 * The URL as HTTP wants it, not as Markdown stored it.
 *
 * Mathpix writes these links into Markdown, so the query string arrives
 * escaped: `?height=652\&width=625\&top_left_y=2133`. Fetched literally, the
 * backslashes make the request malformed and the CDN answers 400 — every
 * image, silently, with the run reporting them as "missing" as though the
 * figures were gone rather than never correctly asked for.
 *
 * Unescaped only at fetch time. The escaped form stays the key for naming and
 * for finding the reference again in the text, because that is the string that
 * is actually written in the file.
 */
function fetchableUrl(url: string): string {
  return url.replace(/\\([&_*[\]()#+\-.!])/g, '$1');
}

/**
 * Figures the earlier pipeline already downloaded, keyed by their crop box.
 *
 * It saved them under `corpus/figures/<doc>/` and put the crop in the NAME:
 *
 *   url   .../cropped/b4456bb0-…-014.jpg?height=2407&width=1687&top_left_y=266&top_left_x=73
 *   file  b4456bb0-…-014_2407_1687_266_73.jpg
 *
 * So a link Mathpix has since deleted is not a lost figure — it is a figure
 * under another name. That is what the 142 "could not fetch" were, every one of
 * them from a single old document, and it is what the 1,292 book misses are
 * too. Checked BEFORE the network, so a dead link costs nothing instead of
 * three retries with backoff.
 */
const FIGURE_STORE = path.join('corpus', 'figures');

function indexLocalFigures(): Map<string, string> {
  const index = new Map<string, string>();
  if (!existsSync(FIGURE_STORE)) return index;

  for (const doc of readdirSync(FIGURE_STORE)) {
    const dir = path.join(FIGURE_STORE, doc);
    let files: string[];
    try {
      files = readdirSync(dir);
    } catch {
      continue;
    }
    for (const file of files) {
      const key = file.replace(/\.(jpe?g|png|gif|webp)$/i, '');
      if (!index.has(key)) index.set(key, path.join(dir, file));
    }
  }
  return index;
}

/** The crop-box key for a CDN url, or null when it is not a cropped figure. */
function cropKeyFor(url: string): string | null {
  const clean = fetchableUrl(url);
  const stem = clean.split('?')[0]?.split('/').pop()?.replace(/\.(jpe?g|png|gif|webp)$/i, '');
  if (!stem) return null;
  try {
    const q = new URL(clean).searchParams;
    const parts = ['height', 'width', 'top_left_y', 'top_left_x'].map((k) => q.get(k));
    if (parts.some((v) => v === null)) return null;
    return `${stem}_${parts.join('_')}`;
  } catch {
    return null;
  }
}

async function download(url: string, into: string): Promise<boolean> {
  const target = fetchableUrl(url);
  for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
    try {
      const response = await fetch(target, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (!response.ok) {
        // A 404 will not become a 200 on retry; anything else might.
        if (response.status === 404) return false;
        throw new Error(`HTTP ${response.status}`);
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length === 0) throw new Error('empty body');

      // Written to a temporary name and moved, so an interrupted run can never
      // leave a half-written file that looks complete to the next one.
      const tmp = `${into}.part`;
      writeFileSync(tmp, bytes);
      renameSync(tmp, into);
      return true;
    } catch {
      if (attempt === RETRIES) return false;
      await new Promise((r) => setTimeout(r, attempt * 1500));
    }
  }
  return false;
}

type Paper = { sha: string; dir: string; files: string[]; urls: Set<string> };

/**
 * Exam papers are the sha256-named directories; books are named after the book.
 *
 * WHY BOOKS ARE SKIPPED BY DEFAULT. Their OCR is months old and Mathpix
 * deletes outputs after 90 days, so every one of those links is already dead —
 * observed: 1,292 consecutive misses, each costing three retries with backoff
 * to learn nothing. And their figures are not lost: the earlier pipeline saved
 * them to `corpus/figures/<book>__<hash>/`, 7,204 files of them. What is stale
 * is the reference inside `document.mmd`, not the image.
 *
 * Relinking those to the local copies is a separate job — it is a rename
 * problem, not a download problem, and it needs the mapping between Mathpix's
 * crop ids and the names that pipeline chose. `--books` forces the attempt for
 * anyone who wants to confirm the links are dead for themselves.
 */
const IS_EXAM_DIR = /^[0-9a-f]{64}$/;

function collect(booksToo: boolean): Paper[] {
  const papers: Paper[] = [];
  if (!existsSync(TEXT_ROOT)) return papers;

  for (const sha of readdirSync(TEXT_ROOT)) {
    if (!booksToo && !IS_EXAM_DIR.test(sha)) continue;
    const dir = path.join(TEXT_ROOT, sha);
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }

    const files = entries.filter((f) => f === 'document.mmd' || /^page-\d+\.md$/.test(f));
    if (files.length === 0) continue;

    const urls = new Set<string>();
    for (const file of files) {
      const text = readFileSync(path.join(dir, file), 'utf8');
      for (const match of text.matchAll(IMAGE_REF)) {
        const url = urlOf(match);
        if (url.startsWith('http')) urls.add(url);
      }
    }
    if (urls.size > 0) papers.push({ sha, dir, files, urls });
  }
  return papers;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dry = args.dry === true;

  const booksToo = args.books === true;
  console.log(`Scanning corpus/text ${booksToo ? '(exams and books)' : '(exam papers only)'} …`);
  const papers = collect(booksToo);
  const allUrls = new Set<string>();
  for (const p of papers) for (const u of p.urls) allUrls.add(u);

  console.log(`  papers with remote figures : ${papers.length}`);
  console.log(`  distinct remote figures    : ${allUrls.size}`);

  if (papers.length === 0) {
    console.log('\nNothing to fetch — every figure is already local.');
    return;
  }
  if (dry) {
    console.log('\n--dry: nothing downloaded, nothing rewritten.');
    return;
  }

  const localIndex = indexLocalFigures();
  console.log(`  figures already on disk from earlier runs: ${localIndex.size}`);

  let fetched = 0;
  let cached = 0;
  let relinked = 0;
  let missing = 0;
  const failedUrls = new Set<string>();

  for (const paper of papers) {
    const figDir = path.join(paper.dir, FIGURE_DIR);
    mkdirSync(figDir, { recursive: true });

    const urls = [...paper.urls];
    const results = new Map<string, boolean>();

    // A small pool: enough to keep the link busy, not enough to look like a
    // scraper to a CDN we depend on.
    for (let i = 0; i < urls.length; i += CONCURRENCY) {
      const batch = urls.slice(i, i + CONCURRENCY);
      await Promise.all(
        batch.map(async (url) => {
          const target = path.join(figDir, localNameFor(url));
          if (existsSync(target)) {
            cached += 1;
            results.set(url, true);
            return;
          }

          // Already downloaded once, by the older pipeline, under its own name.
          const key = cropKeyFor(url);
          const known = key ? localIndex.get(key) : undefined;
          if (known && existsSync(known)) {
            copyFileSync(known, target);
            relinked += 1;
            results.set(url, true);
            return;
          }

          const ok = await download(url, target);
          if (ok) fetched += 1;
          else {
            missing += 1;
            failedUrls.add(url);
          }
          results.set(url, ok);
        }),
      );
    }

    /*
     * ONLY REWRITE WHAT LANDED.
     *
     * A reference swapped to a local path that does not exist is worse than
     * the CDN link it replaced: the link works today and fails visibly later,
     * the bad path fails now and looks like corruption. So a figure that could
     * not be fetched keeps pointing at the CDN and is reported.
     */
    for (const file of paper.files) {
      const full = path.join(paper.dir, file);
      const before = readFileSync(full, 'utf8');
      const after = before.replace(IMAGE_REF, (whole, md?: string, tex?: string) => {
        const url = md ?? tex ?? '';
        if (!url.startsWith('http')) return whole;
        if (results.get(url) !== true) return whole;
        const local = `${FIGURE_DIR}/${localNameFor(url)}`;
        // The reference keeps the form it had. Rewriting an \includegraphics
        // into a Markdown image would change how the paper renders, and this
        // job is about where the bytes live, not about how they are shown.
        return md !== undefined ? `![](${local})` : whole.replace(url, local);
      });
      if (after !== before) writeFileSync(full, after, 'utf8');
    }

    process.stdout.write(
      `\r  ${paper.sha.slice(0, 10)} … fetched ${fetched}, cached ${cached}, missing ${missing}   `,
    );
  }

  console.log('');
  console.log('');
  console.log('─'.repeat(56));
  console.log(`  downloaded      : ${fetched}`);
  console.log(`  relinked local  : ${relinked}`);
  console.log(`  already on disk : ${cached}`);
  console.log(`  could not fetch : ${missing}`);
  if (missing > 0) {
    console.log('');
    console.log('  Those references still point at the CDN, which is correct —');
    console.log('  a link that works beats a local path that does not. Re-run to');
    console.log('  retry them. Examples:');
    for (const url of [...failedUrls].slice(0, 5)) console.log(`    ${url.slice(0, 100)}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
