import { fillQuizBank } from '../src/lib/quiz-bank';
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();
(async () => {
  const result = await fillQuizBank({ chapterId: 'c05310ab-3684-4fbd-8f79-5bc924dbad15', count: 6 });
  console.log('status:', result.status);
  console.log(`kept ${result.drafts.length}, rejected ${result.rejected.length}`);
  console.log('');
  for (const d of result.drafts) {
    console.log(`Q: ${d.question}`);
    d.options.forEach((o, i) => console.log(`   ${i === d.correctIndex ? '->' : '  '} ${o.slice(0, 74)}`));
    console.log(`   why: ${d.explanation.slice(0, 100)}`);
    console.log('');
  }
  for (const r of result.rejected) console.log(`rejected (${r.reason}): ${r.question.slice(0, 64)}`);
  await db.$disconnect();
})().catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1); });
