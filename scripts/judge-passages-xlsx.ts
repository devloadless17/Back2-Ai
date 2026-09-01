/**
 * The passage judgement, as a spreadsheet someone can do away from a terminal.
 *
 *   npm run judge:export -- --count 40                  # writes judgements.xlsx
 *   npm run judge:export -- --count 30 --subject Chemistry --track GS
 *   npm run judge:import -- --in judgements.xlsx        # reads the answers back
 *
 * WHY A FILE AND NOT A PROMPT
 *
 * `judge:passages` asks exactly the right question and has recorded ZERO
 * answers across three sessions. Not because the question is hard — it is ten
 * seconds of "does this passage help answer this question" — but because it
 * asks it down a terminal, one at a time, where Enter is skip and closing the
 * window loses the run. The measurement this repository most needs is gated
 * behind the interface least suited to the person best placed to give it.
 *
 * So the same pairs go out as a spreadsheet. It can be mailed, done on a phone
 * on a Sunday, half-finished and picked up later, and it cannot be lost by
 * pressing the wrong key. The judgements come back through `--import`, into the
 * same `passage_judgements` table `judge:passages` writes, so the existing
 * `--report` reads both without knowing which produced what.
 *
 * WHAT IT IS MEASURING
 *
 * Precision@1 over real questions: retrieval put ONE passage first, and a
 * person says whether it helps. It is not circular — nothing about the
 * judgement comes from the model being judged — and it is the number every
 * other retrieval decision here should be argued against: whether to change the
 * embedding model, whether reranking pays outside Arabic, whether a threshold
 * is in the right place.
 *
 * THE ONE RULE FOR WHOEVER FILLS IT IN
 *
 * Judge the PASSAGE, not the question and not the system. "Would this text help
 * a student answer this question?" A passage that is on the right topic but
 * answers something else is a No — that distinction is the entire point, and
 * scoring it as a Yes because it is nearly right is what makes the number
 * meaningless.
 *
 * Answers entered at random are worse than no answers: a coin flip near 50%
 * reads exactly like a real finding and has already been built on once here.
 * Leaving a row blank is always better than guessing at it.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import ExcelJS from 'exceljs';

import { db } from '@/lib/db';

const argv = process.argv.slice(2);
const arg = (name: string): string | null => {
  const i = argv.indexOf(name);
  return i === -1 ? null : argv[i + 1] ?? null;
};

const MODE_IMPORT = argv.includes('--import');
const COUNT = Number(arg('--count')) || 40;
const SUBJECT = arg('--subject');
const TRACK = arg('--track');
const OUT = arg('--out') ?? 'judgements.xlsx';
const IN = arg('--in') ?? 'judgements.xlsx';

/**
 * How much of each text goes in the cell.
 *
 * A Lebanese exercise runs to a couple of thousand characters and a passage to
 * more. Neither is readable in a spreadsheet cell at full length, and the
 * judgement does not need full length — it needs enough to tell what the
 * question is about and what the passage covers. 900 is about twelve lines at
 * the column width set below, which fits on a laptop screen without scrolling
 * inside the cell.
 */
const SHOWN = 900;

const ARABIC = /[؀-ۿ]/;

// ---------------------------------------------------------------------------
// Shared table
// ---------------------------------------------------------------------------

