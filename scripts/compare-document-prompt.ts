import { z } from 'zod';

import { ai } from '@/lib/ai';
import { db } from '@/lib/db';
import { costMicros } from '@/lib/ai/budget';
import { systemPrompt } from '@/lib/chat';
import { retrieveGrounding } from '@/lib/retrieval';

/**
 * Does telling the tutor how a Lebanese document question is MARKED change what
 * it answers?
 *
 *   npm run compare:document-prompt
 *   npm run compare:document-prompt -- --questions 8
 *
 * WHERE THE CANDIDATE PROMPT CAME FROM. Not from an opinion about Arabic
 * teaching. From the barèmes in this corpus: across تربية وطنية the marking
 * scheme repeatedly scores one move on its own line —
 *
 *   قدّم كلاً من المستندات: نوعه، مصدره وحدّد المسألة التي يتناولها
 *   present each document: its TYPE, its SOURCE, and the ISSUE it addresses
 *
 * — 35 questions score type and source explicitly. And the shape is not rare:
 * 141 of 163 جغرافيا questions and 105 of 155 تربية وطنية questions are asked
 * about documents printed on the paper. Nothing in `systemPrompt` mentions any
 * of it, so the tutor can write a good answer about the content and drop the
 * marks awarded for presenting the document.
 *
 * THE SCORE IS THE EXAMINER'S, NOT A TASTE JUDGEMENT. Each answer is checked
 * against the question's own barème, criterion by criterion — the rubric a
 * Lebanese marker uses. That is far better ground truth than asking a model
 * which answer it prefers, which rewards length. Both arms are scored by the
 * same judge on the same criteria, and the judge never learns which prompt
 * produced which answer.
 *
 * WHAT IT CANNOT SETTLE. Whether the answers are correct. The barème says which
 * things a marker looks for; a criterion can be addressed badly and still count
 * here. Coverage is a necessary condition for marks, not a sufficient one.
 *
 * Nothing is written to the database.
 */

const CANDIDATE = [
  '',
  'This question is asked about documents printed on the exam paper, and a Lebanese marking scheme',
  'scores the PRESENTATION of each document separately from the analysis of it. Before using a',
  'document, name three things about it: its type (نوعه), its source (مصدره), and the issue it',
  'addresses (المسألة التي يتناولها). Each carries marks of its own, so an answer that goes straight',
  'to the content loses them however good the content is. Take all three from the document itself —',
  'if it does not say who wrote it or when, say that rather than supplying a plausible source.',
].join('\n');

const SPLIT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['requirements'],
  properties: {
    requirements: { type: 'array', items: { type: 'string' } },
  },
} as const;

const splitSchema = z.object({ requirements: z.array(z.string()) });

const COVERAGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['covered'],
  properties: {
    covered: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['criterion', 'addressed'],
        properties: {
          criterion: { type: 'string' },
          addressed: { type: 'boolean' },
        },
      },
    },
  },
} as const;

const coverageSchema = z.object({
  covered: z.array(z.object({ criterion: z.string(), addressed: z.boolean() })),
});

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function spentSince(mark: Date): Promise<number> {
  const rows = await db.aiUsage.findMany({
    where: { createdAt: { gt: mark } },
    select: { model: true, inputTokens: true, cachedInputTokens: true, outputTokens: true },
  });
  return (
    Number(
      rows.reduce(
        (sum, r) =>
          sum +
          costMicros({
            model: r.model,
            inputTokens: r.inputTokens,
            cachedInputTokens: r.cachedInputTokens,
            outputTokens: r.outputTokens,
          }),
        0n,
      ),
    ) / 1_000_000
  );
}

/**
 * The separately-marked requirements in a scheme, enumerated ONCE.
 *
 * WHY THIS IS ITS OWN STEP. The first version of this script split the scheme
 * and judged the answer in a single call, on the reasoning that both arms saw
 * the same scheme text so any flaw in the split would apply equally to each.
 * That was wrong, and the run proved it: the judge returned 18 requirements for
 * one arm and 11 for the other on the SAME question, because it re-splits every
 * time and what it sees in the answer colours how it reads the scheme. Two arms
 * scored against different rubrics compare nothing.
 *
 * Split once, reuse for every arm. The split may still be imperfect — these
 * schemes are OCR'd and were never separated by the extractor — but it is now
 * imperfect IDENTICALLY, which is all the comparison needs.
 */
