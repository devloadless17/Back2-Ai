/**
 * Loads rendered exercise bands as visual evidence for the flattened rows.
 *
 *   npm run corpus:bands                                  # dry run (default)
 *   npm run corpus:bands -- --apply --confirm-db <dbname> # write
 *   npm run corpus:bands -- --rollback --confirm-db <dbname>
 *
 * ON ANY DATABASE BUT THE ONE THAT RENDERED THE BANDS, pass `--placements`:
 *
 *   npx tsx scripts/corpus/place-flattened-rows.ts --out ops-in/placements.json
 *   npm run corpus:bands -- --apply --confirm-db <dbname> --placements ops-in/placements.json
 *
 * Question ids are local to a database; the paper and exercise number are not.
 * See the comment on `--placements` below.
 *
 * WHAT A BAND IS. A picture of the exercise as the paper prints it, cut from
 * the PDF at the y range C1 recorded. It is attached to rows whose mathematics
 * the text layer destroyed — `2f(x) x lnx= +` for `f(x) = x² + ln x` — where no
 * pipeline can rebuild the glyphs, so the student reads them off the paper.
 *
 * A BAND IS NOT A FIGURE CROP AND MUST NEVER JOIN THE C2/C3 CHAIN.
 * `backfill-visuals` checks every crop's bytes against the hash C2 recorded and
 * silently SKIPS whatever disagrees, while still reporting success. A band has
 * no C2 record at all, so it would be skipped forever, or worse, be taken for a
 * corrupted crop. Three things keep the two apart:
 *
 *   - its crop name is prefixed `band-`, which no C2 crop uses, so the
 *     (paper, crop) unique key can never collide;
 *   - it is written under its own `evidenceRun`, prefixed `bands:`, so it can
 *     be found and rolled back without touching a single figure;
 *   - the relation is `tier = human`, the one tier `backfill-visuals` never
 *     touches, by apply or by rollback.
 *
 * DRY RUN UNLESS TOLD OTHERWISE, and `--apply` refuses to write unless
 * `--confirm-db` names the database the connection actually points at, so a
 * stale DATABASE_URL cannot be written to by accident.
 *
 * IDEMPOTENT. Asset by content hash, occurrence by (paper, crop name), relation
 * by (question, occurrence). Running it twice changes nothing the second time.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { db } from '../../src/lib/db';
import { putContentAddressed, storageGap } from '../../src/lib/storage';
import { visualStorageKey } from '../../src/lib/visual-selection';

const ROOT = process.cwd();

const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(f);
const arg = (f: string) => {
  const i = argv.indexOf(f);
  return i < 0 ? null : argv[i + 1] ?? null;
};
const APPLY = has('--apply');
const ROLLBACK = has('--rollback');
const CONFIRM_DB = arg('--confirm-db');

/*
 * Which set of bands to load. There are two, made different ways: the ones C1
 * positioned, and the ones `locate_exercise_text.py` found in the PDF's own text
 * layer for the papers C1 never read. They are kept in separate manifests so
 * each can be loaded, checked and rolled back on its own.
 */
const BANDS = arg('--bands') ?? path.join(ROOT, 'corpus/.mapping/exercise-bands/bands.json');

const MEDIA_TYPE = 'image/png';
const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

/**
 * Where a band's PNG actually is, on the machine reading the manifest.
 *
 * THE MANIFEST IS WRITTEN ON ONE OS AND READ ON ANOTHER. The renderer runs on
 * the laptop and the load runs in a Linux container, and a path Python joined
 * on Windows carries backslashes: `corpus/.mapping/exercise-bands\<id>.png` is
 * one impossible filename on Linux, not a directory and a file. Every band
 * would fail to open, and the failure would arrive as a stale-manifest error
 * that says nothing about paths.
 *
 * The file always sits beside `bands.json`, so the name alone is enough and the
 * recorded directory can be ignored. That is true whichever machine wrote it.
 */
const bandFile = (recorded: string) => path.join(path.dirname(BANDS), path.basename(recorded.replace(/\\/g, '/')));

type Band = {
  id: string;
  subject: string;
  path: string;
  sha: string;
  ordinal: number;
  score: number;
  file: string;
  contentHash: string;
  byteSize: number;
  page: number;
  pages: number[];
  width: number;
  height: number;
};

/** Refuses to write unless the connection really is the database named. */
async function assertDatabase() {
  const rows = await db.$queryRawUnsafe<Array<{ current_database: string }>>('select current_database()');
  const name = rows[0]?.current_database;
  if (!name) throw new Error('could not read the database name from this connection');
  if (!CONFIRM_DB) throw new Error(`--confirm-db is required to write; this connection is "${name}"`);
  if (CONFIRM_DB !== name) throw new Error(`--confirm-db says "${CONFIRM_DB}" but this connection is "${name}"`);
  return name;
}

