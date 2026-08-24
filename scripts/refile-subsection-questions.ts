/**
 * Moves questions off chapter rows that are really sub-sections of another
 * chapter, and onto the chapter that actually holds their material.
 *
 *   npm run refile:subsections              what it would move
 *   npm run refile:subsections -- --apply
 *
 * WHY THIS IS NOT AN OVERRIDE JOB, which is what it looks like.
 *
 * LH/SE Life Sciences had six chapters with ZERO passages and 37 questions
 * between them, and the obvious reading — long descriptive titles, no text
 * found, so the locator failed — is wrong. The book's contents page lists five
 * chapters; `taxonomy.py` parses all five, places all five, and gives them 7 to
 * 104 passages each. Nothing is broken in the parse.
 *
 * The six empty rows are left over from an OLDER parse that promoted document
 * headings inside a chapter into chapters of their own. Every one of their
 * titles appears in the book as a heading INSIDE one of the five real chapters,
 * on a page inside that chapter's span:
 *
 *   Qualitative needs : requirements in proteins    pages 30, 40   -> ch 2 (21-42)
 *   Qualitative needs : requirements in vitamins    page  33       -> ch 2 (21-42)
 *   Qualitative needs : mineral requirements        page  34       -> ch 2 (21-42)
 *   To make a balanced diet                         pages 22, 42   -> ch 2 (21-42)
 *   The fate of nutrients                           pages 38, 42   -> ch 2 (21-42)
 *   Diseases of excessive food intake : cardio…     pages 50, 54   -> ch 3 (43-56)
 *
 * So the material was never missing. It is loaded, it is retrievable, and it
 * sits under the parent chapter — while the questions sit under a name with
 * nothing behind it. Writing a TOC override would invent chapters the book does
 * not have and split a chapter that teaches its topic as one thing.
 *
 * `prune:chapters` already finds these rows and deliberately refuses to touch
 * them, because deleting a chapter cascades into the questions on it. That is
 * the right call and it is why they have survived: the questions have to move
 * first. After this runs, the rows are empty of everything and `prune:chapters`
 * can remove them.
 *
 * The mapping is written out by hand below rather than inferred. A question is
 * a student-facing object and moving one to the wrong chapter is the same class
 * of error as a wrong answer key — it is checked against the book, per row,
 * and anything not listed here is left alone and reported.
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { db } from '@/lib/db';

const APPLY = process.argv.includes('--apply');
const TAXONOMY = path.join(process.cwd(), 'corpus', 'taxonomy');
const RECEIPT = path.join(process.cwd(), 'corpus', 'refiled-questions.json');

/** Every move made this run, with the question ids, so it can be undone. */
const receipt: {
  track: string;
  from: string;
  to: string;
  fromChapterId: string;
  toChapterId: string;
  questionIds: string[];
}[] = [];

/**
 * Sub-section title -> the chapter of the same book that contains it.
 *
 * Keyed by subject so a title cannot reach across books. Both sides are the
 * chapter NAME as the seeder wrote it, which is the taxonomy title verbatim.
 */
const REFILE: { subject: string; from: string; to: string; evidence: string }[] = [
  {
    subject: 'Life Sciences',
    from: 'Qualitative needs : requirements in proteins',
    to: 'The basic principles of balanced diets',
    evidence: 'heading on pages 30 and 40, inside the parent chapter span 21-42',
  },
  {
    subject: 'Life Sciences',
    from: 'Qualitative needs : requirements in vitamins',
    to: 'The basic principles of balanced diets',
    evidence: 'heading on page 33, inside the parent chapter span 21-42',
  },
  {
    subject: 'Life Sciences',
    from: 'Qualitative needs : mineral requirements',
    to: 'The basic principles of balanced diets',
    evidence: 'heading on page 34, inside the parent chapter span 21-42',
  },
  {
    subject: 'Life Sciences',
    from: 'To make a balanced diet',
    to: 'The basic principles of balanced diets',
    evidence: 'heading on pages 22 and 42, inside the parent chapter span 21-42',
  },
  {
    subject: 'Life Sciences',
    from: 'The fate of nutrients',
    to: 'The basic principles of balanced diets',
    evidence: 'heading on pages 38 and 42, inside the parent chapter span 21-42',
  },
  {
    subject: 'Life Sciences',
    from: 'Diseases of excessive food intake : cardiovascular diseases',
    to: 'Nutritional diseases : characteristics, causes and prevention',
    evidence: 'heading on pages 50 and 54, inside the parent chapter span 43-56',
  },
];

