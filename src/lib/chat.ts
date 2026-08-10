import 'server-only';

import type { GroundingTier } from '@prisma/client';

import { ai } from '@/lib/ai';
import { db } from '@/lib/db';
import type { Locale } from '@/lib/i18n/config';
import { retrieveGrounding, type GroundingResult, type RetrievalSource } from '@/lib/retrieval';
import { verifyAgainstContext } from '@/lib/verification';

/**
 * The grounded chat pipeline: retrieve → generate → verify → persist.
 *
 * Every assistant turn records the tier it was grounded on, the sources it
 * cited, and the similarity that triggered that tier. That logging is not
 * telemetry-for-later — it is how the 0.85 / 0.72 thresholds get tuned against
 * real student questions instead of guessed at, and how a wrong answer can be
 * traced back to the material that produced it.
 *
 * The order matters and is not negotiable: nothing is generated before
 * retrieval has decided what may be said. There is no path through this module
 * where the model answers from its own knowledge.
 */

export type ChatEvent =
  | { type: 'meta'; tier: GroundingTier; sources: CitedSource[]; topSimilarity: number | null }
  | { type: 'delta'; text: string }
  | { type: 'done'; messageId: string; verified: boolean }
  | { type: 'retracted'; messageId: string; reason: string }
  | { type: 'error'; message: string };

export type CitedSource = {
  id: string;
  kind: RetrievalSource['kind'];
  label: string;
  similarity: number;
};

const LANGUAGE_NAME: Record<Locale, string> = { fr: 'French', en: 'English', ar: 'Arabic' };

/** What the student is told when nothing cleared threshold. Never a guess. */
export const REFUSAL_TEXT: Record<Locale, string> = {
  fr:
    "Ce point n'est pas couvert par le matériel disponible pour ta filière, donc je ne vais pas deviner. " +
    'Essaie de reformuler ta question, ou demande à ton enseignant.',
  en:
    "This isn't covered by the material available for your track, so I won't guess at it. " +
    'Try rephrasing your question, or ask your teacher.',
  ar:
    'هذا الموضوع غير مشمول بالمواد المتاحة لفرعك، لذلك لن أخمّن الإجابة. ' +
    'حاول إعادة صياغة سؤالك، أو اسأل أستاذك.',
};

const RETRACTION_TEXT: Record<Locale, string> = {
  fr:
    "J'ai commencé une réponse que je n'ai pas pu vérifier par rapport au programme. Je préfère la retirer " +
    "plutôt que de te laisser réviser sur quelque chose d'incertain. Reformule ta question, ou demande à ton enseignant.",
  en:
    "I started an answer I could not verify against the curriculum. I would rather withdraw it than leave you " +
    'revising from something uncertain. Try rephrasing, or ask your teacher.',
  ar:
    'بدأت إجابة لم أتمكن من التحقق منها مقابل المنهج. أفضّل سحبها بدلاً من أن تراجع على معلومة غير مؤكدة. ' +
    'أعد صياغة سؤالك، أو اسأل أستاذك.',
};

function systemPrompt(tier: GroundingTier, locale: Locale): string {
  const common = [
    'You are a tutor for the Lebanese Baccalaureate. You are talking to a student preparing for a national exam.',
    '',
    `Write in ${LANGUAGE_NAME[locale]}. Use the notation and vocabulary of the Lebanese programme.`,
    'Mathematics in LaTeX: $...$ inline, $$...$$ displayed.',
    '',
    'Hard rules:',
    '- Answer ONLY from the material given below. It is the entire basis you are permitted to use.',
    '- If the material does not cover part of what was asked, say which part it does not cover. Do not fill',
    '  the gap from general knowledge, however confident you are.',
    '- Do not invent formulas, constants, theorem names, or exam conventions.',
    '',
    'How to teach:',
    '- Work through the method step by step. The student needs to be able to reproduce it alone, under time',
    '  pressure, on a different question.',
    '- Say why each step is taken, not only what it is.',
    '- Be direct and warm. No filler, no flattery, no "great question".',
  ];

  const perTier: Record<GroundingTier, string[]> = {
    exact_match: [
      '',
      'The material below is an official question and its official solution. Explain that solution — how it',
      'works and why — rather than producing a different one. If the student asks about a specific step, focus',
      'there.',
    ],
    concept_level: [
      '',
      'The material below is course content: definitions, formulas, methods and worked examples. Build your',
      'answer from it. You may apply a method from the material to the student\'s specific numbers; you may not',
      'introduce a method that is not there.',
    ],
    personal_reference: [
      '',
      'The material below comes from a document the student uploaded themselves. Open by saying that this is',
      'based on their own uploaded material, because it has not been checked against the official programme',
      'the way the rest of the corpus has.',
    ],
    ungrounded_refused: [],
  };

  return [...common, ...perTier[tier]].join('\n');
}

