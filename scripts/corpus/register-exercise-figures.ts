/**
 * Registers the crops from `exercise_figures.py` as visual evidence.
 *
 *   npm run corpus:exercise-figures                                    # dry run (default)
 *   npm run corpus:exercise-figures -- --apply --confirm-db <dbname>   # written PENDING
 *   npm run corpus:exercise-figures -- --apply --activate --confirm-db <dbname>
 *   npm run corpus:exercise-figures -- --rollback <run> --confirm-db <dbname>
 *
 * WHY A THIRD REGISTRAR. `backfill-visuals.ts` owns what Mathpix cropped, and
 * `register-document-crops.ts` owns the civics/economics مستندات. Neither can
 * reach a figure the paper DRAWS — a circuit, a cube, a hatched cylinder —
 * because Mathpix never cut it out. `exercise_figures.py` cuts those from the
 * PDF, inside one exercise's span.
 *
 * OWNERSHIP IS THE SPAN. A crop was found inside exactly one positioned
 * exercise (C1 container), so it belongs to that exercise's questions:
 * `structuralConfidence: exact`, `geometricConfidence: unique`. No text was
 * read to decide it, so `semanticConfidence` is `unresolved`, honestly.
 *
 * PENDING UNTIL AUDITED. Written `pending` unless `--activate` is passed, and
 * `--activate` is for after a contact-sheet audit has passed. A student sees
 * only `active` rows, so a bad batch here is invisible until someone decides.
 *
 * Exercises keyed exactly as load-exams.ts keys them:
 * sha256(`${subjectId}:${pdfSha256}:${exercise.index}:${order}`), order being
 * the position in the paper (container ordinal - 1).
 *
 * IDEMPOTENT: asset by content hash, occurrence by (paper, crop name),
 * relation by (question, occurrence). Rows with `tier = human` are never
 * touched. Nothing here writes to `questions`.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { db } from '../../src/lib/db';
import { putContentAddressed } from '../../src/lib/storage';
import { visualStorageKey } from '../../src/lib/visual-selection';

const ROOT = process.cwd();
const DIR = path.join(ROOT, 'corpus/exercise-figures');
const MANIFEST = path.join(DIR, 'manifest.json');
const EXAMS = path.join(ROOT, 'corpus/exams.json');

const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

const APPLY = process.argv.includes('--apply');
const ACTIVATE = process.argv.includes('--activate');
const CONFIRM_DB = arg('confirm-db');
const ROLLBACK = arg('rollback');

type Crop = {
  paper: string;
  pdfSha256: string;
  exerciseIndex: number;
  ordinal: number;
  page: number;
  box: [number, number, number, number];
  pageSize?: [number, number];
  file: string;
  contentSha256: string;
};
type ExamRow = { path: string; sha256: string; exercises: Array<{ index: number }> };

async function main() {
  if (!existsSync(MANIFEST)) {
    console.error('No manifest. Run: python scripts/corpus/exercise_figures.py --apply');
    process.exit(1);
  }
  const dbName = new URL(process.env.DATABASE_URL!).pathname.replace('/', '');
  if ((APPLY || ROLLBACK) && CONFIRM_DB !== dbName) {
    console.error(`Refusing to write: --confirm-db must be "${dbName}".`);
    process.exit(1);
  }
  if (ROLLBACK) return rollback(ROLLBACK, dbName);

  const raw = readFileSync(MANIFEST, 'utf-8');
  const evidenceRun = sha256(`exercise-figures:${raw}`);
  // The same PDF is filed under two tracks and appears twice in the manifest.
  const crops = new Map<string, Crop>();
  for (const c of JSON.parse(raw) as Crop[]) crops.set(`${c.pdfSha256}/${c.file}`, c);

  const wanted = new Set([...crops.values()].map((c) => c.pdfSha256));
  const exams = (JSON.parse(readFileSync(EXAMS, 'utf-8')) as ExamRow[]).filter((e) => wanted.has(e.sha256));
  const subjects = await db.subject.findMany({ select: { id: true } });

  const refTo = new Map<string, string>(); // sourceRef -> `${sha}#${ordinal}`
  for (const e of exams) {
    e.exercises.forEach((ex, order) => {
      for (const s of subjects) refTo.set(sha256(`${s.id}:${e.sha256}:${ex.index}:${order}`), `${e.sha256}#${order + 1}`);
    });
  }
  const rows = await db.question.findMany({
    where: { sourceRef: { in: [...refTo.keys()] } },
    select: { id: true, sourceRef: true, verifiedStatus: true },
  });
  const questionsAt = new Map<string, string[]>();
  for (const r of rows) {
    if (r.verifiedStatus === 'rejected') continue;
    const k = refTo.get(r.sourceRef!)!;
    questionsAt.set(k, [...(questionsAt.get(k) ?? []), r.id]);
  }

  type Planned = { crop: Crop; bytes: Buffer; contentHash: string; storageKey: string; cropName: string; questionIds: string[] };
  const planned: Planned[] = [];
  const skipped = { missingFile: 0, noQuestion: 0 };
  for (const crop of crops.values()) {
    const file = path.join(DIR, crop.file);
    if (!existsSync(file)) { skipped.missingFile++; continue; }
    const owners = questionsAt.get(`${crop.pdfSha256}#${crop.ordinal}`) ?? [];
    if (owners.length === 0) { skipped.noQuestion++; continue; }
    const bytes = readFileSync(file);
    const contentHash = sha256(bytes);
    planned.push({
      crop, bytes, contentHash,
      storageKey: visualStorageKey('question', contentHash, 'image/png'),
      // Distinct from Mathpix crop names (16 hex) and document crops, so the
      // (paper, cropName) key never collides with another registrar's row.
      cropName: `drawn-${crop.file.replace(/^[^/]+\//, '').replace(/\.png$/, '')}`,
      questionIds: [...new Set(owners)],
    });
  }

  console.log(JSON.stringify({
    database: dbName,
    mode: APPLY ? (ACTIVATE ? 'apply+activate' : 'apply (pending)') : 'dry-run',
    evidenceRun,
    manifestCrops: crops.size,
    planned: {
      assets: new Set(planned.map((p) => p.contentHash)).size,
      occurrences: planned.length,
      relations: planned.reduce((n, p) => n + p.questionIds.length, 0),
      questions: new Set(planned.flatMap((p) => p.questionIds)).size,
    },
    skipped,
  }, null, 2));
  if (!APPLY) { console.log('\n(dry run — pass --apply --confirm-db to write)'); await db.$disconnect(); return; }

  const status = ACTIVATE ? 'active' : 'pending';
  let links = 0, updated = 0, uploads = 0;
  for (const p of planned) {
    const asset = await db.visualAsset.upsert({
      where: { contentHash: p.contentHash },
      update: {},
      create: { contentHash: p.contentHash, mediaType: 'image/png', byteSize: p.bytes.byteLength },
    });
    if ((await putContentAddressed(p.storageKey, p.bytes, 'image/png')) === 'written') uploads++;
    const [x0, y0, x1, y1] = p.crop.box;
    const occ = await db.visualOccurrence.upsert({
      where: { paperSha256_cropName: { paperSha256: p.crop.pdfSha256, cropName: p.cropName } },
      update: { evidenceRun },
      create: {
        assetId: asset.id,
        paperSha256: p.crop.pdfSha256,
        cropName: p.cropName,
        page: p.crop.page,
        bboxX: Math.round(x0), bboxY: Math.round(y0),
        bboxW: Math.round(x1 - x0), bboxH: Math.round(y1 - y0),
        pageWidth: Math.round(p.crop.pageSize?.[0] ?? 595),
        pageHeight: Math.round(p.crop.pageSize?.[1] ?? 842),
        readingOrder: p.crop.ordinal,
        access: 'question',
        storageKey: p.storageKey,
        identityKind: 'figure',
        identityNumber: null,
        identityText: null,
        evidenceRun,
      },
    });
    for (const questionId of p.questionIds) {
      const existing = await db.questionVisual.findUnique({
        where: { questionId_occurrenceId: { questionId, occurrenceId: occ.id } },
        select: { id: true, tier: true, status: true },
      });
      if (existing?.tier === 'human') continue; // a reviewer decided this; leave it
      if (existing) {
        if (existing.status !== status) {
          await db.questionVisual.update({ where: { id: existing.id }, data: { status, evidenceRun } });
          updated++;
        }
        continue;
      }
      await db.questionVisual.create({
        data: {
          questionId, occurrenceId: occ.id, role: 'exercise_context',
          introducedInStimulus: false,
          structuralConfidence: 'exact',   // found inside this exercise's positioned span
          geometricConfidence: 'unique',   // and in no other exercise's
          semanticConfidence: 'unresolved', // no text was read to decide it
          tier: 'gated', status, evidenceRun,
        },
      });
      links++;
    }
  }
  console.log(JSON.stringify({ applied: { status, links, updated, uploads } }, null, 2));
  console.log(`\nrollback with:  npm run corpus:exercise-figures -- --rollback ${evidenceRun} --confirm-db ${dbName}`);
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
