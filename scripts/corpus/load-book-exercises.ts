/**
 * corpus/book-exercises/<book>.json -> questions (source_type 'textbook').
 *
 *   npm run corpus:book-exercises -- --dry                 plan only, writes nothing
 *   npm run corpus:book-exercises                          every book on disk
 *   npm run corpus:book-exercises -- --book math-er__9de6de98
 *
 * Reads what scripts/corpus/extract_book_exercises.py pulled out of the
 * textbooks' exercise sections. Then run `npm run ingest -- --embed-missing`.
 *
 * WHICH CHAPTER is not a guess here, unlike the exam loader: the exercise is
 * printed at the end of the chapter it belongs to, and the taxonomy says which
 * chapter owns the page. It is matched to the database by name, the same way
 * load-chunks.ts places that chapter's passages.
 *
 * ONE ROW PER TRACK. A book issued to GS and LS gets a copy in each track's
 * chapter, exactly as the exam loader files a paper under each track that sits
 * it. A single row with a link into the other track's chapter would be deleted
 * by `corpus:share-tracks -- --undo`, which removes every link that crosses
 * subjects, and mastery would be credited to the wrong track.
 *
 * THE HOME LINK IS WRITTEN HERE. Practice and quizzes find questions through
 * question_chapters, and neither loader before this one wrote the row for a
 * question's own chapter: 1,200 exam questions were invisible for that reason.
 *
 * NO ANSWER, NO BARÈME. The books print none. Leaving `official_solution` null
 * keeps these out of tier-1 answers, and `source_exam_id` null keeps them out
 * of mock exams and shows them as "not official". Marking falls through to the
 * provisional marker used for exam questions without a scheme.
 *
 * Idempotent: identity is `book:<folder>:ch<n>:<section>:<number>:<track>`.
 * A re-run updates changed text (and clears its embedding), and an exercise no
 * longer in the file, or now held back, is set to `rejected`, never deleted —
 * a student may have answered it.
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { PrismaClient, type Language, type QuestionType } from '@prisma/client';

const db = new PrismaClient();
const ROOT = path.resolve(__dirname, '..', '..');
const DIR = path.join(ROOT, 'corpus', 'book-exercises');
const CATALOG = path.join(ROOT, 'scripts', 'corpus', 'catalog.csv');

type Exercise = {
  sourceRef: string;
  chapterIndex: number;
  chapterTitle: string;
  section: string;
  number: string;
  kind: string;
  text: string;
  pageFrom: number;
  pageTo: number;
  grounding: number;
  held: string[];
};

type Row = Record<string, string>;

// Same parser as load-chunks.ts: the notes column holds quoted commas.
function parseCsv(text: string): Row[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [header, ...body] = rows.filter((r) => r.some((c) => c.trim()));
  if (!header) return [];
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), r[i] ?? ''])));
}

/**
 * There is no true/false type, and the model's "mcq" comes without structured
 * options, which the practice screen would render as a question with no
 * choices. Both are asked as open questions: the student writes the answer.
 */