/**
 * Added when the conversation is anchored to a marked attempt.
 *
 * This is the difference between a tutor and a solutions manual. The student
 * already has the official solution in front of them — what they cannot get
 * from it is which line of their own working stopped earning marks, and why the
 * barème did not award the point they thought they had made.
 */
const CORRECTION_KEY_PROMPT = [
  '',
  'The student has already attempted this question and it has been marked. Their working and the marks it',
  'earned are given below, under "Student attempt".',
  '',
  'Teach against that attempt:',
  '- Find the first place their working diverges from the official solution, and start there. Everything before',
  '  it was right, and saying so is not flattery — it tells them how much of their method to keep.',
  '- Tie each lost mark to the barème criterion that was not met, and say what the examiner needed to see.',
  '- Where their approach differs from the official one but is still valid, say so rather than marking it wrong.',
  '- Do not simply restate the official solution end to end. They can already read it.',
  '',
  'Their working is the object of discussion, not a source. Never treat a claim in it as established fact.',
].join('\n');

export type ChatTurnInput = {
  userId: string;
  sessionId: string;
  question: string;
  /** Subject scope, derived server-side from the student's locked track. */
  subjectIds: string[];
  locale: Locale;
  /** Prior turns in this conversation, oldest first. */
  history: { role: 'user' | 'assistant'; content: string }[];
  anchorQuestion?: { id: string; contentText: string; officialSolution: string | null } | null;
  /** The student's own marked attempt at the anchor question, when there is one. */
  anchorAttempt?: AnchorAttempt | null;
};

export type AnchorAttempt = {
  submittedAnswer: string | null;
  score: number | null;
  maxScore: number | null;
  /** The barème the answer was marked against, criterion by criterion. */
  bareme: { criterion: string; points: number }[];
};

/** The student's work, formatted for the model. Never a source of fact. */
function formatAttempt(attempt: AnchorAttempt): string {
  const parts = ['# Student attempt'];

  parts.push(
    attempt.submittedAnswer?.trim()
      ? `## What the student wrote\n${attempt.submittedAnswer}`
      : '## What the student wrote\n(They submitted nothing.)',
  );

  if (attempt.score !== null && attempt.maxScore !== null) {
    parts.push(`## Mark awarded\n${attempt.score} out of ${attempt.maxScore}`);
  }

  if (attempt.bareme.length > 0) {
    const criteria = attempt.bareme
      .map((item) => `- ${item.criterion} (${item.points} point(s))`)
      .join('\n');
    parts.push(`## Correction key (barème)\n${criteria}`);
  }

  return parts.join('\n\n');
}

/**
 * Runs one turn and yields events as they happen.
 *
 * The user message is persisted before generation starts, so a conversation is
 * never left with an answer whose question was lost to a crash mid-stream.
 */