async function splitScheme(questionText: string, scheme: string): Promise<string[]> {
  const response = await ai().completeJson({
    system: [
      'You are reading an official Lebanese Baccalaureate marking scheme.',
      '',
      'It is one block of text containing several separately-marked requirements, usually numbered',
      '(1، 2، 3) and lettered (أ، ب، ج), each with its own marks in brackets.',
      '',
      'List those requirements, one entry per separately-marked thing the candidate must do. Quote',
      'each briefly. Do not judge anything and do not add requirements the scheme does not state.',
    ].join('\n'),
    messages: [
      {
        role: 'user',
        content: `# Question\n${questionText.slice(0, 2500)}\n\n# Marking scheme\n${scheme.slice(0, 4000)}`,
      },
    ],
    schema: SPLIT_SCHEMA as unknown as Record<string, unknown>,
    schemaName: 'scheme_requirements',
    effort: 'low',
    model: ai().fastModel,
    parse: (value) => splitSchema.parse(value),
  });
  return response.data.requirements.filter((r) => r.trim().length > 3);
}

/**
 * How many of those requirements an answer meets.
 *
 * Takes the requirements rather than the scheme, so every arm is measured
 * against one fixed list and the denominators are equal by construction.
 */
async function coverage(
  questionText: string,
  requirements: string[],
  answer: string,
): Promise<{ hit: number; of: number }> {
  if (requirements.length === 0) return { hit: 0, of: 0 };

  const response = await ai().completeJson({
    system: [
      'You are checking which requirements of an official marking scheme a tutoring answer meets.',
      '',
      'For each requirement, addressed = true only if the answer actually DOES the thing it asks for.',
      'Mentioning the topic is not doing it. Judge only whether it is addressed — never whether it is',
      'correct, well written or complete.',
      '',
      'Return every requirement you were given, in the order given, and no others.',
    ].join('\n'),
    messages: [
      {
        role: 'user',
        content: [
          `# Question\n${questionText.slice(0, 2500)}`,
          `# Requirements\n${requirements.map((r, i) => `${i + 1}. ${r}`).join('\n')}`,
          `# Answer to check\n${answer.slice(0, 8000)}`,
        ].join('\n\n'),
      },
    ],
    schema: COVERAGE_SCHEMA as unknown as Record<string, unknown>,
    schemaName: 'bareme_coverage',
    effort: 'low',
    model: ai().fastModel,
    parse: (value) => coverageSchema.parse(value),
  });

  // Denominator is the fixed list, never what came back — a judge that drops or
  // invents an entry must not be able to move the score.
  const covered = response.data.covered.slice(0, requirements.length);
  return { hit: covered.filter((c) => c.addressed).length, of: requirements.length };
}