async function rollback(run: string) {
  const dbName = await assertDatabase();
  /*
   * Relations first, then occurrences, then assets — the other order leaves a
   * foreign key pointing at nothing.
   *
   * IT REMOVES ONLY THE ASSETS THIS RUN'S OCCURRENCES USED. Sweeping up every
   * asset that happens to have no occurrence looks equivalent and is not: the
   * first version of this did exactly that and deleted 237 rows where the run
   * had created 118, taking 119 unreferenced leftovers from other work with it.
   * Nothing live was lost that time, because an asset with no occurrence is
   * referenced by nothing — but a rollback must undo its own run and no more.
   * An asset is still spared when another occurrence anywhere shares its bytes.
   */
  const mine = await db.visualOccurrence.findMany({ where: { evidenceRun: run }, select: { assetId: true } });
  const assetIds = [...new Set(mine.map((o) => o.assetId))];

  const relations = await db.questionVisual.deleteMany({ where: { evidenceRun: run, tier: 'human' } });
  const occurrences = await db.visualOccurrence.deleteMany({ where: { evidenceRun: run, relations: { none: {} } } });
  const assets = await db.visualAsset.deleteMany({ where: { id: { in: assetIds }, occurrences: { none: {} } } });
  console.log(`rolled back from ${dbName}: ${relations.count} relations, ${occurrences.count} occurrences, ${assets.count} assets`);
}