function questionType(kind: string): QuestionType {
  return kind === 'problem' ? 'problem' : 'open';
}

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry');
  const only = args.includes('--book') ? args[args.indexOf('--book') + 1] : null;

  const catalog = new Map(parseCsv(await readFile(CATALOG, 'utf8')).map((r) => [r.folder, r]));
  const files = (await readdir(DIR)).filter((f) => f.endsWith('.json') && f.includes('__'));

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let retired = 0;
  let linked = 0;
  let held = 0;
  const problems: string[] = [];

  for (const file of files) {
    const folder = file.replace(/\.json$/, '');
    if (only && folder !== only) continue;
    const row = catalog.get(folder);
    if (!row) {
      problems.push(`${folder}: not in catalog.csv`);
      continue;
    }
    const { exercises } = JSON.parse(await readFile(path.join(DIR, file), 'utf8')) as { exercises: Exercise[] };
    const loadable = exercises.filter((e) => e.held.length === 0);
    held += exercises.length - loadable.length;

    const doc = await db.sourceDocument.findUnique({ where: { bookKey: folder }, select: { id: true } });
    const keep = new Set<string>();

    for (const code of (row.tracks ?? '').split(';').map((t) => t.trim()).filter(Boolean)) {
      const subject = await db.subject.findFirst({
        where: { track: { code }, name: row.subject, language: row.language as Language },
        select: { id: true },
      });
      if (!subject) {
        problems.push(`${folder}: no ${code} subject named ${row.subject}`);
        continue;
      }
      const chapters = await db.chapter.findMany({ where: { subjectId: subject.id }, select: { id: true, name: true } });
      const byName = new Map(chapters.map((c) => [c.name.trim(), c.id]));
      const order = new Map<number, number>();

      for (const ex of loadable) {
        // The seeder drops a trailing "(*)" footnote marker; load-chunks does the same.
        const title = ex.chapterTitle.trim();
        const chapterId = byName.get(title) ?? byName.get(title.replace(/\s*\(\s*\*\s*\)\s*$/, '').trim());
        if (!chapterId) {
          problems.push(`${folder} ${code}: no chapter named "${title.slice(0, 50)}"`);
          continue;
        }
        const sourceRef = `${ex.sourceRef}:${code}`;
        keep.add(sourceRef);
        const orderIndex = order.get(ex.chapterIndex) ?? 0;
        order.set(ex.chapterIndex, orderIndex + 1);

        const data = {
          chapterId,
          questionType: questionType(ex.kind),
          contentText: ex.text,
          contentLatex: ex.text,
          sourcePageFrom: ex.pageFrom,
          sourcePageTo: ex.pageTo,
          sourceDocumentId: doc?.id ?? null,
          orderIndex,
        };

        const existing = await db.question.findUnique({
          where: { sourceRef },
          select: { id: true, contentText: true, chapterId: true, verifiedStatus: true },
        });
        if (dry) {
          if (!existing) created += 1;
          else if (existing.contentText !== ex.text || existing.chapterId !== chapterId) updated += 1;
          else unchanged += 1;
          continue;
        }

        let id: string;
        if (!existing) {
          const q = await db.question.create({
            data: { ...data, sourceType: 'textbook', sourceRef, verifiedStatus: 'unverified' },
            select: { id: true },
          });
          id = q.id;
          created += 1;
        } else {
          id = existing.id;
          const changed = existing.contentText !== ex.text || existing.chapterId !== chapterId;
          if (changed || existing.verifiedStatus === 'rejected') {
            await db.question.update({
              where: { id },
              data: {
                ...data,
                verifiedStatus: existing.verifiedStatus === 'rejected' ? 'unverified' : existing.verifiedStatus,
              },
            });
            // New text means the old vector describes something else.
            if (changed) await db.$executeRaw`UPDATE questions SET embedding = NULL WHERE id = ${id}::uuid`;
            updated += 1;
          } else unchanged += 1;
        }

        linked += await db.$executeRaw`
          INSERT INTO question_chapters (question_id, chapter_id)
          VALUES (${id}::uuid, ${chapterId}::uuid)
          ON CONFLICT DO NOTHING`;
      }
    }

    // Anything this book loaded before that is no longer loadable.
    const stale = await db.question.findMany({
      where: { sourceRef: { startsWith: `book:${folder}:` }, verifiedStatus: { not: 'rejected' } },
      select: { id: true, sourceRef: true },
    });
    const gone = stale.filter((q) => !keep.has(q.sourceRef ?? ''));
    retired += gone.length;
    if (!dry && gone.length) {
      await db.question.updateMany({ where: { id: { in: gone.map((q) => q.id) } }, data: { verifiedStatus: 'rejected' } });
    }
    console.log(`  ${folder}: ${loadable.length} loadable x ${(row.tracks ?? '').split(';').length} track(s), ${exercises.length - loadable.length} held`);
  }

  console.log('');
  console.log(`  created    ${created}`);
  console.log(`  updated    ${updated}`);
  console.log(`  unchanged  ${unchanged}`);
  console.log(`  retired    ${retired}`);
  console.log(`  held back  ${held} (figures, fragments, ungrounded: not loaded)`);
  console.log(`  home links written  ${linked}`);
  for (const p of [...new Set(problems)]) console.log(`  PROBLEM  ${p}`);
  if (dry) console.log('\n  --dry: nothing written.');
  else console.log('\n  next: npm run ingest -- --embed-missing');

  await db.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await db.$disconnect();
  process.exit(1);
});