export async function* runChatTurn(input: ChatTurnInput): AsyncGenerator<ChatEvent> {
  await db.chatMessage.create({
    data: { sessionId: input.sessionId, role: 'user', content: input.question },
  });
  await db.chatSession.update({
    where: { id: input.sessionId },
    data: { updatedAt: new Date() },
  });

  let grounding: GroundingResult;
  try {
    grounding = await retrieveGrounding({
      query: input.question,
      subjectIds: input.subjectIds,
      userId: input.userId,
      anchorQuestion: input.anchorQuestion ?? null,
    });
  } catch (err) {
    console.error('[chat] retrieval failed', err);
    yield { type: 'error', message: 'Retrieval failed.' };
    return;
  }

  const sources: CitedSource[] = grounding.sources.map((s) => ({
    id: s.id,
    kind: s.kind,
    label: s.label,
    similarity: Math.round(s.similarity * 1000) / 1000,
  }));

  yield { type: 'meta', tier: grounding.tier, sources, topSimilarity: grounding.topSimilarity };

  // --- Nothing cleared threshold: refuse, and record the refusal ------------
  if (grounding.tier === 'ungrounded_refused') {
    const text = REFUSAL_TEXT[input.locale];
    yield { type: 'delta', text };

    const message = await persistAssistantMessage({
      sessionId: input.sessionId,
      content: text,
      tier: 'ungrounded_refused',
      citedSourceIds: [],
      topSimilarity: grounding.topSimilarity,
      modelUsed: null,
    });

    yield { type: 'done', messageId: message.id, verified: true };
    return;
  }

  // --- Grounded generation -------------------------------------------------
  const provider = ai();
  const userContent = [
    '# Course material you may use',
    grounding.context,
    ...(input.anchorAttempt ? ['', formatAttempt(input.anchorAttempt)] : []),
    '',
    '# Student question',
    input.question,
  ].join('\n');

  let answer = '';
  let modelUsed: string | null = null;

  try {
    const stream = provider.streamText({
      system:
        systemPrompt(grounding.tier, input.locale) +
        (input.anchorAttempt ? `\n${CORRECTION_KEY_PROMPT}` : ''),
      messages: [...input.history.slice(-8), { role: 'user', content: userContent }],
      effort: 'high',
    });

    let next = await stream.next();
    while (!next.done) {
      answer += next.value;
      yield { type: 'delta', text: next.value };
      next = await stream.next();
    }
    modelUsed = next.value.modelUsed;

    if (next.value.refused || answer.trim().length === 0) {
      throw new Error('The provider returned no usable answer.');
    }
  } catch (err) {
    console.error('[chat] generation failed', err);
    yield { type: 'error', message: 'Generation failed.' };
    return;
  }

  const message = await persistAssistantMessage({
    sessionId: input.sessionId,
    content: answer,
    tier: grounding.tier,
    citedSourceIds: grounding.sources.map((s) => s.id),
    topSimilarity: grounding.topSimilarity,
    modelUsed,
  });

  // --- Verification --------------------------------------------------------
  // Tier 1 restates an official solution; there is nothing more authoritative
  // to check it against. Tiers 2 and 3 synthesized, so they get checked.
  if (!grounding.requiresVerification) {
    yield { type: 'done', messageId: message.id, verified: true };
    return;
  }

  const verdict = await verifyAgainstContext({
    query: input.question,
    answer,
    context: grounding.context,
  });

  if (verdict.supported) {
    yield { type: 'done', messageId: message.id, verified: true };
    return;
  }

  /*
   * The answer failed verification after it was already on screen.
   *
   * Withdrawing it is the only defensible outcome: this student is revising for
   * a national exam, and an unverifiable derivation is worse than no answer.
   * The withdrawn text is kept on the review queue so an administrator can see
   * exactly what the system nearly said, rather than it vanishing.
   */
  await db.chatMessage.update({
    where: { id: message.id },
    data: {
      content: RETRACTION_TEXT[input.locale],
      groundingTier: 'ungrounded_refused',
    },
  });

  await db.reviewQueueItem.create({
    data: {
      itemType: 'flagged_content',
      itemId: message.id,
      flagReason:
        `Verification failed (${verdict.severity}): ${verdict.notes}` +
        (verdict.issues.length > 0 ? `\n- ${verdict.issues.join('\n- ')}` : '') +
        `\n\nWithdrawn answer:\n${answer.slice(0, 4000)}`,
      flaggedByUserId: null,
    },
  });

  yield { type: 'retracted', messageId: message.id, reason: RETRACTION_TEXT[input.locale] };
}

async function persistAssistantMessage(input: {
  sessionId: string;
  content: string;
  tier: GroundingTier;
  citedSourceIds: string[];
  topSimilarity: number | null;
  modelUsed: string | null;
}) {
  return db.chatMessage.create({
    data: {
      sessionId: input.sessionId,
      role: 'assistant',
      content: input.content,
      groundingTier: input.tier,
      citedSourceIds: input.citedSourceIds,
      topSimilarity: input.topSimilarity,
      modelUsed: input.modelUsed,
    },
    select: { id: true },
  });
}

/** Newline-delimited JSON. One event per line; the client splits on `\n`. */
export function encodeEvent(event: ChatEvent): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(event)}\n`);
}

/** First user message, trimmed, as the conversation's title in the sidebar list. */
export function titleFromQuestion(question: string): string {
  const cleaned = question.replace(/\s+/g, ' ').trim();
  return cleaned.length <= 70 ? cleaned : `${cleaned.slice(0, 67)}…`;
}
