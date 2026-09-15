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

/** How many of this question's barème criteria the answer addresses. */
async function coverage(
  questionText: string,
  bareme: { criterion: string }[],
  answer: string,
): Promise<{ hit: number; of: number }> {
  const response = await ai().completeJson({
    system: [
      'You are checking which items of an official marking scheme a tutoring answer addresses.',
      '',
      'For each criterion, addressed = true only if the answer actually does the thing the criterion',
      'asks for. Mentioning the topic is not addressing the criterion. Judge only whether it is',
      'addressed, never whether it is correct, well written or complete.',
      '',
      'Return every criterion you were given, in the order given, and no others.',
    ].join('\n'),
    messages: [
      {
        role: 'user',
        content: [
          `# Question\n${questionText.slice(0, 2500)}`,
          `# Marking scheme\n${bareme.map((b, i) => `${i + 1}. ${b.criterion}`).join('\n')}`,
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

  const covered = response.data.covered;
  return { hit: covered.filter((c) => c.addressed).length, of: bareme.length };
}

async function main() {
  const wanted = Number(arg('questions') ?? '6');

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
       AND jsonb_array_length(q.bareme) BETWEEN 2 AND 8
       AND length(q.content_text) BETWEEN 200 AND 4000
     ORDER BY md5(q.id::text)
     LIMIT ${wanted}`;

  if (rows.length === 0) {
    console.log('  no document question with a usable barème found');
    await db.$disconnect();
    return;
  }

  console.log(`\n  ${rows.length} document question(s), scored against their own barème\n`);
  console.log('  ' + 'question'.padEnd(34) + 'as shipped'.padStart(12) + 'with block'.padStart(12));

  let baseHit = 0;
  let candHit = 0;
  let total = 0;
  let spend = 0;

  for (const row of rows) {
    const bareme = (row.bareme as { criterion: string }[]).filter(
      (b) => typeof b?.criterion === 'string' && b.criterion.trim().length > 5,
    );
    if (bareme.length < 2) continue;

    const grounding = await retrieveGrounding({
      query: row.text,
      subjectIds: [row.subjectId],
      userId: '00000000-0000-0000-0000-000000000000',
    });
    if (grounding.context.trim().length === 0) {
      console.log(`  ${row.subject.padEnd(32)}  refused — no grounding, skipped`);
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
        effort: 'high',
      });
      scores[arm.key] = await coverage(row.text, bareme, answer.text);
      await new Promise((r) => setTimeout(r, 1200));
      spend += await spentSince(mark);
    }

    const b = scores.base!;
    const c = scores.cand!;
    baseHit += b.hit;
    candHit += c.hit;
    total += b.of;

    const label = `${row.subject} (${b.of} criteria)`;
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
