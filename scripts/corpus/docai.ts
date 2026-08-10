/**
 * Document AI OCR runner — the cheap path for unvocalised Arabic prose.
 *
 *   npm run corpus:ocr -- --file ./corpus/raw/shared/falsafa-3amma.pdf
 *   npm run corpus:ocr -- --file ./book.pdf --pages 1-30        # the test set
 *
 * Online processing only, in chunks of 15 pages — which is the whole reason
 * this exists in this shape. Batch processing would be fewer requests but
 * needs a GCS bucket, lifecycle rules and IAM on top of the processor; at
 * ~143 requests for the entire Arabic prose corpus, the bucket is not worth
 * its own setup. If a book ever exceeds the online quota, switch that book to
 * batch rather than rewriting this.
 *
 * Output per page: the text, and a metadata sidecar carrying the confidence
 * numbers the gates key off. Nothing here judges quality — scripts/corpus/gates.ts
 * does that, separately, so a bad threshold can be re-run without re-OCRing.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { v1 } from '@google-cloud/documentai';
import { PDFDocument } from 'pdf-lib';

type Args = Record<string, string | boolean>;

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token?.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
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

/** "1-30" | "7" -> zero-based page indices. Undefined means the whole document. */
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

type PageResult = {
  pageNumber: number;
  text: string;
  charCount: number;
  meanConfidence: number;
  minConfidence: number;
  lowConfidenceTokenRatio: number;
  blocks: { confidence: number; box: number[] }[];
};

const LOW_TOKEN_CONFIDENCE = 0.7;

/**
 * Pulls one page's text out of the document.
 *
 * Document AI returns the full text once and points into it with character
 * offsets; the page objects carry no text of their own. Newlines inside the
 * slice are kept exactly as returned — once the layout is gone they are the
 * only structural signal the segmentation step has left to find sections with.
 */
function sliceText(fullText: string, layout: any): string {
  const segments = layout?.textAnchor?.textSegments ?? [];
  if (segments.length === 0) return '';
  return segments
    .map((segment: any) => {
      const start = Number(segment.startIndex ?? 0);
      const end = Number(segment.endIndex ?? 0);
      return fullText.slice(start, end);
    })
    .join('');
}

function boundingBox(layout: any): number[] {
  const vertices = layout?.boundingPoly?.normalizedVertices ?? [];
  if (vertices.length === 0) return [];
  const xs = vertices.map((v: any) => Number(v.x ?? 0));
  const ys = vertices.map((v: any) => Number(v.y ?? 0));
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map((n) =>
    Number(n.toFixed(4)),
  );
}

function summarisePage(fullText: string, page: any, pageNumber: number): PageResult {
  const text = sliceText(fullText, page.layout);
  const confidences: number[] = (page.tokens ?? [])
    .map((token: any) => Number(token.layout?.confidence ?? 0))
    .filter((n: number) => Number.isFinite(n));

  const mean =
    confidences.length > 0 ? confidences.reduce((a, b) => a + b, 0) / confidences.length : 0;
  const min = confidences.length > 0 ? Math.min(...confidences) : 0;
  const low = confidences.filter((c) => c < LOW_TOKEN_CONFIDENCE).length;

  return {
    pageNumber,
    text,
    charCount: text.length,
    meanConfidence: Number(mean.toFixed(4)),
    minConfidence: Number(min.toFixed(4)),
    lowConfidenceTokenRatio:
      confidences.length > 0 ? Number((low / confidences.length).toFixed(4)) : 1,
    blocks: (page.blocks ?? []).map((block: any) => ({
      confidence: Number(Number(block.layout?.confidence ?? 0).toFixed(4)),
      box: boundingBox(block.layout),
    })),
  };
}

