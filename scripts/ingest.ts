/**
 * Ingestion CLI.
 *
 *   npm run ingest -- --embed-missing
 *   npm run ingest -- --file ./papers/math-2023.pdf --track GS --subject "Mathématiques" \
 *                     --kind exam_paper --year 2023 --session session1
 *   npm run ingest -- --file ./notes/analyse.pdf --track GS --subject "Mathématiques" \
 *                     --kind course_material
 *
 * The same code path the admin page triggers, exposed for bulk loading — the
 * initial corpus is hundreds of papers and nobody is uploading those one at a
 * time through a browser.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { PrismaClient } from '@prisma/client';

import { createJob, embedPending, recalibrateDifficulty, runIngestion } from '../src/lib/ingestion';

const db = new PrismaClient();

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

function contentTypeFor(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.pdf':
      return 'application/pdf';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.txt':
    case '.md':
      return 'text/plain';
    default:
      throw new Error(`Cannot infer a content type for ${filePath}. Supported: pdf, png, jpg, webp, txt.`);
  }
}

function usage(): never {
  console.log(
    [
      'Usage:',
      '  npm run ingest -- --embed-missing',
      '  npm run ingest -- --recalibrate',
      '  npm run ingest -- --file <path> --track <CODE> --subject <NAME> --kind <exam_paper|course_material>',
      '                    [--year 2023] [--session session1] [--duration 180]',
      '',
      'Options:',
      '  --embed-missing   Backfill embeddings for every row that has none.',
      '  --recalibrate     Recompute question difficulty from observed attempts.',
    ].join('\n'),
  );
  process.exit(1);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args['embed-missing']) {
    console.log('Backfilling embeddings…');
    const counts = await embedPending();
    console.log(`  questions embedded: ${counts.questions}`);
    console.log(`  course-material chunks embedded: ${counts.chunks}`);
    console.log(`  personal reference documents embedded: ${counts.references}`);
    return;
  }

  if (args.recalibrate) {
    const updated = await recalibrateDifficulty();
    console.log(`Recalibrated difficulty for ${updated} question(s).`);
    return;
  }

  const filePath = typeof args.file === 'string' ? args.file : null;
  const trackCode = typeof args.track === 'string' ? args.track : null;
  const subjectName = typeof args.subject === 'string' ? args.subject : null;
  const kind = typeof args.kind === 'string' ? args.kind : 'exam_paper';

  if (!filePath || !trackCode || !subjectName) usage();
  if (kind !== 'exam_paper' && kind !== 'course_material') usage();

  const track = await db.track.findUnique({ where: { code: trackCode }, select: { id: true } });
  if (!track) throw new Error(`No track with code "${trackCode}". Run the seed first.`);

  const subject = await db.subject.findFirst({
    where: { trackId: track.id, name: subjectName },
    select: { id: true, name: true },
  });
  if (!subject) throw new Error(`No subject "${subjectName}" in track ${trackCode}.`);

  const bytes = await readFile(filePath);
  const label = path.basename(filePath);

  const jobId = await createJob({
    kind,
    subjectId: subject.id,
    sourceLabel: label,
    triggeredBy: null,
  });

  console.log(`Job ${jobId} — ingesting ${label} into ${subject.name}…`);

  const result = await runIngestion(jobId, {
    kind,
    subjectId: subject.id,
    label,
    bytes,
    contentType: contentTypeFor(filePath),
    year: typeof args.year === 'string' ? Number(args.year) : undefined,
    session: typeof args.session === 'string' ? args.session : undefined,
    durationMinutes: typeof args.duration === 'string' ? Number(args.duration) : undefined,
  });

  console.log('');
  console.log(`  items found:     ${result.itemsTotal}`);
  console.log(`  ingested:        ${result.itemsProcessed}`);
  console.log(`  failed:          ${result.itemsFailed}`);
  console.log(`  needs review:    ${result.needsReview}`);
  console.log('');
  console.log('Ingested content is unverified. Confirm it in /admin/review-queue before a pilot.');
}

main()
  .catch((error) => {
    console.error('Ingestion failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