/** Same table `judge:passages` writes, created the same way, so either tool can go first. */
async function ensureTable(): Promise<void> {
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS passage_judgements (
      question_id uuid NOT NULL,
      chunk_id    uuid NOT NULL,
      helpful     boolean NOT NULL,
      similarity  double precision,
      judged_at   timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (question_id, chunk_id)
    )
  `);
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

type Pair = {
  questionId: string;
  chunkId: string;
  subject: string;
  track: string | null;
  question: string;
  passage: string;
  similarity: number;
};

/**
 * The pairs, assembled without a single model call.
 *
 * Every question in this corpus already carries its embedding — 4,134 of 4,134
 * — so re-embedding the text to search with it was paying for a vector that was
 * sitting in the same row being read. `judge:passages` does it that way and so
 * did the first cut of this, which meant the one measurement this project most
 * needs was gated behind an API balance. It no longer is: this runs on an
 * empty account.
 *
 * Done as ONE query with a lateral join rather than a loop of round trips. The
 * nearest chunk is chosen exactly as the product chooses it — top-1 by cosine,
 * scoped to the question's own subject — because measuring anything else would
 * be measuring a pipeline no student uses.
 */
async function collect(): Promise<Pair[]> {
  const rows = await db.$queryRaw<
    {
      question_id: string;
      chunk_id: string;
      subject: string;
      track: string | null;
      question: string;
      passage: string;
      similarity: number;
    }[]
  >`
    SELECT q.id            AS question_id,
           top.id          AS chunk_id,
           s.name          AS subject,
           t.code          AS track,
           q.content_text  AS question,
           top.content_text AS passage,
           top.similarity  AS similarity
      FROM questions q
      JOIN chapters c ON c.id = q.chapter_id
      JOIN subjects s ON s.id = c.subject_id
      LEFT JOIN tracks t ON t.id = s.track_id
      CROSS JOIN LATERAL (
        SELECT cc.id, cc.content_text, 1 - (cc.embedding <=> q.embedding) AS similarity
          FROM content_chunks cc
          JOIN chapter_content_chunks link ON link.chunk_id = cc.id
          JOIN chapters ch ON ch.id = link.chapter_id
         WHERE ch.subject_id = s.id AND cc.embedding IS NOT NULL
         ORDER BY cc.embedding <=> q.embedding
         LIMIT 1
      ) top
     WHERE q.verified_status <> 'rejected'
       AND q.embedding IS NOT NULL
       AND length(q.content_text) > 80
       AND (${SUBJECT}::text IS NULL OR s.name = ${SUBJECT})
       AND (${TRACK}::text IS NULL OR t.code = ${TRACK})
       AND NOT EXISTS (SELECT 1 FROM passage_judgements j WHERE j.question_id = q.id)
     ORDER BY random()
     LIMIT ${COUNT}
  `;

  return rows.map((r) => ({
    questionId: r.question_id,
    chunkId: r.chunk_id,
    subject: r.subject,
    track: r.track,
    question: r.question.replace(/\s+/g, ' ').trim().slice(0, SHOWN),
    passage: r.passage.replace(/\s+/g, ' ').trim().slice(0, SHOWN),
    similarity: Number(r.similarity),
  }));
}

async function exportWorkbook(pairs: Pair[]): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Bac II';
  wb.created = new Date();

  // --- Instructions --------------------------------------------------------
  const guide = wb.addWorksheet('Read me first');
  guide.getColumn(1).width = 104;
  const lines: [string, boolean][] = [
    ['What this is', true],
    ['', false],
    ['Our tutor answers a student by finding a passage from the textbooks and answering from it.', false],
    ['This sheet shows you real exam questions and, for each one, the passage it picked FIRST.', false],
    ['', false],
    ['We need to know how often that passage is actually useful. No software can tell us —', false],
    ['it would be the system marking its own work. It needs a person.', false],
    ['', false],
    ['What to do', true],
    ['', false],
    ['Go to the "Judgements" tab. For each row, read the question, read the passage, and', false],
    ['choose Yes or No in the "Does this passage help?" column. There is a dropdown.', false],
    ['', false],
    ['Yes  =  a student could use this passage to answer this question.', false],
    ['No   =  they could not. It is off-topic, or on the right topic but answers something else.', false],
    ['', false],
    ['The most important rule', true],
    ['', false],
    ['"On the right topic" is NOT the same as "helps answer it", and marking those as Yes', false],
    ['is what would make this whole exercise worthless. If the passage is about the right', false],
    ['chapter but does not get the student closer to an answer, it is a No.', false],
    ['', false],
    ['If you are not sure, LEAVE THE ROW BLANK. A blank row costs us nothing.', false],
    ['A guessed row is worse than no row at all — random answers come out near 50%,', false],
    ['which looks exactly like a real result and has already misled us once.', false],
    ['', false],
    ['Notes', true],
    ['', false],
    ['You do not have to finish. Twenty considered rows are worth more than forty rushed ones.', false],
    ['The last two columns are ID codes the system needs to match your answers up.', false],
    ['Please do not edit, sort, or delete rows — it breaks that matching.', false],
    ['', false],
    ['Save the file and send it back. That is all.', false],
  ];
  for (const [text, bold] of lines) {
    const row = guide.addRow([text]);
    row.getCell(1).font = { bold, size: bold ? 13 : 11 };
    row.getCell(1).alignment = { wrapText: false, vertical: 'middle' };
  }

  // --- Judgements ----------------------------------------------------------
  const sheet = wb.addWorksheet('Judgements', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  sheet.columns = [
    { header: '#', key: 'n', width: 5 },
    { header: 'Subject', key: 'subject', width: 22 },
    { header: 'The exam question', key: 'question', width: 62 },
    { header: 'The passage the system chose', key: 'passage', width: 62 },
    { header: 'Does this passage help?', key: 'verdict', width: 24 },
    { header: 'Notes (optional)', key: 'notes', width: 30 },
    { header: 'qid', key: 'qid', width: 14 },
    { header: 'cid', key: 'cid', width: 14 },
    /*
     * Carried through the sheet so it survives the round trip.
     *
     * Left out of the first cut, and the cost showed up immediately: the import
     * wrote NULL and the report printed `mean similarity 0.000` for every
     * subject. Whether the score SEPARATES helpful passages from unhelpful ones
     * is the single most useful thing this exercise can produce — it is what any
     * threshold change has to be argued against — and re-deriving it later means
     * re-embedding every question to recover a number we already had here.
     */
    { header: 'sim', key: 'sim', width: 10 },
  ];

  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A5F' } };
  header.alignment = { vertical: 'middle', wrapText: true };
  header.height = 30;

  for (const [i, p] of pairs.entries()) {
    const row = sheet.addRow({
      n: i + 1,
      subject: p.track ? `${p.subject} (${p.track})` : p.subject,
      question: p.question,
      passage: p.passage,
      verdict: '',
      notes: '',
      qid: p.questionId,
      cid: p.chunkId,
      sim: Number(p.similarity.toFixed(4)),
    });

    row.height = 116;
    for (const key of ['question', 'passage'] as const) {
      const cell = row.getCell(key);
      cell.alignment = {
        wrapText: true,
        vertical: 'top',
        // Arabic and the Latin scripts sit in the same column, so alignment is
        // decided per cell. A right-to-left passage flush left is legible but
        // reads as broken, and this sheet is going to someone who did not
        // build it.
        horizontal: ARABIC.test(cell.value as string) ? 'right' : 'left',
        readingOrder: ARABIC.test(cell.value as string) ? 'rtl' : 'ltr',
      };
    }
    row.getCell('verdict').alignment = { vertical: 'middle', horizontal: 'center' };
    row.getCell('verdict').font = { bold: true, size: 12 };
    row.getCell('verdict').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF7D6' } };
    row.getCell('subject').alignment = { vertical: 'top', wrapText: true };
    row.getCell('notes').alignment = { vertical: 'top', wrapText: true };

    // A dropdown rather than free text: "y", "Y", "yes", "oui" and a tick are
    // all the same judgement and all different strings, and reconciling them on
    // import is guesswork about what somebody meant.
    row.getCell('verdict').dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: ['"Yes,No"'],
      showErrorMessage: true,
      errorTitle: 'Yes or No',
      error: 'Choose Yes or No, or leave it blank if you are not sure.',
    };
  }

  // The id columns are needed on the way back and are noise on the way out.
  sheet.getColumn('qid').hidden = true;
  sheet.getColumn('cid').hidden = true;
  sheet.getColumn('sim').hidden = true;

  sheet.autoFilter = { from: 'A1', to: 'F1' };

  await wb.xlsx.writeFile(OUT);
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

/**
 * The sheet, read without trusting who wrote it.
 *
 * exceljs writes this file and then cannot read it back once anything else has
 * saved it. A workbook that has been through a non-Excel editor comes back as
 * `<x:workbook><x:sheets><x:sheet .../></x:sheets></x:workbook>` — every
 * element namespace-prefixed, and `docProps` dropped entirely. That is valid
 * OOXML and Excel opens it happily; exceljs's parser looks for unprefixed
 * element names, finds none, and fails with `Cannot read properties of
 * undefined (reading 'sheets')`.
 *
 * This matters more than it sounds. The whole point of the spreadsheet is that
 * it leaves this machine and comes back from someone else's, and there is no
 * controlling what they open it in — Excel, LibreOffice, Google Sheets, a phone
 * viewer. An importer that only accepts files exceljs itself last touched would
 * fail on the first real return, which is the same class of failure that made
 * the terminal version record zero.
 *
 * So the XLSX is read as what it is: a zip of XML. Element names are matched
 * ignoring any namespace prefix, values are resolved through the shared-string
 * table, and cell references are read from `r="E7"` rather than assumed from
 * position — a writer is free to omit empty cells, and counting them would
 * shift every column after the first blank.
 */
type Cells = Map<string, string>;

async function readSheetCells(file: string): Promise<Cells[]> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(await readFile(file));

  const text = async (name: string): Promise<string> => {
    const entry = zip.file(name);
    return entry ? entry.async('string') : '';
  };

  // Shared strings, in order. `<si>` may hold one `<t>` or several inside runs;
  // the cell's value is all of them joined.
  const sharedXml = await text('xl/sharedStrings.xml');
  const shared: string[] = [];
  for (const si of sharedXml.match(/<(?:\w+:)?si>[\s\S]*?<\/(?:\w+:)?si>/g) ?? []) {
    const parts = [...si.matchAll(/<(?:\w+:)?t[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g)].map((m) => m[1] ?? '');
    shared.push(unescapeXml(parts.join('')));
  }

  // The sheet named "Judgements", found through the workbook rather than by
  // guessing at sheet2.xml — a writer may reorder the parts.
  const workbookXml = await text('xl/workbook.xml');
  const sheetTag = workbookXml.match(
    /<(?:\w+:)?sheet\b[^>]*name="Judgements"[^>]*>/i,
  )?.[0];
  if (!sheetTag) throw new Error(`No "Judgements" sheet in ${file}.`);
  const relId = sheetTag.match(/r:id="([^"]+)"/)?.[1];

  const relsXml = await text('xl/_rels/workbook.xml.rels');
  let target = relId
    ? relsXml.match(new RegExp(`<Relationship[^>]*Id="${relId}"[^>]*>`))?.[0]?.match(/Target="([^"]+)"/)?.[1]
    : undefined;
  if (!target) target = 'worksheets/sheet2.xml';
  const sheetPath = target.replace(/^\/?(xl\/)?/, 'xl/');

  const sheetXml = await text(sheetPath);
  const rows: Cells[] = [];
  for (const rowXml of sheetXml.match(/<(?:\w+:)?row\b[\s\S]*?<\/(?:\w+:)?row>/g) ?? []) {
    const index = Number(rowXml.match(/\br="(\d+)"/)?.[1] ?? 0);
    const cells: Cells = new Map();
    for (const cellXml of rowXml.match(/<(?:\w+:)?c\b[^>]*(?:\/>|>[\s\S]*?<\/(?:\w+:)?c>)/g) ?? []) {
      const ref = cellXml.match(/\br="([A-Z]+)\d+"/)?.[1];
      if (!ref) continue;
      const type = cellXml.match(/\bt="(\w+)"/)?.[1];
      const raw = cellXml.match(/<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/)?.[1];
      let value: string;
      if (type === 's') value = shared[Number(raw)] ?? '';
      else if (type === 'inlineStr') {
        const parts = [...cellXml.matchAll(/<(?:\w+:)?t[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g)].map((m) => m[1] ?? '');
        value = unescapeXml(parts.join(''));
      } else value = unescapeXml(raw ?? '');
      cells.set(ref, value.trim());
    }
    rows[index] = cells;
  }
  return rows;
}

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');
}

async function importWorkbook(): Promise<void> {
  const rows = await readSheetCells(IN);

  let written = 0;
  let blank = 0;
  let helpful = 0;
  const bad: number[] = [];

  for (let r = 2; r < rows.length; r += 1) {
    const cells = rows[r];
    if (!cells) continue;
    const verdict = (cells.get('E') ?? '').toLowerCase();
    const qid = cells.get('G') ?? '';
    const cid = cells.get('H') ?? '';
    const sim = Number(cells.get('I') ?? '');
    if (!qid || !cid) continue;

    if (!verdict) {
      blank += 1;
      continue;
    }
    if (verdict !== 'yes' && verdict !== 'no') {
      bad.push(r);
      continue;
    }

    await db.$executeRaw`
      INSERT INTO passage_judgements (question_id, chunk_id, helpful, similarity)
      VALUES (${qid}::uuid, ${cid}::uuid, ${verdict === 'yes'}, ${Number.isFinite(sim) && sim > 0 ? sim : null})
      ON CONFLICT (question_id, chunk_id) DO UPDATE SET helpful = EXCLUDED.helpful
    `;
    written += 1;
    if (verdict === 'yes') helpful += 1;
  }

  console.log('');
  console.log(`  judgements read   ${written}`);
  console.log(`  left blank        ${blank}`);
  if (bad.length) console.log(`  unreadable rows   ${bad.length}  (rows ${bad.slice(0, 10).join(', ')})`);
  console.log('');

  /*
   * The headline, with the caveat attached to it rather than left for the
   * reader to remember. Under about thirty rows this number cannot distinguish
   * a working retriever from a coin, and saying so here is cheaper than
   * discovering it after a decision has been made on it.
   */
  if (written > 0) {
    const pct = ((helpful / written) * 100).toFixed(0);
    console.log(`  PRECISION@1  ${helpful}/${written}  (${pct}%)`);
    if (written < 30) {
      console.log(`  Too few to conclude anything — under 30 rows this is within coin-flip range.`);
    }
    console.log('');
  }
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  await ensureTable();

  if (MODE_IMPORT) {
    await importWorkbook();
    await db.$disconnect();
    return;
  }

  console.log('');
  console.log(`  selecting ${COUNT} unjudged question(s)${SUBJECT ? ` in ${SUBJECT}` : ''}${TRACK ? ` (${TRACK})` : ''}…`);
  const pairs = await collect();

  if (pairs.length === 0) {
    console.log('  Nothing left to judge with those filters.');
    await db.$disconnect();
    return;
  }

  await exportWorkbook(pairs);
  console.log('');
  console.log(`  ${pairs.length} pair(s) written to ${path.resolve(OUT)}`);
  console.log('');
  console.log('  Send that file to whoever is judging. When it comes back:');
  console.log(`    npm run judge:import -- --in ${OUT}`);
  console.log('');
  await db.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await db.$disconnect();
  process.exit(1);
});
