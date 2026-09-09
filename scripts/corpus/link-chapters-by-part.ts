import { db } from '../../src/lib/db';
import { embed } from '@/lib/ai/embeddings';

/**
 * Links an exercise to the chapters its individual PARTS belong to.
 *
 *   npm run corpus:link-parts -- --subject تاريخ --dry
 *   npm run corpus:link-parts -- --subject تاريخ
 *
 * `link-chapters.ts` ranks a chapter against the WHOLE exercise, and for a
 * Lebanese history paper that is the wrong unit of comparison. One exercise
 * reads:
 *
 *   أ - عاش لبنان خلال الحرب العالمية الأولى أزمة اقتصادية واجتماعية حادة.
 *       إشرح أسباب هذه الأزمة وبين النتائج التي أسفرت عنها. (أربع علامات)
 *   ب - أوضح كيف أصبح فيصل ملكاً على العراق.
 *
 * Two chapters, one exercise. Part أ is four hundred characters about Lebanon
 * in the First World War; part ب is one line about the Iraqi monarchy. Embedded
 * whole, the exercise is a Lebanon question with a rounding error attached: it
 * scores 0.566 against the Lebanon chapters and 0.602 against the Arab-world
 * ones — the Arab side actually WINS — but both are under the 0.65 floor that
 * `link-chapters` and `check:filing` share, so nothing links and the Iraq
 * chapter never offers the question that is half about it.
 *
 * Lowering that floor was the obvious move and is wrong: it is the floor for
 * the whole corpus, and a weak match is weak because the comparison is bad, not
 * because the threshold is strict. Measured on eight new history chapters, the
 * whole-exercise linker added ONE link, and that one was a marking-scheme
 * fragment rather than a question.
 *
 * So this compares the right thing instead. Each part is embedded on its own
 * and ranked over the same passages, at the SAME floor — no threshold is
 * relaxed anywhere. A part that clears 0.65 against a chapter is evidence that
 * this chapter teaches that part, which is exactly the claim a link makes.
 *
 * WHAT IT WILL NOT DO. It never changes `questions.chapter_id`: the primary
 * filing is the loader's and a part is not grounds to re-home the whole
 * exercise. It never removes a link. It ignores parts under `MIN_PART_CHARS`,
 * because "ب - علّل." carries no topic and would match on grammar alone. And it
 * caps additions per exercise, on the same reasoning as `MAX_LINKS` there: an
 * exercise touching five chapters is an unfiled one, not a cross-topic one.
 */

/** The same floor `link-chapters` and `check:filing` use. Deliberately equal. */
const FLOOR = 0.65;
/** Per exercise, over and above whatever the whole-exercise linker found. */
const MAX_NEW_LINKS = 2;
/**
 * Below this a part is an instruction, not a topic.
 *
 * "ب - علّل." and "ج - اشرح." are complete parts of real exercises and say
 * nothing about which chapter they belong to; embedded, they match whichever
 * chapter happens to phrase its prose most like an imperative.
 */
const MIN_PART_CHARS = 60;

/**
 * Splits an exercise into the parts a Lebanese paper prints.
 *
 * Arabic papers letter their parts أ ب ج د ه and number their questions 1- 2-,
 * and both appear in one exercise: the numbered question carries lettered parts
 * under it. Splitting on either, at a line start or after a newline, is what
 * the extractor's own part rules look for.
 *
 * The first chunk before any marker is kept too — it is the stem, and on a
 * document-based exercise it is where the topic actually is.
 */
