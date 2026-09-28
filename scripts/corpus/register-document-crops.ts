/**
 * Registers the crops from `document_crops.py` as canonical visual evidence.
 *
 *   npm run corpus:doc-crops                                   # dry run (default)
 *   npm run corpus:doc-crops -- --apply --confirm-db <dbname>
 *   npm run corpus:doc-crops -- --rollback <run> --confirm-db <dbname>
 *
 * WHY A SECOND REGISTRAR. `backfill-visuals.ts` reads the C1/C2/C3 artifacts,
 * and those only exist for papers Mathpix cropped. Civics, Economics and
 * Sociology were never sent to Mathpix, so they have no artifact to backfill
 * from — and their documents are framed text and data tables, which is the
 * thing the text layer mangles worst. These crops come from the printed page
 * instead, via the caption the paper itself prints.
 *
 * OWNERSHIP IS THE PRINTED NUMBER, NOTHING ELSE. A crop captioned "مستند رقم
 * (2)" belongs to the exercises whose text says "المستند رقم (2)". No geometry
 * is consulted and none is claimed: `geometricConfidence` is `none` and
 * `structuralConfidence` is `unresolved`, because no positioned container was
 * used to decide this. Neither field is read at selection time — only `status`
 * and `role` are — so they are recorded as provenance, honestly.
 *
 * This is only sound because the document numbers were repaired first. Before
 * `broken_digits.py`, questions on these papers cited "المستند رقم (0)" and
 * would have matched nothing, or worse, the wrong crop.
 *
 * PAPERS THAT REPEAT A NUMBER ARE REFUSED. A paper numbers its documents once.
 * Seeing 1,2,3,1,2,3 means the same document was cropped twice and the second
 * copy is the marking scheme's, printed beside its answers. `document_crops.py`
 * flags these; this refuses to register any of them rather than trusting the
 * crop that happens to come first.
 *
 * IDEMPOTENT, like the backfill: asset by content hash, occurrence by (paper,
 * crop), relation by (question, occurrence). Rows a reviewer has decided
 * (`tier = human`) are never touched. Nothing here writes to `questions`.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { db } from '../../src/lib/db';
import { putContentAddressed } from '../../src/lib/storage';
import { visualStorageKey } from '../../src/lib/visual-selection';

const ROOT = process.cwd();
const CROPS = path.join(ROOT, 'corpus/document-crops');
const MANIFEST = path.join(CROPS, 'manifest.json');
const EXAMS = path.join(ROOT, 'corpus/exams.json');

const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}
const APPLY = process.argv.includes('--apply');
const CONFIRM_DB = arg('confirm-db');
const ROLLBACK = arg('rollback');

type Crop = {
  paper: string; paperSha256: string; file: string; page: number;
  documentNumber: number | null; caption: string; readingOrder: number;
  bbox: [number, number, number, number]; pageWidth: number; pageHeight: number;
};
type Exercise = { index: number; statement: string; parts?: Array<{ label: string; text: string }> };
type ExamRow = { path: string; sha256: string; passage?: string | null; exercises: Exercise[] };

/** Every document number an exercise's own text cites. */
// Digits in all three forms the papers use: 1, ١ (Arabic-Indic) and ۱ (the
// Persian forms the older text layer emits, which this pattern used to miss).
const CITES = /(?:ال)?مستند(?:ين|ات)?\s*(?:رقم)?\s*[()]?\s*([0-9٠-٩۰-۹])/g;
// The damaged text layer puts the number BEFORE the word: "۱مستند رقم".
const CITES_BEFORE = /([0-9٠-٩۰-۹])\s*\)?\s*(?:ال)?مستند/g;
const TO_LATIN = (d: string) => {
  for (const digits of ['٠١٢٣٤٥٦٧٨٩', '۰۱۲۳۴۵۶۷۸۹']) if (digits.includes(d)) return String(digits.indexOf(d));
  return d;
};

/*
 * The same citation written as a word. "المستند الثاني" / "المستند الأول" /
 * "المستند الثالث" appear 94 times in the papers these crops come from, and
 * the digit pattern above read none of them, so those crops matched no
 * question at all.
 */
