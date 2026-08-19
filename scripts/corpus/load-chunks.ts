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
 * A passage is stored once and linked to every chapter that teaches it. Four
 * tracks share textbooks, so the civics book used to be stored four times over;
 * now the four chapters point at one row. Identity is the SHA-256 of the text
 * and its book, which is what lets the second track's pass find the first
 * track's row instead of writing its own.
 *
 * Idempotent: re-running updates in place, never duplicates, and removes what
 * the current rules no longer produce.
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
type Chapter = {
  index: number;
  title: string;
  unit?: string | null;
  pdfPage?: number | null;
  pdfPageEnd?: number | null;
  /** Where on its first page the chapter starts. Null means the top of the page. */
  pdfOffset?: number | null;
  /** Where on its last page it stops. Null means the end of the page. */
  pdfEndOffset?: number | null;
};

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

/** Character ranges occupied by maths. A cut must never land inside one. */
function mathSpans(text: string): [number, number][] {
  const spans: [number, number][] = [];
  const re = /\$\$[\s\S]*?\$\$|\$[^$\n]+\$/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) spans.push([m.index, m.index + m[0].length]);
  return spans;
}

/**
 * A paragraph longer than MAX is not a paragraph — it is a page the reader
 * transcribed without a blank line in it. Splitting only on blank lines leaves
 * those as single 5,000-character chunks, which embed to mush: one vector
 * averaging six unrelated ideas matches every query weakly and none of them
 * well.
 *
 * So cut such a block at sentence ends near TARGET instead. Never inside
 * maths, and never mid-sentence unless the block offers no sentence end at all.
 */
function splitLongBlock(block: string): string[] {
  if (block.length <= MAX) return [block];

  const spans = mathSpans(block);
  const insideMaths = (i: number) => spans.some(([a, b]) => i > a && i < b);

  const cuts: number[] = [];
  const re = /[.!?؟。]\s+|[;؛]\s+|\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    const at = m.index + m[0].length;
    if (!insideMaths(at)) cuts.push(at);
  }

  const out: string[] = [];
  let start = 0;
  while (block.length - start > MAX) {
    const limit = start + MAX;
    let cut = -1;
    for (const c of cuts) {
      if (c <= start) continue;
      if (c > limit) break;
      cut = c;
      if (c - start >= TARGET) break; // close enough to target, take it
    }
    if (cut <= start) cut = limit; // no sentence end anywhere: cut hard
    const piece = block.slice(start, cut).trim();
    if (piece) out.push(piece);
    start = cut;
  }
  const rest = block.slice(start).trim();
  if (rest) out.push(rest);
  return out;
}

/**
 * Splits one chapter's text into retrievable passages.
 *
 * Three rules do most of the work:
 *
 *   Display maths never starts a chunk. A passage that opens with $$...$$ and
 *   no prose is unretrievable — the embedding of a bare formula carries almost
 *   no signal, and a student asks "how do I integrate by parts", not "\int u dv".
 *   So a block of maths is always attached to the text above it.
 *
 *   No chunk runs past MAX. Blocks that would are cut at sentence ends.
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
    if (!body) { bufferPage = null; return; }
    // A remainder too short to retrieve on its own belongs to the passage
    // before it, not to the bin — dropping it loses the end of the chapter.
    const previous = out[out.length - 1];
    if (body.length < MIN && previous) {
      previous.text += `\n\n${body}`;
      bufferPage = null;
      return;
    }
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
    // Maths is never cut; anything else too long for one chunk is.
    for (const piece of isMath ? [block] : splitLongBlock(block)) {
      const size = buffer.join('\n\n').length;

      // Never open a chunk with display maths — keep it with the prose above.
      if (size + piece.length > TARGET && !isMath && size >= MIN) flush();
      if (bufferPage === null) bufferPage = page;
      buffer.push(piece);

      if (buffer.join('\n\n').length > MAX && !isMath) flush();
    }
  }
  flush();
  return out;
}

/**
 * What makes a passage that passage: its text and the book it came from.
 *
 * Not the chapter. Four tracks share textbooks, and keying on the chapter meant
 * the same paragraph was written once per track. Defined here in one place
 * because two things depend on it agreeing exactly — the writer below, and the
 * `--rehash` pass that brought existing rows onto this scheme.
 */
