import { extractWeaknesses } from '../src/lib/diagnostics';
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

// A realistic Lebanese bulletin: some lines name a chapter, some are only a
// subject grade, one is illegible. All three must be handled differently.
const REPORT = `
Lycée — Bulletin du 2ème trimestre — Classe: Terminale GS

Mathématiques ............................ 11/20
  Contrôle 1 — Nombres complexes : 6/20  — "formule de Moivre non maîtrisée, erreurs de module"
  Contrôle 2 — Calcul intégral : 15/20 — "bon travail, intégration par parties acquise"
Physique ................................. 9/20
  Devoir — Circuit RC : 5/20 — "équation différentielle non établie, condensateur mal compris"
  Devoir — Radioactivité : 14/20
Chimie ................................... 13/20
Sciences de la vie ....................... [illisible]
Anglais .................................. 15/20
`;

(async () => {
  const user = await db.user.findFirst({ where: { trackId: { not: null } }, select: { id: true } });
  const result = await extractWeaknesses({ userId: user!.id, documentText: REPORT });

  console.log('status:', result.status);
  console.log('');
  console.log('filed against a chapter:');
  for (const i of result.items) {
    console.log(`  ${i.performance.padEnd(7)} ${i.subjectName} / ${i.chapterName}`);
    console.log(`          "${i.evidence.slice(0, 70)}"`);
  }
  console.log('');
  console.log(`unclear (not filed): ${result.unclear.length}`);
  for (const u of result.unclear) console.log(`  "${u.evidence.slice(0, 70)}"`);
  console.log(`unmatched chapter names: ${result.unmatched.length}`);
  for (const u of result.unmatched) console.log(`  ref ${u.chapterRef}`);
  console.log('');
  console.log('summary:', result.summary);
  await db.$disconnect();
})().catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1); });
