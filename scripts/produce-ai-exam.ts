/** Local-only production CLI. See docs/ai-exam-production.md. */
import { readFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';

const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid');
if (url.hostname !== 'localhost' || url.port !== '5442' || url.pathname !== '/bac2' || process.env.STORAGE_DRIVER === 's3') {
  throw new Error('This workflow is restricted to local bac2 at localhost:5442 with local storage.');
}
const db = new PrismaClient();
const args = process.argv.slice(2);
async function main() {
  try {
    if (args[0] === '--catalog') {
      const rows = await db.subject.findMany({ where: { name: { contains: 'math', mode: 'insensitive' }, language: 'en' },
        select: { id: true, name: true, track: { select: { name: true } }, chapters: { where: { questions: { some: { sourceType: 'past_exam', officialSolution: { not: null } } } },
          select: { id: true, name: true, questions: { where: { sourceType: 'past_exam', officialSolution: { not: null } },
            select: { id: true, contentText: true, bareme: true }, take: 2 } }, take: 12 } },
      });
      console.log(JSON.stringify(rows, null, 2)); return;
    }
    if (!args[0]) throw new Error('Use --catalog, or blueprint.json [--validate-only] [--resume paper-id].');
    const blueprint = JSON.parse(await readFile(args[0], 'utf8'));
    const { validateBlueprint, produceAiExam } = await import('../src/lib/ai-exam-production');
    if (args.includes('--validate-only')) {
      console.log(JSON.stringify(await validateBlueprint(blueprint), null, 2)); return;
    }
    const resumeIndex = args.indexOf('--resume');
    const id = await produceAiExam(blueprint, resumeIndex >= 0 ? args[resumeIndex + 1] : undefined);
    console.log(`Paper ready for local human review: ${id}. Open /admin/ai-exams.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Production failed.');
    process.exitCode = 1;
  } finally { await db.$disconnect(); }
}
void main();
