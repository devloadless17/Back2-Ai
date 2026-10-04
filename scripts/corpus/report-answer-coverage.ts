/**
 * What a GS student sees under every past-paper part, per subject: its own
 * official answer, the exercise's full official key, the whole official
 * answer, or the answer written on request (labelled, not the ministry's).
 * Read through the page's own `paperPartsOf`, so answers the page hides count
 * as not shown.
 *
 *   node --conditions=react-server --env-file=.env --import tsx scripts/corpus/report-answer-coverage.ts
 */
import { PrismaClient } from '@prisma/client';

import { paperPartsOf, partOnlyHeads } from '@/lib/paper-parts';
import { bodyToRender } from '@/lib/question-body';

const db = new PrismaClient();

async function main() {
  const rows = await db.question.findMany({
    where: { verifiedStatus: { not: 'rejected' }, sourceExam: { title: { contains: ' GS ' } } },
    select: { id: true, paperParts: true, officialSolution: true, officialSolutionLatex: true, modelSolution: true,
      sourceExam: { select: { title: true } } },
  });
  const tally = new Map<string, Record<string, number>>();
  const add = (subject: string, key: string, n = 1) => {
    const t = tally.get(subject) ?? {};
    t[key] = (t[key] ?? 0) + n;
    tally.set(subject, t);
  };
  for (const r of rows) {
    const subject = r.sourceExam!.title.split(' GS ')[0]!;
    const parts = paperPartsOf(r.paperParts);
    const official = bodyToRender(r.officialSolutionLatex, r.officialSolution ?? '').trim();
    if (!parts) {
      add(subject, official ? 'row: whole official answer' : 'row: NO official answer (AI on request)');
      continue;
    }
    const answered = parts.parts.some((p) => p.answer || p.answerImage);
    if (!answered) {
      add(subject, official ? 'row: parts + whole official answer' : 'row: parts, NO official answer (AI on request)');
      continue;
    }
    const leaves = parts.parts.filter((_, i) => !partOnlyHeads(parts.parts, i));
    const bare = leaves.filter((p) => !p.answer && !p.answerImage).length;
    add(subject, 'parts answered', leaves.length - bare);
    if (bare) add(subject, parts.fullKey ? 'parts covered by the full key' : 'parts bare (AI on request)', bare);
  }
  for (const [subject, t] of [...tally].sort()) console.log(subject.padEnd(18), JSON.stringify(t));
  await db.$disconnect();
}

void main();