async function main() {
  const bands = JSON.parse(readFileSync(BANDS, 'utf-8')) as Band[];

  /*
   * The run identifies this set of bands, so a rollback can name exactly what
   * it removes. It is derived from the manifest, so re-rendering the bands
   * produces a different run rather than quietly overwriting the old one.
   */
  const run = `bands:${sha256(readFileSync(BANDS)).slice(0, 16)}`;

  if (ROLLBACK) {
    const target = arg('--rollback')?.startsWith('bands:') ? arg('--rollback')! : run;
    await rollback(target);
    return;
  }

  // Every band must still be the file it was rendered as, or the plan is stale.
  const stale: string[] = [];
  for (const b of bands) {
    const bytes = readFileSync(bandFile(b.file));
    if (sha256(bytes) !== b.contentHash) stale.push(bandFile(b.file));
  }
  if (stale.length) {
    throw new Error(`${stale.length} band files no longer match the manifest; re-run the renderer. First: ${stale[0]}`);
  }

  /*
   * A QUESTION'S ID IS LOCAL TO ITS DATABASE, AND THE BANDS ARE NOT.
   *
   * The manifest records the question ids of the machine that rendered it. Each
   * database makes its own `gen_random_uuid()`, so those ids name nothing in
   * production, and loading the manifest as it stands fails on
   * `question_visuals_question_id_fkey` — which is the good outcome. The bad one
   * would be an id that happened to exist and belonged to another question.
   *
   * What IS the same everywhere is the paper and the exercise number: a band is
   * a picture of `<paper sha256> exercise <n>`, and that is true of every copy
   * of the corpus. So `--placements` takes the output of
   * `place-flattened-rows.ts` RUN AGAINST THIS DATABASE, which carries this
   * database's question ids, and the band is matched to it by paper and
   * ordinal. Rows placed on an exercise we have no picture of are reported and
   * skipped rather than guessed at.
   */
  const placementsFile = arg('--placements');
  let work: Array<{ questionId: string; band: Band }>;
  if (placementsFile) {
    const placements = JSON.parse(readFileSync(placementsFile, 'utf-8')) as Array<{ id: string; sha: string; ordinal: number }>;
    const byExercise = new Map<string, Band>();
    for (const b of bands) byExercise.set(`${b.sha}#${b.ordinal}`, b);
    work = [];
    const noPicture: string[] = [];
    for (const p of placements) {
      const b = byExercise.get(`${p.sha}#${p.ordinal}`);
      if (!b) { noPicture.push(`${p.sha.slice(0, 8)}#${p.ordinal}`); continue; }
      work.push({ questionId: p.id, band: b });
    }
    console.log(`placements: ${placements.length}; matched to a band: ${work.length}; no picture: ${noPicture.length}`);
    if (noPicture.length) console.log(`  first few without a picture: ${noPicture.slice(0, 5).join(', ')}`);
  } else {
    work = bands.map((b) => ({ questionId: b.id, band: b }));
  }

  // Rows that have since gained a visual by some other route are left alone.
  const alreadyCovered = new Set(
    (
      await db.questionVisual.findMany({
        where: { questionId: { in: work.map((w) => w.questionId) }, status: 'active', evidenceRun: { not: run } },
        select: { questionId: true },
      })
    ).map((r) => r.questionId),
  );

  const planned = work.filter((w) => !alreadyCovered.has(w.questionId));
  console.log(`bands: ${bands.length}; already covered elsewhere: ${alreadyCovered.size}; to load: ${planned.length}`);
  console.log(`run: ${run}`);

  if (!APPLY) {
    const bySubject = planned.reduce<Record<string, number>>((a, w) => ((a[w.band.subject] = (a[w.band.subject] ?? 0) + 1), a), {});
    console.log('by subject:', bySubject);
    console.log(`bytes: ${(planned.reduce((a, w) => a + w.band.byteSize, 0) / 1e6).toFixed(1)} MB`);
    console.log('DRY RUN. Re-run with --apply --confirm-db <dbname> to write.');
    await db.$disconnect();
    return;
  }

  const dbName = await assertDatabase();

  /*
   * REFUSE TO WRITE INTO A DEPLOYMENT WHOSE UPLOADS DO NOT PERSIST.
   *
   * Every row written here points at an image. Where object storage is off the
   * bytes land in the container's own filesystem, which is discarded when the
   * one-off ops container exits — and the rows survive it, pointing at pictures
   * that no longer exist. The database then looks correct and 126 questions are
   * silently worse off than the flattened text they replaced. A warning is not
   * enough for that, and it is why this refuses rather than logs.
   *
   * `--allow-local-storage` exists for a developer machine, where the local
   * driver is the intended one and losing the bytes costs a re-run.
   */
  const gap = storageGap();
  if (gap && !has('--allow-local-storage')) {
    throw new Error(
      `object storage is not in use here (${gap}), so uploaded images would not survive this process. ` +
        'Refusing to write rows that would point at missing pictures. ' +
        'Pass --allow-local-storage if this is a development machine.',
    );
  }

  let assets = 0;
  let occurrences = 0;
  let relations = 0;
  let uploaded = 0;

  for (const { questionId, band: b } of planned) {
    const bytes = readFileSync(bandFile(b.file));
    const storageKey = visualStorageKey('question', b.contentHash, MEDIA_TYPE);
    if ((await putContentAddressed(storageKey, bytes, MEDIA_TYPE)) === 'written') uploaded++;

    const asset = await db.visualAsset.upsert({
      where: { contentHash: b.contentHash },
      create: { contentHash: b.contentHash, mediaType: MEDIA_TYPE, byteSize: b.byteSize },
      update: {},
    });
    assets++;

    /*
     * The band spans whole lines, so its box is the full page width and the y
     * range C1 gave. The `band-` prefix is what keeps this out of C2's names.
     */
    const cropName = `band-ex${b.ordinal}`;
    const occurrence = await db.visualOccurrence.upsert({
      where: { paperSha256_cropName: { paperSha256: b.sha, cropName } },
      create: {
        assetId: asset.id,
        paperSha256: b.sha,
        cropName,
        page: b.page,
        bboxX: 0,
        bboxY: 0,
        bboxW: b.width,
        bboxH: b.height,
        pageWidth: b.width,
        pageHeight: b.height,
        readingOrder: b.ordinal,
        access: 'question',
        storageKey,
        evidenceRun: run,
      },
      update: {},
    });
    occurrences++;

    /*
     * `exercise_context` is what it is: the exercise as printed, not a figure
     * the question points at. The confidences record how it was placed — the
     * wording matched exactly, there is no geometry to speak of, and the link
     * to the question is a direct one because the band IS this question.
     */
    await db.questionVisual.upsert({
      where: { questionId_occurrenceId: { questionId, occurrenceId: occurrence.id } },
      create: {
        questionId,
        occurrenceId: occurrence.id,
        role: 'exercise_context',
        introducedInStimulus: true,
        structuralConfidence: 'exact',
        geometricConfidence: 'none',
        semanticConfidence: 'direct_reference',
        tier: 'human',
        status: 'active',
        evidenceRun: run,
      },
      update: {},
    });
    relations++;
  }

  console.log(`wrote to ${dbName}: ${uploaded} objects uploaded, ${assets} assets, ${occurrences} occurrences, ${relations} relations`);
  console.log(`to undo: npm run corpus:bands -- --rollback ${run} --confirm-db ${dbName}`);
  await db.$disconnect();
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await db.$disconnect();
  process.exit(1);
});