export function splitParts(text: string): string[] {
  const marker = /(?:^|\n)\s*(?:[أ-ي]\s*[-–.)]|\d{1,2}\s*[-–.)])\s+/g;
  const cuts: number[] = [];
  for (let m = marker.exec(text); m; m = marker.exec(text)) cuts.push(m.index);
  if (cuts.length === 0) return [];

  const pieces: string[] = [];
  const stem = text.slice(0, cuts[0]!).trim();
  if (stem.length >= MIN_PART_CHARS) pieces.push(stem);
  for (let i = 0; i < cuts.length; i += 1) {
    const piece = text.slice(cuts[i]!, cuts[i + 1] ?? text.length).trim();
    if (piece.length >= MIN_PART_CHARS) pieces.push(piece);
  }
  // One "part" is the whole exercise under another name, and comparing it adds
  // nothing the whole-exercise linker has not already done.
  return pieces.length >= 2 ? pieces : [];
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const subject = arg('--subject');
  const dry = process.argv.includes('--dry');
  const limit = Number(arg('--limit')) || 100_000;

  const questions = subject
    ? await db.$queryRaw<{ id: string; subject_id: string; content_text: string }[]>`
        SELECT q.id, c.subject_id::text AS subject_id, q.content_text
          FROM questions q
          JOIN chapters c ON c.id = q.chapter_id
          JOIN subjects s ON s.id = c.subject_id
         WHERE q.verified_status <> 'rejected' AND s.name = ${subject}
         ORDER BY q.id
         LIMIT ${limit}`
    : await db.$queryRaw<{ id: string; subject_id: string; content_text: string }[]>`
        SELECT q.id, c.subject_id::text AS subject_id, q.content_text
          FROM questions q
          JOIN chapters c ON c.id = q.chapter_id
         WHERE q.verified_status <> 'rejected'
         ORDER BY q.id
         LIMIT ${limit}`;

  console.log(`  exercises considered  ${questions.length}`);

  let withParts = 0;
  let embedded = 0;
  let widened = 0;
  let linked = 0;
  const samples: string[] = [];

  for (const question of questions) {
    const parts = splitParts(question.content_text);
    if (parts.length === 0) continue;
    withParts += 1;

    /** chapter id -> the best score any ONE part reached, and which part. */
    const bestByChapter = new Map<string, { score: number; part: string }>();

    for (const part of parts) {
      const vector = await embed(part.slice(0, 4000), 'query');
      embedded += 1;
      const literal = `[${vector.join(',')}]`;
      const ranked = await db.$queryRaw<{ chapter_id: string; name: string; similarity: number }[]>`
        SELECT c.id::text AS chapter_id, c.name,
               max(1 - (cc.embedding <=> ${literal}::vector)) AS similarity
          FROM chapters c
          JOIN chapter_content_chunks j ON j.chapter_id = c.id
          JOIN content_chunks cc ON cc.id = j.chunk_id
         WHERE c.subject_id = ${question.subject_id}::uuid AND cc.embedding IS NOT NULL
         GROUP BY c.id, c.name
         ORDER BY similarity DESC, c.id
         LIMIT 3`;

      for (const row of ranked) {
        const score = Number(row.similarity);
        if (score < FLOOR) continue;
        const held = bestByChapter.get(row.chapter_id);
        if (!held || score > held.score) {
          bestByChapter.set(row.chapter_id, { score, part: `${row.name} :: ${part.slice(0, 70)}` });
        }
      }
    }

    if (bestByChapter.size === 0) continue;

    // Sorted by score then chapter id — the second key is not decoration. See
    // the note in link-chapters.ts: ties resolved by whatever order Postgres
    // returns produced different links on two copies of the same corpus.
    const candidates = [...bestByChapter.entries()]
      .sort((a, b) => b[1].score - a[1].score || (a[0] < b[0] ? -1 : 1))
      .slice(0, MAX_NEW_LINKS);

    let addedHere = 0;
    for (const [chapterId, { score, part }] of candidates) {
      const already = await db.questionChapter.findUnique({
        where: { questionId_chapterId: { questionId: question.id, chapterId } },
        select: { questionId: true },
      });
      if (already) continue;
      if (!dry) {
        await db.questionChapter.createMany({
          data: [{ questionId: question.id, chapterId, score }],
          skipDuplicates: true,
        });
      }
      linked += 1;
      addedHere += 1;
      if (samples.length < 12) samples.push(`    ${score.toFixed(3)}  ${part.replace(/\s+/g, ' ')}`);
    }
    if (addedHere > 0) widened += 1;
  }

  console.log(`  with 2+ parts         ${withParts}`);
  console.log(`  part embeddings       ${embedded}`);
  console.log(`  exercises widened     ${widened}`);
  console.log(`  links added           ${linked}`);
  if (samples.length) {
    console.log('\n  a sample, to be read rather than trusted:');
    for (const line of samples) console.log(line);
  }
  if (dry) console.log('\n  --dry: nothing written.');
  await db.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
