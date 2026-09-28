/** Read-only comparison of stored generated questions with their exam references.
 * Run: node --env-file=.env --import tsx scripts/audit-ai-exam.ts
 * No generation, embeddings or other paid AI calls.
 */
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();
async function main() {
  try {
    const [count, generated] = await Promise.all([
      db.generatedProblem.count(),
      db.generatedProblem.findMany({
        orderBy: { createdAt: 'desc' }, take: 30,
        select: { id: true, styleReferenceIds: true, contentText: true, bareme: true,
          verificationStatus: true, publishedAt: true, modelUsed: true,
          generatedSolution: true, finalAnswer: true, verificationNotes: true,
          chapter: { select: { name: true, subject: { select: { name: true } } } } },
      }),
    ]);
    const refs = await db.question.findMany({
      where: { id: { in: [...new Set(generated.flatMap((q) => q.styleReferenceIds))] } },
      select: { id: true, contentText: true, contentImages: true, bareme: true, sourceType: true },
    });
    const realVisualExamples = (await Promise.all(['math', 'bio'].map((subject) =>
      db.question.findMany({
        where: { sourceType: 'past_exam',
          chapter: { subject: { OR: (subject === 'math' ? ['math'] : ['bio', 'life', 'vie'])
            .map((name) => ({ name: { contains: name, mode: 'insensitive' as const } })) } },
          contentText: { contains: subject === 'math' ? 'graph' : 'document', mode: 'insensitive' },
        },
        select: { contentText: true, chapter: { select: { name: true, subject: { select: { name: true } } } } },
        take: 2,
      }),
    ))).flat();
    const marks = (value: unknown) => Array.isArray(value)
      ? value.reduce((sum: number, item: { points?: number }) => sum + (item.points ?? 0), 0) : null;
    const full = process.argv.includes('--full');
    console.log(JSON.stringify({ count, sampled: generated.length, comparisons: generated.map((q) => ({
      id: q.id, chapter: q.chapter, modelUsed: q.modelUsed,
      status: q.verificationStatus, published: q.publishedAt !== null,
      text: full ? q.contentText : q.contentText.slice(0, 1200), marks: marks(q.bareme),
      ...(full ? { solution: q.generatedSolution, finalAnswer: q.finalAnswer,
        bareme: q.bareme, verificationNotes: q.verificationNotes } : {}),
      references: refs.filter((r) => q.styleReferenceIds.includes(r.id)).map((r) => ({
        id: r.id, sourceType: r.sourceType, marks: marks(r.bareme),
        text: full ? r.contentText : r.contentText.slice(0, 500),
      })),
    })), realVisualExamples: realVisualExamples.map((q) => ({
      chapter: q.chapter, text: q.contentText.slice(0, 1600),
    })) }, null, 2));
  } catch (error) {
    // Avoid exposing connection strings or credentials in diagnostics.
    console.error('Read-only database audit failed:', error instanceof Error ? error.name : 'unknown error');
    process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}
void main();
