/**
 * Retrieval eval harness.
 *
 *   npm run eval
 *   npm run eval -- --sample 200
 *
 * Prints the tier distribution the current thresholds produce against the
 * corpus that is actually loaded, plus a sweep so the thresholds can be chosen
 * from data rather than argued about. See src/lib/eval.ts for the method.
 */

import { PrismaClient } from '@prisma/client';

import { runRetrievalEval } from '../src/lib/eval';

const db = new PrismaClient();

function bar(rate: number, width = 28): string {
  const filled = Math.round(rate * width);
  return `${'█'.repeat(filled)}${'·'.repeat(width - filled)}`;
}

async function main() {
  const args = process.argv.slice(2);
  const sampleIndex = args.indexOf('--sample');
  const sample = sampleIndex >= 0 ? Number(args[sampleIndex + 1]) : 50;

  console.log(`Running retrieval eval over ${sample} probes…\n`);

  const report = await runRetrievalEval(Number.isFinite(sample) ? sample : 50);

  console.log(`Probes:                ${report.probes}`);
  console.log(`Thresholds in force:   exact ${report.thresholds.exactMatch} · concept ${report.thresholds.conceptLevel}`);
  console.log('');

  console.log('Tier that would fire (leave-one-out):');
  for (const [tier, count] of Object.entries(report.tierCounts)) {
    const rate = report.probes === 0 ? 0 : count / report.probes;
    console.log(`  ${tier.padEnd(20)} ${bar(rate)} ${String(count).padStart(4)}  ${(rate * 100).toFixed(0)}%`);
  }
  console.log('');

  console.log(`Mean top similarity:   question ${report.meanTopQuestionSimilarity} · chunk ${report.meanTopChunkSimilarity}`);
  console.log('');

  console.log('Tier-1 threshold sweep (rate matching a DIFFERENT question):');
  for (const point of report.exactMatchSweep) {
    const marker = point.threshold === report.thresholds.exactMatch ? ' ← current' : '';
    console.log(`  ≥ ${point.threshold.toFixed(2)}  ${bar(point.rate)}  ${(point.rate * 100).toFixed(0)}%${marker}`);
  }
  console.log('');

  console.log('Tier-2 threshold sweep (rate matching course material):');
  for (const point of report.conceptSweep) {
    const marker = point.threshold === report.thresholds.conceptLevel ? ' ← current' : '';
    console.log(`  ≥ ${point.threshold.toFixed(2)}  ${bar(point.rate)}  ${(point.rate * 100).toFixed(0)}%${marker}`);
  }

  if (report.suspectedDuplicates.length > 0) {
    console.log('');
    console.log('Suspected duplicates:');
    for (const duplicate of report.suspectedDuplicates.slice(0, 10)) {
      console.log(`  ${duplicate.similarity}  ${duplicate.chapterName}  ${duplicate.questionId} ≈ ${duplicate.neighbourId}`);
    }
  }

  if (report.warnings.length > 0) {
    console.log('');
    console.log('Findings:');
    for (const warning of report.warnings) console.log(`  ! ${warning}`);
  }

  console.log('');
}

main()
  .catch((error) => {
    console.error('Eval failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
