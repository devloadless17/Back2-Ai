import { readFile } from 'node:fs/promises';

import { db } from '../../src/lib/db';

/**
 * Stores a hand-transcribed LaTeX body against one question.
 *
 *   npm run corpus:latex -- --id <uuid> --file transcription.md
 *   npm run corpus:latex -- --id <uuid> --file t.md --dry
 *
 * The exams were read by an OCR that returns text and flattens mathematics, so
 * `content_latex` is empty on all but five of 5,434 questions and the renderer —
 * which prefers LaTeX and already runs KaTeX — has never had anything to show.
 * A chemistry question whose only formula reads `C / pH? / = 10?` cannot be
 * answered from what the app displays; the notation was destroyed at OCR time
 * and no amount of re-rendering brings it back. This is how a correct reading
 * gets in, whether it came from a person, a vision model or Mathpix.
 *
 * Two things happen on write, and the second matters as much as the first:
 *
 *   `content_latex` is set, so the renderer starts using it immediately —
 *   `QuestionBody` reads `contentLatex || contentText`.
 *
 *   `embedding` is set to NULL, so the question is re-embedded from the text it
 *   now has. Skipping this leaves the row searchable by its damaged wording
 *   while displaying the corrected one, which is worse than either alone: the
 *   tutor would retrieve on one string and quote another. `npm run ingest --
 *   --embed-missing` picks them up.
 *
 * `content_text` is deliberately left alone. It is what the OCR actually
 * returned, and overwriting it would destroy the only record of what the reader
 * saw — which is the evidence any future comparison of readers depends on.
 */
function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token?.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const id = typeof args.id === 'string' ? args.id : null;
  const file = typeof args.file === 'string' ? args.file : null;

  if (!id || !file) {
    console.log('Usage: npm run corpus:latex -- --id <uuid> --file <path> [--dry]');
    process.exit(1);
  }

  const latex = (await readFile(file, 'utf8')).trim();
  if (latex.length < 20) throw new Error(`${file} is empty or too short to be a transcription.`);

  const before = await db.question.findUnique({
    where: { id },
    select: { id: true, contentText: true, contentLatex: true },
  });
  if (!before) throw new Error(`No question ${id}.`);

  // A count of the lines the OCR stranded, so the effect is visible rather than
  // asserted: these are the fragments a broken formula leaves behind.
  const stranded = before.contentText
    .split('\n')
    .filter((line) => line.trim().length > 0 && line.trim().length <= 3).length;

  console.log(`  question        ${id}`);
  console.log(`  text length     ${before.contentText.length}`);
  console.log(`  stranded lines  ${stranded}`);
  console.log(`  had latex       ${before.contentLatex ? 'yes' : 'no'}`);
  console.log(`  new latex       ${latex.length} chars`);

  if (args.dry) {
    console.log('\n  --dry: nothing written.');
    await db.$disconnect();
    return;
  }

  await db.$executeRaw`
    UPDATE questions SET content_latex = ${latex}, embedding = NULL WHERE id = ${id}::uuid
  `;
  console.log('\n  written. Re-embed with: npm run ingest -- --embed-missing');
  await db.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