const ORDINAL: Record<string, number> = {
  'الأول': 1, 'الاول': 1, 'الأولى': 1, 'الاولى': 1,
  'الثاني': 2, 'الثانية': 2,
  'الثالث': 3, 'الثالثة': 3,
  'الرابع': 4, 'الرابعة': 4,
  'الخامس': 5, 'الخامسة': 5,
  'السادس': 6, 'السادسة': 6,
};
const CITES_WORD = /(?:ال)?مستند\s+(ال[أا]ول[ىه]?|الثاني[ةه]?|الثالث[ةه]?|الرابع[ةه]?|الخامس[ةه]?|السادس[ةه]?)/g;
// "المستندين رقم (1) و(2)": the plural cites two, and the digit pattern kept only the first.
const CITES_PAIR = /(?:ال)?مستند(?:ين|ات)\s*(?:رقم)?\s*[()]?\s*([0-9٠-٩۰-۹])\s*[()]?\s*(?:و|،|,|-)\s*[()]?\s*([0-9٠-٩۰-۹])/g;

function citedNumbers(text: string): Set<number> {
  const out = new Set<number>();
  for (const m of text.matchAll(CITES)) {
    const n = Number(TO_LATIN(m[1]!));
    if (Number.isFinite(n)) out.add(n);
  }
  for (const m of text.matchAll(CITES_BEFORE)) {
    const n = Number(TO_LATIN(m[1]!));
    if (Number.isFinite(n)) out.add(n);
  }
  for (const m of text.matchAll(CITES_WORD)) {
    const n = ORDINAL[m[1]!.replace(/ه$/, 'ة')];
    if (n) out.add(n);
  }
  for (const m of text.matchAll(CITES_PAIR)) {
    for (const d of [m[1]!, m[2]!]) {
      const n = Number(TO_LATIN(d));
      if (Number.isFinite(n)) out.add(n);
    }
  }
  return out;
}

function exerciseText(ex: Exercise): string {
  return [ex.statement, ...(ex.parts ?? []).map((p) => p.text)].join('\n');
}

