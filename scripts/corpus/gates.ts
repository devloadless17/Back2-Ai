/**
 * Quality gates for OCR'd pages.
 *
 *   npm run corpus:gates -- --sha <sha256>
 *
 * Separate from the OCR runner on purpose: thresholds get tuned, and tuning
 * them must never mean paying to read the pages again.
 *
 * For prose the failure that matters is not a wrong character — it is a
 * skipped or duplicated paragraph, which is invisible in the output. Hence the
 * character-count band and the repetition check, which catch exactly that, and
 * which no confidence score will tell you about.
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

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

/** Defaults are starting points. Set them from the 30-page test, not from here. */
const DEFAULTS = {
  meanConfidence: 0.85,
  lowTokenRatio: 0.08,
  shortPageFactor: 0.4, // of the document's median character count
  longPageFactor: 2.5,
  repeatNgram: 8, // words
  repeatLimit: 3, // how many times one 8-gram may appear on a page
  repeatCoverage: 0.15, // and it must cover this much of the page to count as a loop
};

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/**
 * Most-repeated n-gram on the page, with how much of the page it covers.
 *
 * Count alone produces false positives: exercise instructions and running
 * headers legitimately repeat. A reader that has looped repeats the same words
 * across most of the page, so coverage is what separates the two.
 */
function ngramRepeat(text: string, n: number): { count: number; coverage: number } {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < n * 2) return { count: 0, coverage: 0 };

  const seen = new Map<string, number>();
  let worst = 0;
  for (let i = 0; i + n <= words.length; i += 1) {
    const gram = words.slice(i, i + n).join(' ');
    const count = (seen.get(gram) ?? 0) + 1;
    seen.set(gram, count);
    if (count > worst) worst = count;
  }

  return { count: worst, coverage: (worst * n) / words.length };
}

/**
 * Leftovers that mean the normalisation step has not run, or has been skipped.
 * Presentation forms and tatweel look correct on screen and never match a
 * search, which is the worst kind of defect: invisible until retrieval quietly
 * returns nothing.
 */
const PRESENTATION_FORMS = /[ﭐ-﷿ﹰ-﻿]/;
const TATWEEL = /ـ/;
const ARABIC_INDIC_DIGITS = /[٠-٩۰-۹]/;

type PageReport = {
  page: number;
  chars: number;
  meanConfidence: number;
  lowTokenRatio: number;
  flags: string[];
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outRoot = typeof args.out === 'string' ? args.out : 'corpus';

  // A book is identified by its folder name — a readable slug plus a short
  // hash, e.g. "math-gs-1-en__289de41e". --sha is kept as an alias because the
  // Document AI runner still names folders by hash alone.
  let book =
    typeof args.book === 'string' ? args.book : typeof args.sha === 'string' ? args.sha : null;

  // Default to whatever was read last, so the usual case is just
  // "npm run corpus:gates" with nothing to copy or remember.
  if (!book) {
    for (const marker of ['.last-book', '.last-sha']) {
      try {
        book = (await readFile(path.join(outRoot, marker), 'utf8')).trim();
        console.log(`(using the last book read: ${book})`);
        console.log('');
        break;
      } catch {
        // try the next marker
      }
    }
  }

  if (!book) {
    console.log('Usage: npm run corpus:gates -- --book <folder> [--out corpus]');
    console.log('Or run an OCR command first and this will pick up that book automatically.');
    process.exit(1);
  }

  const sha = book;
  const textDir = path.join(outRoot, 'text', sha);
  const metaDir = path.join(outRoot, 'meta', sha);

  const thresholds = {
    ...DEFAULTS,
    meanConfidence:
      typeof args.confidence === 'string' ? Number(args.confidence) : DEFAULTS.meanConfidence,
  };

  const files = (await readdir(textDir)).filter((f) => /^page-\d+\.md$/.test(f)).sort();
  if (files.length === 0) throw new Error(`No pages under ${textDir}.`);

  const document = JSON.parse(await readFile(path.join(metaDir, 'document.json'), 'utf8'));

  const pages: { page: number; text: string; meta: any }[] = [];
  for (const file of files) {
    const page = Number(/(\d+)/.exec(file)![1]);
    pages.push({
      page,
      text: await readFile(path.join(textDir, file), 'utf8'),
      meta: JSON.parse(await readFile(path.join(metaDir, `page-${String(page).padStart(3, '0')}.json`), 'utf8')),
    });
  }

  // The band is per document: a philosophy page and a geography page have very
  // different normal lengths, so a global constant would flag the wrong ones.
  const medianChars = median(pages.map((p) => p.text.length));

  const reports: PageReport[] = pages.map(({ page, text, meta }) => {
    const flags: string[] = [];

    if (meta.meanConfidence < thresholds.meanConfidence) flags.push('low-confidence');
    if (meta.lowConfidenceTokenRatio > thresholds.lowTokenRatio) flags.push('many-weak-tokens');
    if (text.trim().length === 0) flags.push('empty');
    else if (text.length < medianChars * thresholds.shortPageFactor) flags.push('short-page');
    else if (text.length > medianChars * thresholds.longPageFactor) flags.push('long-page');

    const repeat = ngramRepeat(text, thresholds.repeatNgram);
    if (repeat.count > thresholds.repeatLimit && repeat.coverage > thresholds.repeatCoverage) {
      flags.push('repetition-loop');
    }
    if (PRESENTATION_FORMS.test(text)) flags.push('presentation-forms');
    if (TATWEEL.test(text)) flags.push('tatweel');
    if (ARABIC_INDIC_DIGITS.test(text)) flags.push('arabic-indic-digits');

    return {
      page,
      chars: text.length,
      meanConfidence: meta.meanConfidence,
      lowTokenRatio: meta.lowConfidenceTokenRatio,
      flags,
    };
  });

  const pageCountOk = document.pdfPageCount === document.pagesProcessed;
  const flagged = reports.filter((r) => r.flags.length > 0);

  console.log(`${document.file}`);
  console.log(`  pages:            ${document.pagesProcessed} of ${document.pdfPageCount}` + (pageCountOk ? '' : '   <-- BLOCKS THE BOOK'));
  console.log(`  median chars:     ${medianChars}`);
  console.log(`  mean confidence:  ${document.meanConfidence}`);
  console.log(`  flagged:          ${flagged.length} of ${reports.length} (${((flagged.length / reports.length) * 100).toFixed(1)}%)`);
  console.log('');

  const byFlag = new Map<string, number>();
  for (const report of flagged) {
    for (const flag of report.flags) byFlag.set(flag, (byFlag.get(flag) ?? 0) + 1);
  }
  for (const [flag, count] of [...byFlag.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${flag.padEnd(22)} ${count}`);
  }

  if (flagged.length > 0) {
    console.log('');
    console.log('  pages to look at:');
    for (const report of flagged.slice(0, 30)) {
      console.log(
        `    p${String(report.page).padStart(3, ' ')}  chars ${String(report.chars).padStart(5, ' ')}  ` +
          `conf ${report.meanConfidence.toFixed(3)}  ${report.flags.join(', ')}`,
      );
    }
    if (flagged.length > 30) console.log(`    … and ${flagged.length - 30} more`);
  }

  await writeFile(
    path.join(metaDir, 'gates.json'),
    JSON.stringify({ thresholds, medianChars, pageCountOk, reports }, null, 2),
    'utf8',
  );

  console.log('');
  console.log(`  report -> ${path.join(metaDir, 'gates.json')}`);

  if (!pageCountOk) {
    console.log('');
    console.log('Page count mismatch. Do not ingest this book until it is resolved.');
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('Gates failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
