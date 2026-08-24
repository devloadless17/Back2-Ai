/**
 * Hand-label a sample of past-exam questions with the chapter they belong to.
 *
 *   npm run label:chapters -- --subject Chemistry --track GS --count 20
 *   npm run label:chapters -- --report
 *
 * Every number this project has about retrieval quality is partly self-graded,
 * and it is worth being precise about how. A past-exam question was filed to
 * its chapter by the loader, using the nearest course passage by embedding. The
 * benchmark then asks "does retrieval find that chapter?" — with the same
 * embedding. A perfect score would prove the model agrees with itself, which it
 * would, and which is not the question anyone is asking.
 *
 * 38 of 5,254 questions carry a human judgement. Until that number is in the
 * hundreds there is no measurement of this system that is not partly circular,
 * and no way to tell whether GS Chemistry scoring 0.37 against GS Chimie's 0.74
 * is a retrieval failure or a bookkeeping one.
 *
 * This does the half a machine can do: pick the questions where a label buys
 * the most, put the candidates in front of a person in the order the model
 * ranks them, and record what the person says — including "none of these",
 * which is the answer that actually matters and the one an automated pass can
 * never give.
 *
 * It does NOT guess. A question nobody has looked at stays `unverified`. The
 * whole value of these rows is that a human chose them, and a file of confident
 * machine labels would destroy the only uncontaminated measurement available
 * while looking exactly like progress.
 */

import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

import { db } from '@/lib/db';
import { embed } from '@/lib/ai/embeddings';

/** How many candidate chapters to offer. Beyond this it is a list, not a choice. */
const CANDIDATES = 6;

type Candidate = { id: string; name: string; similarity: number };

async function candidatesFor(questionText: string, subjectId: string): Promise<Candidate[]> {
  const vector = await embed(questionText.slice(0, 4000), 'query');
  return db.$queryRaw<Candidate[]>`
    SELECT ch.id, ch.name, max(1 - (cc.embedding <=> ${`[${vector.join(',')}]`}::vector)) AS similarity
    FROM content_chunks cc
    JOIN chapter_content_chunks l ON l.chunk_id = cc.id
    JOIN chapters ch ON ch.id = l.chapter_id
    WHERE ch.subject_id = ${subjectId}::uuid AND cc.embedding IS NOT NULL
    GROUP BY ch.id, ch.name
    ORDER BY similarity DESC
    LIMIT ${CANDIDATES}
  `;
}