/**
 * Refuse to move anything onto a chapter the current taxonomy does not name.
 *
 * The whole argument for this script is that the destination is a real chapter
 * of a real book and the source is not. If the destination has stopped being
 * one — a retitled chapter, a re-parsed book — that argument is gone and the
 * move would be filing questions somewhere arbitrary. Checked against the
 * taxonomy on disk rather than assumed.
 */
async function taxonomyTitles(): Promise<Set<string>> {
  const { readdir } = await import('node:fs/promises');
  const titles = new Set<string>();
  for (const f of await readdir(TAXONOMY)) {
    if (!f.endsWith('.json')) continue;
    const data = JSON.parse(await readFile(path.join(TAXONOMY, f), 'utf8')) as {
      chapters?: { title?: string }[];
    };
    for (const c of data.chapters ?? []) if (c.title) titles.add(c.title.trim());
  }
  return titles;
}

async function main() {
  const known = await taxonomyTitles();
  let moved = 0;
  let blocked = 0;

  for (const rule of REFILE) {
    if (!known.has(rule.to)) {
      console.log(`  BLOCKED  no book's taxonomy names the destination "${rule.to}"`);
      blocked++;
      continue;
    }
    if (known.has(rule.from)) {
      // The source is a real chapter again. Either the book was re-parsed or
      // this rule is stale; either way, moving its questions would be wrong.
      console.log(`  BLOCKED  "${rule.from}" IS named by a book now — rule is stale`);
      blocked++;
      continue;
    }

    // Per track: the same pair of chapter names exists under LH and under SE,
    // and each track's questions must stay in its own track's chapter.
    const sources = await db.chapter.findMany({
      where: { name: rule.from, subject: { name: rule.subject } },
      select: {
        id: true,
        subjectId: true,
        subject: { select: { track: { select: { code: true } } } },
        _count: { select: { questions: true, contentChunks: true } },
      },
    });

    for (const source of sources) {
      const target = await db.chapter.findFirst({
        where: { name: rule.to, subjectId: source.subjectId },
        select: { id: true, _count: { select: { contentChunks: true } } },
      });
      const track = source.subject.track?.code ?? '--';

      if (!target) {
        console.log(`  BLOCKED  [${track}] no chapter "${rule.to}" in the same subject`);
        blocked++;
        continue;
      }
      if (source._count.contentChunks > 0) {
        // A source with passages is not an empty sub-section row; something
        // about the diagnosis does not hold for it.
        console.log(
          `  BLOCKED  [${track}] "${rule.from}" has ${source._count.contentChunks} passages — not an empty row`,
        );
        blocked++;
        continue;
      }
      if (source._count.questions === 0) continue;

      console.log(
        `  [${track}] ${source._count.questions} question(s)  "${rule.from}"` +
          `\n           -> "${rule.to}" (${target._count.contentChunks} passages)` +
          `\n           ${rule.evidence}`,
      );
      moved += source._count.questions;

      if (APPLY) {
        // The receipt is written BEFORE the move, and holds the question ids
        // with the chapter each came off. A chapterId update overwrites the
        // only record of where a question used to be filed, so without this
        // the move is irreversible — and "37 questions, Life Sciences" is not
        // enough to put them back if the mapping turns out to be wrong.
        const ids = await db.question.findMany({
          where: { chapterId: source.id },
          select: { id: true },
        });
        receipt.push({
          track,
          from: rule.from,
          to: rule.to,
          fromChapterId: source.id,
          toChapterId: target.id,
          questionIds: ids.map((q) => q.id),
        });
        await writeFile(RECEIPT, JSON.stringify(receipt, null, 2), 'utf8');

        await db.question.updateMany({
          where: { chapterId: source.id },
          data: { chapterId: target.id },
        });
      }
    }
  }

  console.log(
    `\n${moved} question(s) ${APPLY ? 'moved' : 'would move'}` +
      (blocked ? `, ${blocked} rule(s) blocked` : ''),
  );
  if (!APPLY && moved) console.log('Nothing changed. Re-run with --apply.');
  if (APPLY && moved) {
    console.log(`receipt: ${RECEIPT}`);
    console.log('Now run: npm run prune:chapters -- --apply');
  }
  await db.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