/** Splits the selected pages into chunks the online endpoint will accept. */
async function chunkPdf(bytes: Buffer, pageIndices: number[], size: number) {
  const source = await PDFDocument.load(bytes);
  const chunks: { bytes: Buffer; pageNumbers: number[] }[] = [];

  for (let i = 0; i < pageIndices.length; i += size) {
    const slice = pageIndices.slice(i, i + size);
    const out = await PDFDocument.create();
    const copied = await out.copyPages(source, slice);
    copied.forEach((page) => out.addPage(page));
    chunks.push({
      bytes: Buffer.from(await out.save()),
      pageNumbers: slice.map((index) => index + 1),
    });
  }

  return { chunks, totalPages: source.getPageCount() };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const filePath = typeof args.file === 'string' ? args.file : null;
  if (!filePath) {
    console.log('Usage: npm run corpus:ocr -- --file <pdf> [--pages 1-30] [--out corpus] [--chunk 15]');
    process.exit(1);
  }

  const project = requireEnv('DOCAI_PROJECT');
  const location = requireEnv('DOCAI_LOCATION');
  const processorId = requireEnv('DOCAI_PROCESSOR_ID');

  const outRoot = typeof args.out === 'string' ? args.out : 'corpus';
  const chunkSize = typeof args.chunk === 'string' ? Number(args.chunk) : 15;

  const bytes = await readFile(filePath);
  const sha256 = createHash('sha256').update(bytes).digest('hex');

  const source = await PDFDocument.load(bytes);
  const pageIndices = parsePageRange(
    typeof args.pages === 'string' ? args.pages : undefined,
    source.getPageCount(),
  );

  const { chunks, totalPages } = await chunkPdf(bytes, pageIndices, chunkSize);

  console.log(`${path.basename(filePath)}`);
  console.log(`  sha256:    ${sha256}`);
  console.log(`  pages:     ${pageIndices.length} of ${totalPages}`);
  console.log(`  requests:  ${chunks.length} (chunks of ${chunkSize})`);
  console.log('');

  const client = new v1.DocumentProcessorServiceClient({
    apiEndpoint: `${location}-documentai.googleapis.com`,
  });
  const name = `projects/${project}/locations/${location}/processors/${processorId}`;

  const textDir = path.join(outRoot, 'text', sha256);
  const metaDir = path.join(outRoot, 'meta', sha256);
  await mkdir(textDir, { recursive: true });
  await mkdir(metaDir, { recursive: true });

  const results: PageResult[] = [];

  for (const [index, chunk] of chunks.entries()) {
    const label = `${chunk.pageNumbers[0]}-${chunk.pageNumbers[chunk.pageNumbers.length - 1]}`;
    process.stdout.write(`  [${index + 1}/${chunks.length}] pages ${label} … `);

    const [response] = await client.processDocument({
      name,
      rawDocument: { content: chunk.bytes.toString('base64'), mimeType: 'application/pdf' },
    });

    const document = response.document;
    if (!document) throw new Error(`No document returned for pages ${label}.`);

    const fullText = document.text ?? '';
    const pages = document.pages ?? [];

    if (pages.length !== chunk.pageNumbers.length) {
      // Never guess at the mapping: a silent off-by-one here misfiles every
      // page after it, and the error only surfaces months later as a wrongly
      // cited source.
      throw new Error(
        `Sent ${chunk.pageNumbers.length} pages for ${label} but got ${pages.length} back.`,
      );
    }

    for (const [offset, page] of pages.entries()) {
      const pageNumber = chunk.pageNumbers[offset]!;
      const result = summarisePage(fullText, page, pageNumber);
      results.push(result);

      const stem = String(pageNumber).padStart(3, '0');
      await writeFile(path.join(textDir, `page-${stem}.md`), result.text, 'utf8');
      await writeFile(
        path.join(metaDir, `page-${stem}.json`),
        JSON.stringify(
          {
            source: { file: path.basename(filePath), sha256, page: pageNumber },
            reader: { provider: 'google-document-ai', processor: processorId, location },
            charCount: result.charCount,
            meanConfidence: result.meanConfidence,
            minConfidence: result.minConfidence,
            lowConfidenceTokenRatio: result.lowConfidenceTokenRatio,
            blocks: result.blocks,
          },
          null,
          2,
        ),
        'utf8',
      );
    }

    const meanForChunk =
      pages.length > 0
        ? results.slice(-pages.length).reduce((a, r) => a + r.meanConfidence, 0) / pages.length
        : 0;
    console.log(`ok  (mean confidence ${meanForChunk.toFixed(3)})`);
  }

  await writeFile(
    path.join(metaDir, 'document.json'),
    JSON.stringify(
      {
        file: path.basename(filePath),
        sha256,
        pdfPageCount: totalPages,
        pagesProcessed: results.length,
        processedAt: new Date().toISOString(),
        meanConfidence: Number(
          (results.reduce((a, r) => a + r.meanConfidence, 0) / (results.length || 1)).toFixed(4),
        ),
      },
      null,
      2,
    ),
    'utf8',
  );

  // So the wrapper script (and the next command) can find this run without
  // anyone copying a 64-character hash by hand.
  await writeFile(path.join(outRoot, '.last-sha'), sha256, 'utf8');

  console.log('');
  console.log(`  text -> ${textDir}`);
  console.log(`  meta -> ${metaDir}`);
  console.log('');
  console.log('Now run the gates:  npm run corpus:gates -- --sha ' + sha256);
}

main().catch((error) => {
  console.error('OCR failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