async function report(): Promise<void> {
  const rows = await db.$queryRaw<
    { subject: string; verified: bigint; total: bigint; agreed: bigint }[]
  >`
    SELECT s.name AS subject,
           count(*) FILTER (WHERE q.verified_status = 'verified') AS verified,
           count(*) AS total,
           count(*) FILTER (WHERE q.verified_status = 'verified') AS agreed
    FROM questions q
    JOIN chapters c ON c.id = q.chapter_id
    JOIN subjects s ON s.id = c.subject_id
    WHERE q.source_type = 'past_exam'
    GROUP BY s.name
    HAVING count(*) FILTER (WHERE q.verified_status = 'verified') > 0
    ORDER BY 2 DESC
  `;

  const [totals] = await db.$queryRaw<{ verified: bigint; total: bigint }[]>`
    SELECT count(*) FILTER (WHERE verified_status = 'verified') AS verified, count(*) AS total
    FROM questions WHERE source_type = 'past_exam'
  `;

  console.log('\nHUMAN-LABELLED CHAPTERS — the only non-circular ground truth there is\n');
  for (const row of rows) {
    console.log(`  ${row.subject.padEnd(24)}${Number(row.verified)} of ${Number(row.total)}`);
  }
  const verified = Number(totals?.verified ?? 0);
  const total = Number(totals?.total ?? 0);
  console.log(`\n  ${verified} of ${total} past-exam questions carry a human judgement.`);
  if (verified < 100) {
    console.log('  Below about a hundred there is not enough to measure against. Every');
    console.log('  retrieval number in this repo is still partly the embedding grading itself.');
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--report')) return report();

  const subjectName = args.includes('--subject') ? args[args.indexOf('--subject') + 1] : null;
  /*
   * The track is optional here and not optional in practice.
   *
   * "Chemistry" is four subject rows, one per track, and they are not the same
   * subject: GS and LS share a 393-page book, while LH and SE share a different
   * 193-page one whose chapters are food and medicinal chemistry. Without this
   * filter a session labelling "Chemistry" silently mixes them, and the
   * questions judged are not the questions meant — which is what happened the
   * first time this was used.
   */
  const track = args.includes('--track') ? args[args.indexOf('--track') + 1] : null;
  const count = args.includes('--count') ? Number(args[args.indexOf('--count') + 1]) : 20;

  if (!subjectName) {
    console.log('Usage: npm run label:chapters -- --subject Chemistry --track GS [--count 20]');
    console.log('  --track matters: "Chemistry" is four subjects on four tracks,');
    console.log('  and GS/LS use a different book from LH/SE.');
    console.log('       npm run label:chapters -- --report');
    return;
  }

  /*
   * Unverified questions, fewest-labelled subject first, and never one already
   * judged: re-asking a question somebody has answered wastes the only
   * expensive input this process has, which is a person's attention.
   */
  const questions = await db.$queryRaw<
    { id: string; content_text: string; subject_id: string; chapter_id: string; chapter: string }[]
  >`
    SELECT q.id, q.content_text, c.subject_id, q.chapter_id, c.name AS chapter
    FROM questions q
    JOIN chapters c ON c.id = q.chapter_id
    JOIN subjects s ON s.id = c.subject_id
    JOIN tracks t ON t.id = s.track_id
    WHERE s.name = ${subjectName}
      AND (${track}::text IS NULL OR t.code = ${track})
      AND q.source_type = 'past_exam'
      AND q.verified_status = 'unverified'
    ORDER BY random()
    LIMIT ${count}
  `;

  if (questions.length === 0) {
    console.log(`Nothing left unverified in ${subjectName}.`);
    return;
  }

  const rl = createInterface({ input: stdin, output: stdout });
  let labelled = 0;
  let moved = 0;
  /** Rows that were not questions and have been taken out of circulation. */
  let rejected = 0;

  console.log(`\n${questions.length} question(s) from ${subjectName}${track ? ` (${track})` : ' — ALL TRACKS'}.`);
  if (!track) console.log('No --track given: this may mix tracks that use different books.');
  console.log('For each: the number of the correct chapter, "n" if the right one is');
  console.log('not listed (you then pick from the full list), "x" if it is not a');
  console.log('question at all (a marking scheme, a page of answers),');
  console.log('"s" to skip, "q" to stop.\n');

  for (const [index, question] of questions.entries()) {
    const candidates = await candidatesFor(question.content_text, question.subject_id);

    console.log('─'.repeat(72));
    console.log(`(${index + 1}/${questions.length})  ${question.content_text.replace(/\s+/g, ' ').slice(0, 600)}`);
    console.log(`\n  currently filed under: ${question.chapter}\n`);
    candidates.forEach((c, i) => {
      const here = c.id === question.chapter_id ? '  <- current' : '';
      console.log(`    ${i + 1}. ${c.name.slice(0, 52).padEnd(54)}${c.similarity.toFixed(3)}${here}`);
    });

    const answer = (await rl.question('\n  chapter? ')).trim().toLowerCase();
    if (answer === 'q') break;
    if (answer === 's' || answer === '') continue;

    /*
     * "x" — this is not a question at all.
     *
     * The option was missing and a labelling session ran straight into the gap:
     * a GS Chemistry item opened "Expected Answers Comments I- 2- The increase
     * in temperature speeds up the rate of the reaction", which is a marking
     * scheme the splitter failed to cut off. Every answer the tool offered was
     * a chapter and none of them was true, so the only ways out were "skip",
     * which says nothing and hands the same row to the next person, or filing
     * an answer key under a chapter.
     *
     * This is the one case where `rejected` IS the right status, and it is the
     * opposite of the "none of these" branch below: there the question is fine
     * and retrieval missed it, here the row should not be in front of a student
     * at all. Kept distinct for exactly that reason.
     */
    if (answer === 'x') {
      await db.$executeRaw`
        UPDATE questions SET verified_status = 'rejected' WHERE id = ${question.id}::uuid
      `;
      rejected += 1;
      console.log('  retired - not a question. It will not be shown to anyone.');
      continue;
    }

    /*
     * "None of these" means the right chapter was not in the model's top six.
     *
     * That is a statement about RETRIEVAL, not about the question, and the
     * first version of this conflated them: it marked the question `rejected`,
     * which is how this codebase says "this question is unusable" — retrieval,
     * practice and exam composition all skip those. Answering "the model missed
     * it" would have quietly removed a perfectly good question from a student's
     * bank. Caught while somebody was using it, one keystroke away.
     *
     * So the whole chapter list is offered instead, and the question is filed
     * where it belongs. Nothing extra needs recording: once a human has said
     * which chapter is right, "was it in the model's top six" is computable
     * from that label whenever anyone wants to ask.
     */
    if (answer === 'n') {
      const all = await db.$queryRaw<{ id: string; name: string }[]>`
        SELECT id, name FROM chapters WHERE subject_id = ${question.subject_id}::uuid
        ORDER BY order_index ASC
      `;
      console.log('');
      all.forEach((c, i) => console.log(`    ${String(i + 1).padStart(3)}. ${c.name.slice(0, 60)}`));
      const pick = (await rl.question('\n  which one? ("s" to skip) ')).trim().toLowerCase();
      if (pick === 's' || pick === '') continue;
      const target = all[Number(pick) - 1];
      if (!target) {
        console.log('  not one of the options — skipped.');
        continue;
      }
      await db.$executeRaw`
        UPDATE questions
        SET chapter_id = ${target.id}::uuid, verified_status = 'verified'
        WHERE id = ${question.id}::uuid
      `;
      labelled += 1;
      if (target.id !== question.chapter_id) moved += 1;
      console.log(`  filed under "${target.name}" — the model did not have it in its top ${CANDIDATES}.`);
      continue;
    }

    const chosen = candidates[Number(answer) - 1];
    if (!chosen) {
      console.log('  not one of the options — skipped.');
      continue;
    }

    await db.$executeRaw`
      UPDATE questions
      SET chapter_id = ${chosen.id}::uuid, verified_status = 'verified'
      WHERE id = ${question.id}::uuid
    `;
    labelled += 1;
    if (chosen.id !== question.chapter_id) moved += 1;
  }

  rl.close();
  console.log('\n' + '─'.repeat(72));
  console.log(`${labelled} question(s) judged; ${moved} were filed under the wrong chapter.`);
  if (rejected) {
    console.log(`${rejected} were not questions at all and have been retired.`);
  }
  console.log('Run with --report to see the coverage this has bought.');
}

main()
  .catch((e) => {
    console.error('Labelling failed:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
