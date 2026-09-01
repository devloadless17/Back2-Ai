/**
 * Moves each past-exam question into the cycle for the language it is actually
 * written in.
 *
 *   npm run refile:languages            report only, writes nothing
 *   npm run refile:languages -- --apply move them
 *
 * The damage this repairs. `exam_cycles` was unique on
 * `(subject_id, year, session)` with nothing to tell the three printed editions
 * of a paper apart, so the Arabic, French and English philosophy papers for one
 * session collapsed into a single cycle. Measured before the fix: 254 of 1,088
 * cycles held more than one language, and a student opening "Philosophie LH
 * 2018 — session 1" was shown 58 questions that were really three papers.
 *
 * `20260901090000_exam_cycle_language` added the missing column and the loader
 * now stamps it, but neither can move what earlier runs already wrote: the
 * loader updates a known question's solution and barème in place and never
 * reconsiders its cycle. This does the moving.
 *
 * ---------------------------------------------------------------------------
 * It reads the script, not the subject.
 *
 * Guessing from the subject is what created the problem. Every question is
 * classified by the letters actually in it, and only a wholesale disagreement
 * counts: a question is French or English if it has essentially no Arabic, and
 * Arabic if it is mostly Arabic. A French paper quoting Arabic, or an Arabic
 * paper carrying a French term, lands in the band between and is left exactly
 * where it is. The report says how many those were, because a re-filing that
 * quietly moved the ambiguous cases would be the same class of mistake as the
 * fallback that caused this.
 *
 * Nothing is deleted and no question is created. A row either moves to another
 * cycle of the same subject, year and session, or it does not move.
 * ---------------------------------------------------------------------------
 */
import { PrismaClient, type Language } from '@prisma/client';

const db = new PrismaClient();

const ARABIC = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/g;
const LETTER = /[\p{Letter}]/gu;
/** French-only accents. English never has them; Arabic transliteration rarely. */
const FRENCH = /[éèêëàâçîïôûùœ]/i;

function arabicShare(text: string): number {
  const letters = text.match(LETTER)?.length ?? 0;
  if (letters === 0) return 0;
  return (text.match(ARABIC)?.length ?? 0) / letters;
}

const NO_ARABIC_AT_ALL = 0.02;
const MOSTLY_ARABIC = 0.6;

/**
 * The language a question is written in, or null when it is not clear-cut.
 *
 * French and English are separated by accented characters, which is crude and
 * is enough here: these are two printings of the same paper, and the French one
 * says "Expliquez ce jugement en dégageant la problématique qu'il soulève".
 * Where a Latin-script question carries no accent at all it is called English,
 * which is the safe direction — an accent-free French sentence re-filed as
 * English is one paper in the wrong pile, while treating every unaccented
 * question as ambiguous would leave the whole English corpus unmoved.
 */
function languageOfText(text: string): Language | null {
  const share = arabicShare(text);
  if (share > MOSTLY_ARABIC) return 'ar';
  if (share >= NO_ARABIC_AT_ALL) return null; // mixed — leave it alone
  return FRENCH.test(text) ? 'fr' : 'en';
}

async function main() {
  const apply = process.argv.includes('--apply');

  const questions = await db.question.findMany({
    where: { sourceType: 'past_exam', sourceExamId: { not: null } },
    select: {
      id: true,
      contentText: true,
      sourceExam: {
        select: { id: true, title: true, year: true, session: true, language: true, subjectId: true },
      },
    },
  });

  let alreadyRight = 0;
  let ambiguous = 0;
  const moves = new Map<string, { from: string; to: Language; ids: string[]; title: string }>();

  for (const q of questions) {
    const cycle = q.sourceExam;
    if (!cycle) continue;

    const actual = languageOfText(q.contentText);
    if (actual === null) {
      ambiguous += 1;
      continue;
    }
    if (actual === cycle.language) {
      alreadyRight += 1;
      continue;
    }

    const key = `${cycle.id}->${actual}`;
    const entry = moves.get(key) ?? { from: cycle.language, to: actual, ids: [], title: cycle.title };
    entry.ids.push(q.id);
    moves.set(key, entry);
  }

  const toMove = [...moves.values()].reduce((n, m) => n + m.ids.length, 0);

  console.log('');
  console.log(`  past-exam questions examined  ${questions.length}`);
  console.log(`  already in the right cycle    ${alreadyRight}`);
  console.log(`  to move                       ${toMove}`);
  console.log(`  left alone as ambiguous       ${ambiguous}   (scripts mixed, not wholesale)`);
  console.log('');

  const grouped = [...moves.values()].sort((a, b) => b.ids.length - a.ids.length);
  console.log('  biggest moves:');
  for (const move of grouped.slice(0, 12)) {
    console.log(
      `    ${String(move.ids.length).padStart(3)}  .${move.from} -> .${move.to}   ${move.title}`,
    );
  }
  if (grouped.length > 12) console.log(`    … and ${grouped.length - 12} more`);
  console.log('');

  if (!apply) {
    console.log('  DRY RUN — nothing was written. Re-run with --apply to move them.');
    console.log('  Moving means changing which cycle a question belongs to. Nothing is deleted,');
    console.log('  no question is created, and no mark any student earned is touched.');
    console.log('');
    await db.$disconnect();
    return;
  }

  let moved = 0;
  for (const [key, move] of moves) {
    const cycleId = key.split('->')[0]!;
    const source = questions.find((q) => q.sourceExam?.id === cycleId)?.sourceExam;
    if (!source) continue;

    /*
     * The destination cycle, created if this is the first paper of its language
     * for that subject and session. Titled from the original so the two
     * editions read as siblings rather than as unrelated papers.
     *
     * `findFirst` then `create`, not `upsert`.
     *
     * `session` is nullable, and a Prisma compound-unique lookup will not take
     * a null for one of its fields — so an upsert keyed on it does not compile
     * for the papers that carry no session. Those are real: the older folders
     * name a year and nothing else. A find-then-create handles both shapes.
     */
    const existing = await db.examCycle.findFirst({
      where: {
        subjectId: source.subjectId,
        year: source.year,
        session: source.session,
        language: move.to,
      },
      select: { id: true },
    });

    const target =
      existing ??
      (await db.examCycle.create({
        data: {
          subjectId: source.subjectId,
          year: source.year,
          session: source.session,
          language: move.to,
          title: source.title,
        },
        select: { id: true },
      }));

    const result = await db.question.updateMany({
      where: { id: { in: move.ids } },
      data: { sourceExamId: target.id },
    });
    moved += result.count;
  }

  console.log(`  moved: ${moved} questions into the cycle for their own language.`);
  console.log('');
  await db.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
