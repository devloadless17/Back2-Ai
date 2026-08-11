/**
 * Corpus -> content_chunks, deterministically.
 *
 *   npm run corpus:chunks -- --dry              plan only, writes nothing
 *   npm run corpus:chunks -- --book math-ls-en__9de6de98
 *   npm run corpus:chunks                       everything in the catalog
 *
 * Reads the normalised text (corpus/text/<book>/clean), the chapter spans
 * (corpus/taxonomy/<book>.json) and the catalog, and writes source_documents
 * and content_chunks. Then `npm run ingest -- --embed-missing` fills vectors.
 *
 * No model is involved, on purpose:
 *
 *   - chunking is the single biggest lever on retrieval quality, and a rule you
 *     can read beats a prompt you have to re-run to understand;
 *   - it is free, so the whole corpus can be re-chunked after every change to
 *     the rules, which is how the rules get good;
 *   - it is reproducible: the same page always produces the same chunks, so a
 *     retrieval regression can be traced to a rule rather than to sampling.
 *
 * Classifying each chunk (definition / theorem / method) and pulling exercises
 * out as questions is a later pass. That one does need a model, and it can run
 * over chunks that already exist.
 *
 * Idempotent: a chunk's identity is the SHA-256 of its text plus its chapter,
 * so re-running updates in place and never duplicates.
 */

import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { PrismaClient, type ContentChunkKind, type Language } from '@prisma/client';

const db = new PrismaClient();
const ROOT = path.resolve(__dirname, '..', '..');
const CORPUS = path.join(ROOT, 'corpus');
const CATALOG = path.join(ROOT, 'scripts', 'corpus', 'catalog.csv');

/** Roughly a paragraph or two: long enough to stand alone, short enough to be one idea. */
const TARGET = 1200;
const MAX = 2200;
const MIN = 220;

type Row = Record<string, string>;
type Chapter = { index: number; title: string; unit?: string | null; pdfPage?: number | null; pdfPageEnd?: number | null };

function parseCsv(text: string): Row[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [header, ...body] = rows.filter((r) => r.some((c) => c.trim()));
  if (!header) return [];
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), r[i] ?? ''])));
}

/**
 * Splits one chapter's text into retrievable passages.
 *
 * Two rules do most of the work:
 *
 *   Display maths never starts a chunk. A passage that opens with $$...$$ and
 *   no prose is unretrievable — the embedding of a bare formula carries almost
 *   no signal, and a student asks "how do I integrate by parts", not "\int u dv".
 *   So a block of maths is always attached to the text above it.
 *
 *   The heading trail is repeated into every chunk. Mid-chapter passages often
 *   say "this method" without naming it; the chapter and section titles are what
 *   make them answerable on their own.
 */