async function main() {
  if (!existsSync(MANIFEST)) {
    console.error('No manifest. Run: python scripts/corpus/document_crops.py --apply');
    process.exit(1);
  }
  const dbName = new URL(process.env.DATABASE_URL!).pathname.replace('/', '');
  if ((APPLY || ROLLBACK) && CONFIRM_DB !== dbName) {
    console.error(`Refusing to write: --confirm-db must be "${dbName}".`);
    process.exit(1);
  }

  if (ROLLBACK) return rollback(ROLLBACK, dbName);

  const raw = readFileSync(MANIFEST, 'utf-8');
  const evidenceRun = sha256(raw);
  // The same PDF is filed under two tracks and appears twice in the manifest.
  const crops = new Map<string, Crop>();
  for (const c of JSON.parse(raw) as Crop[]) crops.set(`${c.paperSha256}/${c.file}`, c);

  /*
   * The marking scheme's copies go first, by page.
   *
   * A repeated number is usually the scheme reprinting its documents beside
   * the answers, and the extractor knows how many pages the question paper
   * itself runs to (`paperPages`). 41 of the repeats sat past that page.
   * Refusing the whole paper for them threw away its real documents too, so
   * crops after the paper's last page are dropped first, and a paper is
   * refused only if its numbering still repeats among what is left.
   */
  const paperPages = new Map<string, number>();
  for (const e of JSON.parse(readFileSync(EXAMS, 'utf-8')) as Array<{ sha256: string; paperPages?: number }>) {
    if (e.sha256 && e.paperPages) paperPages.set(e.sha256, e.paperPages);
  }
  let schemeCopies = 0;
  for (const [key, c] of crops) {
    const last = paperPages.get(c.paperSha256);
    if (last && c.page > last) {
      crops.delete(key);
      schemeCopies++;
    }
  }

  // Refuse any paper whose numbering still repeats — see the note at the top.
  const byPaper = new Map<string, Crop[]>();
  for (const c of crops.values()) byPaper.set(c.paperSha256, [...(byPaper.get(c.paperSha256) ?? []), c]);
  /*
   * NUMBERED PER EXERCISE. Sociology and civics papers often restart their
   * numbering in each exercise: documents 1-4 for the first, 1-2 for the
   * second. Read in page order, each restart opens a new group. When the
   * groups are exactly as many as the paper's exercises, group k belongs to
   * exercise k — and a crop is still linked only if that exercise's own text
   * cites its number. Any other count, and the paper stays refused: guessing
   * which exercise a "document 1" belongs to would show a student the wrong one.
   */
  const exercisesIn = new Map<string, number>();
  for (const e of JSON.parse(readFileSync(EXAMS, 'utf-8')) as Array<{ sha256: string; exercises?: unknown[] }>) {
    if (e.sha256) exercisesIn.set(e.sha256, e.exercises?.length ?? 0);
  }
  const groupOf = new Map<Crop, number>();
  const refused = new Set<string>();
  let grouped = 0;
  for (const [sha, cs] of byPaper) {
    const ns = cs.map((c) => c.documentNumber).filter((n): n is number => n !== null);
    if (new Set(ns).size === ns.length) continue;
    const ordered = [...cs].sort((a, b) => a.page - b.page || a.readingOrder - b.readingOrder);
    let group = 1;
    let previous = 0;
    const groups = new Map<Crop, number>();
    for (const c of ordered) {
      if (c.documentNumber !== null && c.documentNumber <= previous) group++;
      if (c.documentNumber !== null) previous = c.documentNumber;
      groups.set(c, group);
    }
    if (group > 1 && group === exercisesIn.get(sha)) {
      for (const [c, g] of groups) groupOf.set(c, g);
      grouped++;
    } else {
      refused.add(sha);
    }
  }

  // Exercise rows, keyed exactly as load-exams.ts keys them.
  //
  // ONLY the papers that have crops. Keying every exercise against every
  // subject is 5,000 × 17 candidate refs, and Postgres refuses an `IN` that
  // large alongside a negation it cannot split the query on. Restricting to the
  // papers in hand is both the fix and the honest scope.
  const wanted = new Set([...crops.values()].map((c) => c.paperSha256));
  const exams = (JSON.parse(readFileSync(EXAMS, 'utf-8')) as ExamRow[])
    .filter((e) => e.sha256 && wanted.has(e.sha256));
  const subjects = await db.subject.findMany({ select: { id: true, name: true } });
  const refTo = new Map<string, { sha: string; ordinal: number }>();
  for (const e of exams) {
    e.exercises.forEach((ex, order) => {
      for (const s of subjects) refTo.set(sha256(`${s.id}:${e.sha256}:${ex.index}:${order}`), { sha: e.sha256, ordinal: order + 1 });
    });
  }

  // THE CITATION IS READ FROM THE STORED QUESTION, not from exams.json.
  //
  // Scanning the extractor's `exercises` first looked equivalent and was not:
  // on 42 papers it found no reference at all, because those papers parse as a
  // single exercise whose numbered questions sit in the passage rather than in
  // `parts`. `content_text` and `source_passage` are what the student is shown
  // and what the tutor is given, so a crop that matches them is a crop the
  // question really is about — and they carry the repaired document numbers.
  const rows = await db.question.findMany({
    where: { sourceRef: { in: [...refTo.keys()] } },
    select: { id: true, sourceRef: true, verifiedStatus: true, contentText: true, sourcePassage: true },
  });
  const questionsAt = new Map<string, string[]>();
  const citesBy = new Map<string, Set<number>>();
  for (const r of rows) {
    if (r.verifiedStatus === 'rejected') continue;   // filtered here, not in the query
    const t = refTo.get(r.sourceRef!)!;
    const k = `${t.sha}#${t.ordinal}`;
    questionsAt.set(k, [...(questionsAt.get(k) ?? []), r.id]);
    const cited = citedNumbers(`${r.contentText}\n${r.sourcePassage ?? ''}`);
    const seen = citesBy.get(k);
    if (seen) for (const n of cited) seen.add(n);
    else citesBy.set(k, cited);
  }

  type Planned = {
    crop: Crop; contentHash: string; bytes: Buffer; storageKey: string;
    cropName: string; questionIds: string[]; role: 'exercise_context' | 'paper_shared';
  };
  const planned: Planned[] = [];
  const skipped = { refusedPaper: 0, noNumber: 0, noCitingExercise: 0, missingFile: 0 };

  for (const crop of crops.values()) {
    if (refused.has(crop.paperSha256)) { skipped.refusedPaper++; continue; }
    if (crop.documentNumber === null) { skipped.noNumber++; continue; }
    const file = path.join(CROPS, crop.file);
    if (!existsSync(file)) { skipped.missingFile++; continue; }

    const owners: string[] = [];
    let ordinals = 0;
    const onlyOrdinal = groupOf.get(crop);
    for (const [key, cited] of citesBy) {
      if (!key.startsWith(`${crop.paperSha256}#`)) continue;
      if (onlyOrdinal !== undefined && key !== `${crop.paperSha256}#${onlyOrdinal}`) continue;
      if (!cited.has(crop.documentNumber)) continue;
      ordinals++;
      owners.push(...(questionsAt.get(key) ?? []));
    }
    if (owners.length === 0) { skipped.noCitingExercise++; continue; }

    const bytes = readFileSync(file);
    const contentHash = sha256(bytes);
    planned.push({
      crop, contentHash, bytes,
      storageKey: visualStorageKey('question', contentHash, 'image/png'),
      cropName: crop.file.replace(/\.png$/, ''),
      questionIds: [...new Set(owners)],
      role: ordinals > 1 ? 'paper_shared' : 'exercise_context',
    });
  }

  const relations = planned.reduce((n, p) => n + p.questionIds.length, 0);
  console.log(JSON.stringify({
    database: dbName,
    mode: APPLY ? 'apply' : 'dry-run',
    evidenceRun,
    manifestCrops: crops.size + schemeCopies,
    schemeCopiesDropped: schemeCopies,
    papersRefusedForRepeatedNumbers: refused.size,
    papersNumberedPerExercise: grouped,
    planned: {
      assets: new Set(planned.map((p) => p.contentHash)).size,
      occurrences: planned.length,
      relations,
      byRole: planned.reduce<Record<string, number>>((a, p) => {
        a[p.role] = (a[p.role] ?? 0) + p.questionIds.length; return a;
      }, {}),
    },
    skipped,
  }, null, 2));

  if (!APPLY) { console.log('\n(dry run — pass --apply --confirm-db to write)'); await db.$disconnect(); return; }

  let assets = 0, occurrences = 0, links = 0, uploads = 0;
  for (const p of planned) {
    const asset = await db.visualAsset.upsert({
      where: { contentHash: p.contentHash },
      update: {},
      create: { contentHash: p.contentHash, mediaType: 'image/png', byteSize: p.bytes.byteLength },
    });
    assets++;
    if ((await putContentAddressed(p.storageKey, p.bytes, 'image/png')) === 'written') uploads++;

    const occ = await db.visualOccurrence.upsert({
      where: { paperSha256_cropName: { paperSha256: p.crop.paperSha256, cropName: p.cropName } },
      update: { evidenceRun },
      create: {
        assetId: asset.id,
        paperSha256: p.crop.paperSha256,
        cropName: p.cropName,
        page: p.crop.page,
        bboxX: Math.round(p.crop.bbox[0]),
        bboxY: Math.round(p.crop.bbox[1]),
        bboxW: Math.round(p.crop.bbox[2] - p.crop.bbox[0]),
        bboxH: Math.round(p.crop.bbox[3] - p.crop.bbox[1]),
        pageWidth: Math.round(p.crop.pageWidth),
        pageHeight: Math.round(p.crop.pageHeight),
        readingOrder: p.crop.readingOrder,
        access: 'question',
        storageKey: p.storageKey,
        identityKind: 'document',
        identityNumber: p.crop.documentNumber,
        identityText: p.crop.caption,
        evidenceRun,
      },
    });
    occurrences++;

    for (const questionId of p.questionIds) {
      const existing = await db.questionVisual.findUnique({
        where: { questionId_occurrenceId: { questionId, occurrenceId: occ.id } },
        select: { id: true, tier: true },
      });
      if (existing?.tier === 'human') continue;   // a reviewer decided this; leave it
      if (existing) continue;
      await db.questionVisual.create({
        data: {
          questionId, occurrenceId: occ.id, role: p.role,
          introducedInStimulus: true,
          structuralConfidence: 'unresolved',   // no positioned container was used
          geometricConfidence: 'none',          // no geometry was used
          semanticConfidence: 'direct_reference', // the question names the document
          tier: 'automatic', status: 'active', evidenceRun,
        },
      });
      links++;
    }
  }

  console.log(JSON.stringify({ applied: { assets, occurrences, links, uploads } }, null, 2));
  console.log(`\nrollback with:  npm run corpus:doc-crops -- --rollback ${evidenceRun} --confirm-db ${dbName}`);
  await db.$disconnect();
}

async function rollback(run: string, dbName: string) {
  const links = await db.questionVisual.deleteMany({ where: { evidenceRun: run, tier: { not: 'human' } } });
  const occs = await db.visualOccurrence.deleteMany({ where: { evidenceRun: run, relations: { none: {} } } });
  console.log(JSON.stringify({ database: dbName, run, deleted: { relations: links.count, occurrences: occs.count } }, null, 2));
  console.log('Assets and stored bytes are left alone: they are content-addressed and shared.');
  await db.$disconnect();
}

main().catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1); });
