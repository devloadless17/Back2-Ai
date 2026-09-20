/**
 * Mathpix OCR runner.
 *
 *   npm run corpus:mathpix -- --file "G:/My Drive/corpus/falsafa-3amma.pdf"
 *   npm run corpus:mathpix -- --file ./book.pdf --pages 1-30
 *
 * Writes the same shape of output as scripts/corpus/docai.ts, so
 * scripts/corpus/gates.ts runs unchanged over either reader and the two
 * vendors stay interchangeable while we are still deciding between them.
 *
 * Page selection is done locally with pdf-lib rather than through a Mathpix
 * option, so a --pages test costs exactly the pages requested and does not
 * depend on an API parameter behaving the way we expect.
 *
 * Mathpix deletes source documents after 30 days and outputs after 90. The
 * files this writes are the permanent copy — the API is not storage.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { PDFDocument } from 'pdf-lib';

const API = 'https://api.mathpix.com/v3/pdf';
const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 45 * 60_000;

/*
 * A CEILING ON EACH REQUEST, not only on the job.
 *
 * `POLL_TIMEOUT_MS` is checked after the status fetch returns, and node's
 * `fetch` has no default timeout — so a connection that hangs open never lets
 * the loop iterate and the 45-minute guard never fires. Observed: one paper
 * held a batch run for 54 minutes and would have held it indefinitely.
 *
 * Upload gets longer than the status and download calls because it is pushing
 * a file; a status check that has not answered in a minute is not going to.
 */
const SUBMIT_TIMEOUT_MS = 5 * 60_000;
const REQUEST_TIMEOUT_MS = 60_000;
const LOW_CONFIDENCE = 0.7;

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

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. See scripts/corpus/README.md.`);
  return value;
}

function parsePageRange(spec: string | undefined, total: number): number[] {
  if (!spec) return Array.from({ length: total }, (_, i) => i);
  const match = /^(\d+)(?:-(\d+))?$/.exec(spec.trim());
  if (!match) throw new Error(`Cannot read --pages "${spec}". Use "12" or "1-30".`);
  const from = Number(match[1]);
  const to = match[2] ? Number(match[2]) : from;
  if (from < 1 || to < from || to > total) {
    throw new Error(`--pages ${spec} is outside this document (1-${total}).`);
  }
  return Array.from({ length: to - from + 1 }, (_, i) => from - 1 + i);
}

/** Extracts the selected pages into a new PDF, so we upload only what we pay for. */
async function subsetPdf(bytes: Buffer, pageIndices: number[]): Promise<Buffer> {
  const source = await PDFDocument.load(bytes);
  if (pageIndices.length === source.getPageCount()) return bytes;
  const out = await PDFDocument.create();
  const copied = await out.copyPages(source, pageIndices);
  copied.forEach((page) => out.addPage(page));
  return Buffer.from(await out.save());
}

const headers = () => ({
  app_id: requireEnv('MATHPIX_APP_ID'),
  app_key: requireEnv('MATHPIX_APP_KEY'),
});

async function submit(bytes: Buffer, fileName: string): Promise<string> {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }), fileName);
  form.append(
    'options_json',
    JSON.stringify({
      rm_spaces: true,
      math_inline_delimiters: ['$', '$'],
      math_display_delimiters: ['$$', '$$'],
      enable_tables_fallback: true,
    }),
  );

  const response = await fetch(API, {
    method: 'POST',
    headers: headers(),
    body: form,
    signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Submit failed (${response.status}): ${body}`);

  const parsed = JSON.parse(body);
  if (!parsed.pdf_id) throw new Error(`No pdf_id in response: ${body}`);
  return parsed.pdf_id as string;
}

/**
 * Waits for the job.
 *
 * Polls `status`, not `percent_done` — Mathpix reports 100% while the output
 * files are still being assembled, so a percentage-based wait downloads
 * nothing and looks like an API failure.
 */