function splitChapter(text: string, trail: string): { text: string; page: number | null }[] {
  const out: { text: string; page: number | null }[] = [];
  let heading = '';
  let page: number | null = null;
  let buffer: string[] = [];
  let bufferPage: number | null = null;

  const flush = () => {
    const body = buffer.join('\n\n').trim();
    buffer = [];
    if (body.length < MIN) return;
    const prefix = [trail, heading].filter(Boolean).join(' — ');
    out.push({ text: prefix ? `${prefix}\n\n${body}` : body, page: bufferPage });
    bufferPage = null;
  };

  for (const rawBlock of text.split(/\n{2,}/)) {
    const block = rawBlock.trim();
    if (!block) continue;

    const pageMark = /^<!--\s*page\s+(\d+)\s*-->$/.exec(block);
    if (pageMark) { page = Number(pageMark[1]); continue; }

    const head = /^(#{1,4})\s+(.*)$/.exec(block);
    if (head) {
      flush();
      heading = head[2]!.trim();
      continue;
    }

    const isMath = block.startsWith('$$');
    const size = buffer.join('\n\n').length;

    // Never open a chunk with display maths — keep it with the prose above.
    if (size + block.length > TARGET && !isMath && size >= MIN) flush();
    if (bufferPage === null) bufferPage = page;
    buffer.push(block);

    if (buffer.join('\n\n').length > MAX && !isMath) flush();
  }
  flush();
  return out;
}

/**
 * A best-effort label. The schema requires one and the honest default is
 * `method`; a model pass can refine these later without re-chunking.
 */
function classify(text: string): ContentChunkKind {
  const t = text.toLowerCase();
  if (/\b(definition|définition)\b|تعريف/.test(t)) return 'definition';
  if (/\b(theorem|théorème|property|propriété)\b|نظرية|مبرهنة/.test(t)) return 'theorem';
  if (/\b(example|exemple|worked)\b|مثال/.test(t)) return 'worked_example';
  if (text.includes('$$')) return 'formula';
  return 'method';
}

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry');
  const only = args.includes('--book') ? args[args.indexOf('--book') + 1] : null;

  const catalog = parseCsv(await readFile(CATALOG, 'utf8'));
  let totalChunks = 0;
  const report: string[] = [];

  for (const row of catalog) {
    if (!row.folder || (only && row.folder !== only && row.book_name !== only)) continue;

    const cleanDir = path.join(CORPUS, 'text', row.folder, 'clean');
    let pageFiles: string[];
    try {
      pageFiles = (await readdir(cleanDir)).filter((f) => /^page-\d+\.md$/.test(f)).sort();
    } catch {
      report.push(`${row.book_name}: not normalised — run scripts/corpus/normalise.py`);
      continue;
    }

    let taxonomy: { chapters?: Chapter[] };
    try {
      taxonomy = JSON.parse(await readFile(path.join(CORPUS, 'taxonomy', `${row.folder}.json`), 'utf8'));
    } catch {
      report.push(`${row.book_name}: no taxonomy`);
      continue;
    }
    const chapters = (taxonomy.chapters ?? []).filter((c) => c.pdfPage);
    if (!chapters.length) {
      report.push(`${row.book_name}: taxonomy has no placed chapters`);
      continue;
    }

    const pages = new Map<number, string>();
    for (const file of pageFiles) {
      const n = Number(/(\d+)/.exec(file)![1]);
      pages.set(n, await readFile(path.join(cleanDir, file), 'utf8'));
    }

    // Provenance first: every chunk points at the book it came from.
    const sha = row.sha8 ?? '';
    let documentId: string | null = null;
    if (!dry) {
      const doc = await db.sourceDocument.upsert({
        where: { bookKey: row.folder },
        update: { pageCount: Number(row.pages) || pages.size },
        create: {
          sha256: sha.padEnd(64, '0'),
          bookKey: row.folder,
          title: row.book_name ?? row.folder,
          publisher: 'CRDP',
          language: (row.language || 'en') as Language,
          tracks: (row.tracks || '').split(';').filter(Boolean),
          subjectName: row.subject ?? '',
          pageCount: Number(row.pages) || pages.size,
          licenceNote: row.note || null,
          reader: 'mathpix/document-ai',
        },
        select: { id: true },
      });
      documentId = doc.id;
    }

    let bookChunks = 0;

    for (const code of (row.tracks || '').split(';').map((t) => t.trim()).filter(Boolean)) {
      const track = await db.track.findUnique({ where: { code }, select: { id: true } });
      if (!track) continue;
      const subject = await db.subject.findFirst({
        where: { trackId: track.id, name: row.subject, language: (row.language || 'en') as Language },
        select: { id: true },
      });
      if (!subject) {
        report.push(`${row.book_name}: no subject row for ${code} — seed the taxonomy first`);
        continue;
      }

      const dbChapters = await db.chapter.findMany({
        where: { subjectId: subject.id },
        orderBy: { orderIndex: 'asc' },
        select: { id: true, name: true, orderIndex: true },
      });

      for (const [i, chapter] of chapters.entries()) {
        const target = dbChapters[i];
        if (!target) continue;

        const from = chapter.pdfPage!;
        const to = chapter.pdfPageEnd ?? from;
        const body: string[] = [];
        for (let p = from; p <= to; p += 1) {
          const text = pages.get(p);
          if (text?.trim()) body.push(`<!-- page ${p} -->\n\n${text.trim()}`);
        }
        if (!body.length) continue;

        const trail = [row.subject, chapter.title].filter(Boolean).join(' — ');
        const parts = splitChapter(body.join('\n\n'), trail);

        for (const part of parts) {
          bookChunks += 1;
          totalChunks += 1;
          if (dry) continue;

          // Identity is the text itself, so a re-run after a rule change
          // replaces rather than duplicates.
          const hash = createHash('sha256')
            .update(`${target.id}:${part.text}`)
            .digest('hex');

          const existing = await db.$queryRaw<{ id: string }[]>`
            SELECT id FROM content_chunks
            WHERE chapter_id = ${target.id}::uuid AND source_ref = ${hash}
            LIMIT 1
          `;
          if (existing.length) continue;

          await db.contentChunk.create({
            data: {
              chapterId: target.id,
              kind: classify(part.text),
              title: chapter.title.slice(0, 200),
              contentText: part.text,
              sourceRef: hash,
              sourceDocumentId: documentId,
              sourcePageFrom: part.page ?? from,
              sourcePageTo: part.page ?? to,
            },
          });
        }
      }
    }

    report.push(`${(row.book_name ?? row.folder).padEnd(26)} ${String(bookChunks).padStart(6)} chunks`);
  }

  console.log('');
  for (const line of report) console.log('  ' + line);
  console.log('');
  console.log(dry ? `Would write ${totalChunks} chunks.` : `${totalChunks} chunks.`);
  if (!dry) {
    const pending = await db.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) AS count FROM content_chunks WHERE embedding IS NULL
    `;
    console.log(`${Number(pending[0]?.count ?? 0)} rows await an embedding.`);
    console.log('Next:  npm run ingest -- --embed-missing');
  }
}

main()
  .catch((e) => {
    console.error('Chunking failed:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