async function main() {
  const wanted = Number(arg('questions') ?? '6');

  /*
   * A HARD CEILING, CHECKED AFTER EVERY ANSWER.
   *
   * The first run of this script was estimated at $0.20 a question and cost
   * $0.99 before it was killed by hand. The estimate came from a tutor question;
   * these are Lebanese document questions, where the candidate must present
   * three documents, extract from each and discuss — so at high effort the
   * model reasons at length and then writes at length. Output was 29,242 tokens
   * against 17,653 in, and output is priced six times higher.
   *
   * An estimate made before the work is a guess about a distribution nobody has
   * seen. A ceiling checked against the meter is a fact. This aborts mid-run and
   * reports what it has, which is always better than a bill nobody authorised.
   */
  const maxUsd = Number(arg('max-usd') ?? '0.80');

  /*
   * Effort, because it is the whole cost here and it is not obviously worth it.
   * The summary comparison measured `medium` at 64% fewer output tokens than
   * `high` on the same chapter. What that costs in answer quality is the thing
   * this script is measuring, so it is a flag rather than a decision.
   */
  const effort = (arg('effort') ?? 'high') as 'low' | 'medium' | 'high';

  const rows = await db.$queryRaw<
    { id: string; text: string; bareme: unknown; subjectId: string; subject: string }[]
  >`
    SELECT q.id::text, q.content_text AS text, q.bareme,
           s.id::text AS "subjectId", s.name AS subject
      FROM questions q
      JOIN chapters c ON c.id = q.chapter_id
      JOIN subjects s ON s.id = c.subject_id
     WHERE s.language = 'ar'
       AND q.verified_status <> 'rejected'
       AND q.content_text ~ 'المستند|المستندات|الوثيقة'
       AND q.bareme IS NOT NULL
       -- Length of the SCHEME TEXT, not the number of criteria. Every one of
       -- these stores a single criterion holding the whole scheme; requiring
       -- two or more matched nothing at all. A short blob is a scheme with
       -- nothing in it to cover.
       AND length(q.bareme->0->>'criterion') > 150
       AND length(q.content_text) BETWEEN 200 AND 6000
     ORDER BY md5(q.id::text)
     LIMIT ${wanted}`;

  if (rows.length === 0) {
    console.log('  no document question with a usable barème found');
    await db.$disconnect();
    return;
  }

  console.log(
    `\n  ${rows.length} document question(s) at effort=${effort}, ceiling $${maxUsd.toFixed(2)}\n`,
  );
  console.log('  ' + 'question'.padEnd(34) + 'as shipped'.padStart(12) + 'with block'.padStart(12));

  let baseHit = 0;
  let candHit = 0;
  let total = 0;
  let spend = 0;

  for (const row of rows) {
    const bareme = (row.bareme as { criterion: string }[]).filter(
      (b) => typeof b?.criterion === 'string' && b.criterion.trim().length > 5,
    );
    if (bareme.length === 0) continue;

    const grounding = await retrieveGrounding({
      query: row.text,
      subjectIds: [row.subjectId],
      userId: '00000000-0000-0000-0000-000000000000',
    });
    if (grounding.context.trim().length === 0) {
      console.log(`  ${row.subject.padEnd(32)}  refused — no grounding, skipped`);
      continue;
    }

    // One split, before either arm runs. See splitScheme.
    const requirements = await splitScheme(row.text, bareme.map((b) => b.criterion).join('\n'));
    if (requirements.length < 2) {
      console.log(`  ${row.subject.padEnd(32)}  scheme did not split, skipped`);
      continue;
    }

    const base = systemPrompt(grounding.tier, grounding.classification, 'ar');
    const arms = [
      { key: 'base', system: base },
      { key: 'cand', system: base + CANDIDATE },
    ];

    const scores: Record<string, { hit: number; of: number }> = {};
    for (const arm of arms) {
      const mark = new Date();
      const answer = await ai().complete({
        system: arm.system,
        messages: [
          {
            role: 'user',
            content: [
              '# Course material you may use',
              grounding.context,
              '',
              '# Student question',
              row.text,
            ].join('\n'),
          },
        ],
        effort,
      });
      scores[arm.key] = await coverage(row.text, requirements, answer.text);
      await new Promise((r) => setTimeout(r, 1200));
      spend += await spentSince(mark);

      if (spend >= maxUsd) {
        console.log(
          `\n  STOPPED at $${spend.toFixed(4)}, ceiling $${maxUsd.toFixed(2)}. ` +
            `Partial results above. Raise --max-usd deliberately, never by default.`,
        );
        await db.$disconnect();
        return;
      }
    }

    const b = scores.base!;
    const c = scores.cand!;
    baseHit += b.hit;
    candHit += c.hit;
    // Equal by construction now — both arms were scored against `requirements`.
    // The previous version added only the base arm's count and divided BOTH by
    // it, which reported the candidate arm as 19/50 when its own denominator
    // was 41.
    total += b.of;

    const label = `${row.subject} (${b.of} parts)`;
    console.log(
      '  ' +
        label.padEnd(34) +
        `${b.hit}/${b.of}`.padStart(12) +
        `${c.hit}/${c.of}`.padStart(12) +
        (c.hit > b.hit ? '  ↑' : c.hit < b.hit ? '  ↓' : ''),
    );
  }

  if (total === 0) {
    console.log('\n  nothing scorable\n');
  } else {
    console.log('\n  ' + 'barème criteria addressed'.padEnd(34) +
      `${baseHit}/${total}`.padStart(12) + `${candHit}/${total}`.padStart(12));
    console.log('  ' + ''.padEnd(34) +
      `${Math.round((100 * baseHit) / total)}%`.padStart(12) +
      `${Math.round((100 * candHit) / total)}%`.padStart(12));
  }
  console.log(`\n  spent $${spend.toFixed(4)}. Nothing was written.\n`);

  await db.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
