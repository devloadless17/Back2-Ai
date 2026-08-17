import { fillFlashcardBank } from '../src/lib/flashcard-bank';
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();
(async () => {
  // Two chapters, deliberately different: physics prose and an Arabic civics chapter.
  const chapters = await db.chapter.findMany({
    where: { OR: [{ name: { contains: 'hotoelectric' } }, { name: { contains: 'الإعلام' } }] },
    select: { id: true, name: true, subject: { select: { name: true, language: true } } },
    take: 2,
  });
  for (const ch of chapters) {
    const r = await fillFlashcardBank({ chapterId: ch.id, count: 6 });
    console.log(`\n=== ${ch.subject.name} / ${ch.name} (${ch.subject.language}) — ${r.status}`);
    console.log(`kept ${r.drafts.length}, rejected ${r.rejected.length}`);
    for (const d of r.drafts.slice(0, 4)) {
      console.log(`  FRONT: ${d.front.slice(0, 78)}`);
      console.log(`  BACK : ${d.back.slice(0, 110)}`);
    }
    for (const x of r.rejected) console.log(`  rejected (${x.reason}): ${x.front.slice(0, 50)}`);
  }
  await db.$disconnect();
})().catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1); });