function chunkIdentity(documentId: string, text: string): string {
  return createHash('sha256').update(`${documentId}:${text}`).digest('hex');
}

/**
 * A best-effort label. The schema requires one and the honest default is
 * `method`; a model pass can refine these later without re-chunking.
 */
function classify(text: string): ContentChunkKind {
  const t = text.toLowerCase();

  /*
   * Ordered by how much each signal asserts, because a passage can look like
   * several things at once — a definition usually contains maths, and a worked
   * example usually restates the theorem it applies.
   *
   * The first version of this keyed only on the literal words "definition" and
   * "theorem", which textbooks mostly do not print: they write "on appelle X…"
   * and "une suite est dite convergente lorsque…". Two thirds of the corpus
   * fell through to `method`, the catch-all, and the tutor could not be asked
   * to prefer an explanation over an exercise because almost nothing was
   * labelled as one.
   */
  if (
    /\b(definition|définition)\b|تعريف|on appelle|est appelée?|est appelé|on dit qu|est dite?\b|se définit|is called|is defined|we call|on nomme|يسمى|يعرف بأنه/.test(t)
  ) {
    return 'definition';
  }
  if (
    /\b(theorem|théorème|property|propriété|corollaire|corollary|lemme|lemma|axiome|axiom)\b|نظرية|مبرهنة|خاصية|il en résulte que|on en déduit que/.test(t)
  ) {
    return 'theorem';
  }
  if (/\b(example|exemple|worked|application|activité|activity)\b|مثال|تطبيق/.test(t)) {
    return 'worked_example';
  }
  if (text.includes('$$')) return 'formula';
  return 'method';
}

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry');
  const only = args.includes('--book') ? args[args.indexOf('--book') + 1] : null;

  /*
   * Re-label existing chunks in place.
   *
   * `kind` describes the text; the vector encodes the text. Improving the
   * classifier therefore changes no embedding and costs nothing, and re-running
   * the normal load would not help — a chunk whose text is unchanged keeps its
   * identity and is skipped.
   */
  /*
   * Bring existing rows onto the current identity scheme.
   *
   * Identity used to include the chapter. Rows written under the old scheme
   * carry the old hash, so a normal run would not recognise them, would write
   * every passage again and would pay to embed all of it a second time. This
   * recomputes the hash in the same code path that writes it, which is the only
   * way to be sure the two agree — reproducing it in SQL looked right and did
   * not match, because of how the text round-trips.
   */
  if (args.includes('--rehash')) {
    const rows = await db.$queryRaw<{ id: string; content_text: string; source_document_id: string | null; source_ref: string | null }[]>`
      SELECT id, content_text, source_document_id::text, source_ref FROM content_chunks
      WHERE source_document_id IS NOT NULL
    `;
    let changed = 0;
    for (const row of rows) {
      const hash = chunkIdentity(row.source_document_id!, row.content_text);
      if (hash !== row.source_ref) {
        await db.contentChunk.update({ where: { id: row.id }, data: { sourceRef: hash } });
        changed += 1;
      }
    }
    console.log('');
    console.log(`${changed} of ${rows.length} passage(s) re-keyed. No text and no embedding changed.`);
    return;
  }

  if (args.includes('--reclassify')) {
    const rows = await db.$queryRaw<{ id: string; content_text: string; kind: string }[]>`
      SELECT id, content_text, kind::text AS kind FROM content_chunks
    `;
    const before = new Map<string, number>();
    const after = new Map<string, number>();
    let changed = 0;

    for (const row of rows) {
      const kind = classify(row.content_text);
      before.set(row.kind, (before.get(row.kind) ?? 0) + 1);
      after.set(kind, (after.get(kind) ?? 0) + 1);
      if (kind !== row.kind) {
        await db.contentChunk.update({ where: { id: row.id }, data: { kind } });
        changed += 1;
      }
    }

    console.log('');
    console.log(`  ${'kind'.padEnd(16)}${'before'.padStart(8)}${'after'.padStart(8)}`);
    for (const kind of new Set([...before.keys(), ...after.keys()])) {
      console.log(`  ${kind.padEnd(16)}${String(before.get(kind) ?? 0).padStart(8)}${String(after.get(kind) ?? 0).padStart(8)}`);
    }
    console.log('');
    console.log(`${changed} of ${rows.length} chunk(s) re-labelled. No embedding changed.`);
    return;
  }

  const catalog = parseCsv(await readFile(CATALOG, 'utf8'));
  let totalChunks = 0;
  /** Per chapter, every passage this run produced for it, across all its books. */
  const keptByChapter = new Map<string, Set<string>>();
  let pruned = 0;
  let orphans = 0;
  const report: string[] = [];
  const sizes: number[] = [];
  // A book serving several tracks is chunked once per track, so the same
  // passage is stored — and embedded — once per track. Worth counting.
  const distinct = new Set<string>();

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

      /*
       * Chapters are matched by name, not by position.
       *
       * Position worked while every subject came from one book. Several come
       * from two or three — GS mathematics is an algebra volume and a calculus
       * volume — and each book now occupies its own range of order indices, so
       * the second book's first chapter is not the subject's first chapter.
       * Matching by position quietly filed the calculus book's content under
       * the algebra book's chapters and left twenty-one chapters empty: the
       * syllabus was visible in the app and had nothing behind it.
       *
       * Both sides of this comparison come from the same taxonomy JSON — the
       * seeder writes the chapter name from the same field read here — so an
       * exact match is the right expectation and a miss is worth reporting.
       */
      const dbByName = new Map(dbChapters.map((c) => [c.name.trim(), c]));

      for (const chapter of chapters) {
        const target = dbByName.get(chapter.title.trim());
        if (!target) {
          report.push(`${row.book_name}: no chapter row named "${chapter.title.slice(0, 40)}"`);
          continue;
        }

        const from = chapter.pdfPage!;
        const to = chapter.pdfPageEnd ?? from;

        /*
         * A chapter starts and ends where its heading does, which is not always
         * where a page does. Books set short sections several to a page — the
         * Tagore unit prints his view of the Creator and his mysticism both on
         * page 101 — and taking whole pages meant one of the two silently
         * carried the other's text, or was never placed at all.
         *
         * The end is trimmed before the start, so a chapter that lives entirely
         * inside one page keeps exactly the slice between its own two edges.
         */
        const startAt = chapter.pdfOffset ?? 0;
        const endAt = chapter.pdfEndOffset ?? null;
        const body: string[] = [];
        for (let p = from; p <= to; p += 1) {
          let text = pages.get(p);
          if (!text) continue;
          if (p === to && endAt !== null) text = text.slice(0, endAt);
          if (p === from) text = text.slice(startAt);
          if (text.trim()) body.push(`<!-- page ${p} -->\n\n${text.trim()}`);
        }
        if (!body.length) continue;

        const trail = [row.subject, chapter.title].filter(Boolean).join(' — ');
        const parts = splitChapter(body.join('\n\n'), trail);
        const keep = new Set<string>();

        for (const part of parts) {
          bookChunks += 1;
          totalChunks += 1;
          sizes.push(part.text.length);
          distinct.add(createHash('sha256').update(part.text).digest('hex'));
          if (dry) continue;

          /*
           * Identity is the text and the book it came from — no longer the
           * chapter as well.
           *
           * A textbook shared by four tracks used to produce four rows of the
           * same paragraph, one per track's chapter. It is now one row that
           * every one of those chapters points at, so the passage is stored
           * once and embedded once. Keying identity on the text is what makes
           * the second track's pass find the first track's row instead of
           * writing its own.
           */
          const hash = chunkIdentity(documentId!, part.text);
          keep.add(hash);

          const existing = await db.$queryRaw<{ id: string }[]>`
            SELECT id FROM content_chunks WHERE source_ref = ${hash} LIMIT 1
          `;
          const chunkId =
            existing[0]?.id ??
            (
              await db.contentChunk.create({
                data: {
                  kind: classify(part.text),
                  title: chapter.title.slice(0, 200),
                  contentText: part.text,
                  sourceRef: hash,
                  sourceDocumentId: documentId,
                  sourcePageFrom: part.page ?? from,
                  sourcePageTo: part.page ?? to,
                },
                select: { id: true },
              })
            ).id;

          // Linking is separate from creating: the passage may already exist
          // because another track's chapter loaded it first.
          await db.chapterContentChunk.upsert({
            where: { chapterId_chunkId: { chapterId: target.id, chunkId } },
            update: {},
            create: { chapterId: target.id, chunkId },
          });
        }

        /*
         * What this chapter should point at, remembered rather than acted on.
         *
         * Pruning here, inside the per-book loop, is wrong whenever a subject
         * draws on two books that name a chapter alike — a textbook and its
         * workbook both have "Production écrite". Both books resolve to the
         * same chapter row, so whichever ran second deleted everything the
         * first had just linked, and the chapter ended up holding one book's
         * passages or none. That cost 47 chapters their material.
         *
         * The sets are unioned across every book and the pruning happens once,
         * after all of them have been read, so a chapter is judged against
         * everything this run produced for it and not against the last book to
         * mention it.
         */
        if (!dry && keep.size) {
          const known = keptByChapter.get(target.id) ?? new Set<string>();
          for (const hash of keep) known.add(hash);
          keptByChapter.set(target.id, known);
        }

      }
    }

    report.push(`${(row.book_name ?? row.folder).padEnd(26)} ${String(bookChunks).padStart(6)} chunks`);
  }

  /*
   * Now that every book has been read, drop what no chapter produced.
   *
   * A chunk's identity is the hash of its text, so changing a chunking rule
   * does not update rows — it writes new ones and leaves the old ones behind.
   * After the split rule was fixed the table held both vintages of the same
   * pages, which would have embedded the corpus twice and returned each
   * passage twice at two different boundaries.
   *
   * Chapters that produced nothing at all are left alone rather than emptied,
   * so a taxonomy regression cannot silently clear a syllabus.
   */
  if (!dry) {
    for (const [chapterId, keep] of keptByChapter) {
      // Unlink first. The passage itself may still be taught by another
      // track's chapter, and deleting it there would empty a syllabus this
      // run was not even looking at.
      const stale = await db.chapterContentChunk.deleteMany({
        where: { chapterId, chunk: { sourceRef: { notIn: [...keep] } } },
      });
      pruned += stale.count;
    }

    // Then remove passages no chapter points at any more.
    const orphaned = await db.contentChunk.deleteMany({ where: { chapters: { none: {} } } });
    orphans += orphaned.count;
  }

  console.log('');
  for (const line of report) console.log('  ' + line);
  console.log('');
  if (sizes.length) {
    // Chunk length is the one number worth watching: it decides both retrieval
    // quality and what the embeddings cost.
    const s = [...sizes].sort((a, b) => a - b);
    const at = (q: number) => s[Math.min(s.length - 1, Math.floor(s.length * q))];
    const total = s.reduce((a, b) => a + b, 0);
    console.log(
      `  chars/chunk   median ${at(0.5)}   p90 ${at(0.9)}   max ${s[s.length - 1]}` +
        `   over MAX ${s.filter((n) => n > MAX + 200).length}`,
    );
    console.log(`  ${(total / 1000).toFixed(0)}k characters total, ~${Math.round(total / 4 / 1000)}k tokens to embed`);
    const copies = sizes.length - distinct.size;
    if (copies > 0) {
      console.log(
        `  ${distinct.size} distinct passages, placed ${copies} extra time(s) in ` +
          `other tracks' chapters — stored and embedded once each`,
      );
    }
    console.log('');
  }
  console.log(
    dry
      ? `Would place ${totalChunks} chunk(s) across chapters.`
      : `${totalChunks} chapter placement(s).`,
  );
  if (pruned) console.log(`${pruned} chapter link(s) from superseded rules removed.`);
  if (orphans) console.log(`${orphans} passage(s) no chapter uses any more, deleted.`);
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