async function waitForCompletion(pdfId: string): Promise<void> {
  const startedAt = Date.now();
  let lastPercent = -1;

  for (;;) {
    /*
     * A FAILED STATUS CHECK IS NOT A FAILED JOB.
     *
     * The work is happening on Mathpix's side; this loop is only asking after
     * it. A timed-out or refused poll means the question did not arrive, not
     * that the conversion died — and throwing here would abandon a paper that
     * is about to finish, and that we have already paid for.
     *
     * So a poll that fails is swallowed and retried, and the only thing that
     * ends the wait is the job completing, the job erroring, or the 45-minute
     * ceiling below. That ceiling is now reachable: before the request had a
     * timeout, a hung connection simply never returned and the loop never came
     * back round to check it.
     */
    let body: string;
    let ok: boolean;
    try {
      const response = await fetch(`${API}/${pdfId}`, {
        headers: headers(),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      body = await response.text();
      ok = response.ok;
    } catch {
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        throw new Error(`Gave up after 45 minutes. The job may still finish — pdf_id ${pdfId}`);
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      continue;
    }

    if (!ok) throw new Error(`Status check failed: ${body}`);

    const parsed = JSON.parse(body);
    const status = String(parsed.status ?? '');

    if (status === 'completed') {
      process.stdout.write('\n');
      return;
    }
    if (status === 'error') {
      throw new Error(`Mathpix reported an error: ${JSON.stringify(parsed)}`);
    }

    const percent = Math.floor(Number(parsed.percent_done ?? 0));
    if (percent !== lastPercent) {
      process.stdout.write(`\r  ${status} … ${percent}%   `);
      lastPercent = percent;
    }

    if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
      throw new Error(`Gave up after 45 minutes. The job may still finish — pdf_id ${pdfId}`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

async function download(pdfId: string, ext: string): Promise<string | null> {
  const response = await fetch(`${API}/${pdfId}.${ext}`, {
    headers: headers(),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) return null;
  return response.text();
}

type PageData = { page: number; text: string; confidences: number[] };

/**
 * Turns the per-line JSON into per-page text.
 *
 * The exact shape of Mathpix's lines output is not something to assume, so
 * this reads defensively and reports what it found rather than silently
 * producing empty pages. If the structure is unexpected the raw JSON is still
 * on disk and nothing is lost.
 */
function pagesFromLines(raw: string): PageData[] {
  const parsed = JSON.parse(raw);
  const pages = Array.isArray(parsed?.pages) ? parsed.pages : [];

  return pages.map((page: any, index: number): PageData => {
    const number = Number(page.page ?? page.page_idx ?? index + 1);
    const lines = Array.isArray(page.lines) ? page.lines : [];

    const text = lines
      .map((line: any) => String(line.text ?? line.mmd ?? line.value ?? ''))
      .filter((value: string) => value.length > 0)
      .join('\n');

    const confidences = lines
      .map((line: any) => Number(line.confidence ?? line.conf ?? NaN))
      .filter((value: number) => Number.isFinite(value));

    return { page: number, text, confidences };
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const filePath = typeof args.file === 'string' ? args.file : null;
  if (!filePath) {
    console.log('Usage: npm run corpus:mathpix -- --file <pdf> [--pages 1-30] [--out corpus]');
    process.exit(1);
  }

  const outRoot = typeof args.out === 'string' ? args.out : 'corpus';

  const bytes = await readFile(filePath);
  const sha256 = createHash('sha256').update(bytes).digest('hex');

  const source = await PDFDocument.load(bytes);
  const totalPages = source.getPageCount();
  const pageIndices = parsePageRange(
    typeof args.pages === 'string' ? args.pages : undefined,
    totalPages,
  );
  const upload = await subsetPdf(bytes, pageIndices);

  console.log(`${path.basename(filePath)}`);
  console.log(`  sha256:   ${sha256}`);
  console.log(`  pages:    ${pageIndices.length} of ${totalPages}`);
  console.log(`  size:     ${(upload.length / 1024 / 1024).toFixed(1)} MB`);
  console.log('');

  const pdfId = await submit(upload, path.basename(filePath));
  console.log(`  pdf_id:   ${pdfId}`);
  await waitForCompletion(pdfId);

  const textDir = path.join(outRoot, 'text', sha256);
  const metaDir = path.join(outRoot, 'meta', sha256);
  await mkdir(textDir, { recursive: true });
  await mkdir(metaDir, { recursive: true });

  // The whole-document Markdown is the fidelity copy: it carries the LaTeX and
  // the table markup. Per-page files are derived from it for review and gating.
  const mmd = await download(pdfId, 'mmd');
  if (mmd) await writeFile(path.join(textDir, 'document.mmd'), mmd, 'utf8');

  const linesRaw = (await download(pdfId, 'lines.mmd.json')) ?? (await download(pdfId, 'lines.json'));
  if (!linesRaw) {
    throw new Error(
      'Could not download lines JSON. document.mmd may have been saved; the gates need the per-line data.',
    );
  }
  await writeFile(path.join(metaDir, 'lines.json'), linesRaw, 'utf8');

  const pages = pagesFromLines(linesRaw);
  if (pages.length === 0) {
    throw new Error(
      'The lines JSON had no pages array in the expected shape. Raw file saved to meta/lines.json — send it over and the parser gets adjusted.',
    );
  }

  // Page numbers in the response are relative to what we uploaded, so map them
  // back to the real page numbers in the book. Getting this wrong misfiles
  // every page after it and only shows up months later as a wrong citation.
  const offset = pageIndices[0]!;
  let withoutConfidence = 0;

  for (const [index, page] of pages.entries()) {
    const realPage = offset + index + 1;
    const stem = String(realPage).padStart(3, '0');

    await writeFile(path.join(textDir, `page-${stem}.md`), page.text, 'utf8');

    const mean =
      page.confidences.length > 0
        ? page.confidences.reduce((a, b) => a + b, 0) / page.confidences.length
        : 1;
    const min = page.confidences.length > 0 ? Math.min(...page.confidences) : 1;
    const low = page.confidences.filter((c) => c < LOW_CONFIDENCE).length;
    if (page.confidences.length === 0) withoutConfidence += 1;

    await writeFile(
      path.join(metaDir, `page-${stem}.json`),
      JSON.stringify(
        {
          source: { file: path.basename(filePath), sha256, page: realPage },
          reader: { provider: 'mathpix', pdfId },
          charCount: page.text.length,
          meanConfidence: Number(mean.toFixed(4)),
          minConfidence: Number(min.toFixed(4)),
          lowConfidenceTokenRatio:
            page.confidences.length > 0
              ? Number((low / page.confidences.length).toFixed(4))
              : 0,
          hasConfidence: page.confidences.length > 0,
          blocks: [],
        },
        null,
        2,
      ),
      'utf8',
    );
  }

  const meanOverall =
    pages.reduce((sum, p) => {
      const c = p.confidences;
      return sum + (c.length > 0 ? c.reduce((a, b) => a + b, 0) / c.length : 1);
    }, 0) / pages.length;

  await writeFile(
    path.join(metaDir, 'document.json'),
    JSON.stringify(
      {
        file: path.basename(filePath),
        sha256,
        reader: 'mathpix',
        pdfId,
        pdfPageCount: pageIndices.length,
        pagesProcessed: pages.length,
        processedAt: new Date().toISOString(),
        meanConfidence: Number(meanOverall.toFixed(4)),
      },
      null,
      2,
    ),
    'utf8',
  );

  // So the wrapper script (and the next command) can find this run without
  // anyone copying a 64-character hash by hand.
  await writeFile(path.join(outRoot, '.last-sha'), sha256, 'utf8');

  console.log(`  pages written: ${pages.length}`);
  console.log(`  text -> ${textDir}`);
  console.log(`  meta -> ${metaDir}`);

  if (withoutConfidence > 0) {
    console.log('');
    console.log(
      `  NOTE: ${withoutConfidence} of ${pages.length} pages came back with no confidence values.`,
    );
    console.log('  Those pages are scored 1.0, so confidence gating is NOT protecting them.');
    console.log('  The character-count and repetition checks still apply.');
  }

  console.log('');
  console.log(`Now run the gates:  npm run corpus:gates -- --sha ${sha256}`);
}

main().catch((error) => {
  console.error('Mathpix run failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
