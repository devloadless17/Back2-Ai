import 'server-only';

import type { GroundingTier } from '@prisma/client';

import { ai } from '@/lib/ai';
import { db } from '@/lib/db';
import type { Locale } from '@/lib/i18n/config';
import { classifyChatIntent, type IntentClassification } from '@/lib/chat-intent';
import type { QuestionClassification } from '@/lib/question-kind';
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

/**
 * Said when a greeting arrives and the model is unreachable.
 *
 * Deliberately content-free: it must not claim anything about the syllabus,
 * because on this path nothing was checked against it.
 */
const CONVERSATIONAL_FALLBACK: Record<Locale, string> = {
  fr: 'Bonjour ! Pose-moi une question sur ton programme et je la cherche dans tes manuels.',
  en: 'Hello! Ask me anything from your programme and I will look it up in your course material.',
  ar: 'أهلاً! اسألني عن أي شيء في برنامجك وسأبحث عنه في موادك الدراسية.',
};

/**
 * The subjects a refusal is being made relative to, named.
 *
 * Uses the student's real enrolled subjects, in their own language's list
 * punctuation. Arabic separates with a wāw rather than a comma.
 */
function scopeNote(subjects: string[], locale: Locale): string {
  // Arabic separates a list with a wāw-comma; French puts a space before a
  // colon and the other two do not. Getting this wrong is small and looks like
  // the product was not written for the reader.
  const list = locale === 'ar' ? subjects.join('، ') : subjects.join(', ');
  const lead: Record<Locale, string> = {
    fr: 'Pour ta filière, je couvre : ',
    en: 'For your track, I cover: ',
    ar: 'أغطّي لفرعك: ',
  };
  return `${lead[locale]}${list}.`;
}

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

/**
 * What the student is told when the question needs a passage we do not have.
 *
 * A comprehension question — "quel est le mot qui, par ses répétitions,
 * souligne le thème ?" — is answerable only against a text printed on the exam
 * paper, and the generic refusal is wrong about why: the topic is on the
 * syllabus, the passage is simply not in front of us. Telling a student their
 * own French paper is off-programme would be a lie, and one they would believe.
 */
export const NEEDS_PASSAGE_TEXT: Record<Locale, string> = {
  fr:
    "Cette question porte sur un texte imprimé sur ton sujet d'examen, et je ne l'ai pas sous les yeux. " +
    'Copie le passage ici, ou prends-le en photo, et je réponds avec toi.',
  en:
    'This question is about a text printed on your exam paper, and I do not have it in front of me. ' +
    'Paste the passage here, or photograph it, and we will work through it together.',
  ar:
    'هذا السؤال يتعلّق بنصّ مطبوع على ورقة امتحانك، وهو ليس أمامي. ' +
    'انسخ المقطع هنا أو صوّره، ولنعمل عليه معاً.',
};

/**
 * The answer side of routing by question type — and the part that was missing.
 *
 * Retrieving the right material is half of it. The other half is that Lebanese
 * markers award marks per step and the barème states the steps, so a correct
 * essay written as an undifferentiated flow of prose loses most of the marks it
 * has earned. Handing over a marking scheme without telling the model to write
 * against it just adds text to the prompt.
 */
const PER_KIND: Record<QuestionClassification['kind'], string[]> = {
  concept: [],
  comprehension: [
    '',
    'This is a comprehension question: it is asked about a specific text, and that text — not the',
    'syllabus — is where the answer is. Work only from the passage supplied. Quote the line you are',
    'drawing on before you explain it, the way the marker expects the candidate to. If the passage does',
    'not settle the question, say so instead of reasoning from what the topic usually means.',
  ],
  essay: [
    '',
    'This is an essay prompt, and the material includes the official barème — how a Lebanese examiner',
    'awards the marks for a question of this kind.',
    '',
    'Write against that barème:',
    '- Follow the structure it names, section by section, in its order. Where it asks for an',
    '  introduction, a stated problematic, a discussion and a conclusion, the answer has all four and',
    '  they are recognisable as such.',
    '- Say what each part of the structure is for and how many marks it carries, so the student can',
    '  budget their time in the exam.',
    '- Teach the shape, not one year\'s argument. The scheme shows how a marked answer was built; the',
    '  student has to build their own on a different quotation.',
    '- The content of the essay still comes only from the material given. The barème says what shape',
    '  the argument takes, not what is true.',
  ],
};

/**
 * Added when the question points at something that was not supplied.
 *
 * "Expliquez le schéma ci-dessous" with no diagram attached is answerable in
 * the sense that a fluent paragraph can be produced, and unanswerable in the
 * sense that matters. Saying so is the difference between a tutor and a
 * plausible-text generator.
 */
const UNRESOLVED_REFERENCE_PROMPT = [
  '',
  'The question refers to something that was not supplied — a diagram, a table, a document, "the',
  'following", "ci-dessous". Say plainly that you cannot see it, answer whatever part of the question',
  'stands without it, and ask for it. Do not guess what it showed.',
].join('\n');

function systemPrompt(
  tier: GroundingTier,
  classification: QuestionClassification,
  locale: Locale,
): string {
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
    // Never reached: a conversational turn is answered by `conversationalTurn`
    // before retrieval runs, and never enters the grounded prompt at all. Named
    // here so the map stays exhaustive and a new tier cannot be added without
    // deciding what the grounded prompt should say about it.
    conversational: [],
  };

  /*
   * A pasted passage is filed as tier 3 because that is what it is — material
   * the student supplied, not material checked against the programme — but the
   * tier-3 instruction to open by saying "this is based on your own uploaded
   * material" is wrong about the extract printed on the exam paper in front of
   * them. The kind block below says the right thing for that case, so the tier
   * block stands down rather than the two arguing in the same prompt.
   */
  const tierBlock =
    classification.kind === 'comprehension' && tier === 'personal_reference' ? [] : perTier[tier];

  const unresolved =
    classification.confidence === 'low' && classification.kind === 'concept'
      ? [UNRESOLVED_REFERENCE_PROMPT]
      : [];

  return [...common, ...tierBlock, ...PER_KIND[classification.kind], ...unresolved].join('\n');
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
  anchorQuestion?: {
    id: string;
    contentText: string;
    officialSolution: string | null;
    /** The extract printed on the paper, for a question that examines one. */
    sourcePassage?: string | null;
  } | null;
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

  /*
   * Not every message is a question about the syllabus, and only a question
   * about the syllabus can be off it.
   *
   * This runs before retrieval because the refusal downstream is a claim —
   * "this isn't covered by the material available for your track" — and that
   * claim was being made about "hello". A student's first message is usually a
   * greeting, so the first thing the product ever said to most of them was a
   * rebuff about their programme.
   *
   * The lane is narrow on purpose. `classifyChatIntent` returns 'curriculum'
   * for anything it is not sure about, including a question that opens with a
   * greeting, because answering a real question with no material behind it is
   * a worse failure than greeting somebody twice.
   */
  const intent = classifyChatIntent(input.question);
  if (intent.intent !== 'curriculum') {
    yield* conversationalTurn(input, intent);
    return;
  }

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
    /*
     * Two refusals, because there are two reasons. "Not on your programme" and
     * "show me the text you are looking at" send a student to opposite places,
     * and only the second is true of a comprehension question about an extract
     * that was never handed over.
     */
    /*
     * And the refusal says what the boundary IS, not only that one was hit.
     *
     * "This isn't covered by the material available for your track" tells a
     * student they are outside something without telling them what, which reads
     * as a brush-off and leaves them guessing at whether to rephrase or give
     * up. Their own subject list is the context that turns it into information,
     * and it is knowable without retrieving anything or claiming anything about
     * what is inside those subjects.
     *
     * Not added to the comprehension refusal: that one is not about scope at
     * all — the topic IS on the programme and the passage is simply not in
     * front of us — so listing subjects there would imply the opposite.
     */
    let text: string;
    if (grounding.classification.kind === 'comprehension') {
      text = NEEDS_PASSAGE_TEXT[input.locale];
    } else {
      const subjects = await db.subject.findMany({
        where: { id: { in: input.subjectIds } },
        select: { name: true },
        orderBy: { name: 'asc' },
      });
      text =
        REFUSAL_TEXT[input.locale] +
        (subjects.length ? `\n\n${scopeNote(subjects.map((s) => s.name), input.locale)}` : '');
    }
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
        systemPrompt(grounding.tier, grounding.classification, input.locale) +
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

/**
 * The system prompt for a message that was never a curriculum question.
 *
 * The product's guarantee is that it does not invent curriculum content, and
 * that guarantee has to hold on this path too — where, by construction, there
 * is no retrieved material to hold it up. So the prompt's job is almost
 * entirely negative: be a person, be brief, and do not teach anything here.
 *
 * A student who says "hello" and gets a warm sentence back will very often ask
 * a real question next, and that one goes down the grounded path like any
 * other. Naming the subjects they actually have is the useful part: it is true
 * without retrieving anything, and it tells them what to ask about.
 */
function conversationalPrompt(subjects: string[], locale: Locale): string {
  return [
    'You are the study assistant inside a Lebanese Baccalaureate revision app.',
    `Reply in ${LANGUAGE_NAME[locale]}.`,
    '',
    'The student has sent a greeting, a courtesy, or a question about you rather',
    'than a question about their course. Answer it the way a helpful person would:',
    'warmly, in one or two short sentences, and then invite the actual question.',
    '',
    'HARD LIMITS. On this path you have retrieved no course material, so:',
    '- Do not explain, define, or teach any subject matter, even if you know it.',
    '  If the message drifts toward a real question, say you will look it up and',
    '  ask them to put it to you directly.',
    '- Do not claim anything is or is not on their programme. You have not checked.',
    '- Do not invent subjects, chapters, exam dates, or their progress.',
    '- No headings, no lists, no citations. This is a sentence or two of chat.',
    '',
    subjects.length
      ? `Subjects this student is enrolled in, and the only ones you may name: ${subjects.join(', ')}.`
      : 'You do not know which subjects this student takes, so do not name any.',
  ].join('\n');
}

/**
 * Answers a greeting or a question about the tutor, and grounds nothing.
 *
 * Kept as its own generator rather than a branch inside the main one because
 * almost nothing in the grounded path applies: there are no sources to cite, no
 * context to verify an answer against, and no tier to earn. Trying to reuse
 * that machinery with empty arguments is how a path like this ends up emitting
 * a confident-looking badge over an ungrounded sentence.
 */
async function* conversationalTurn(
  input: ChatTurnInput,
  intent: IntentClassification,
): AsyncGenerator<ChatEvent> {
  // No sources, and the tier says why — so the UI shows no grounding claim at
  // all rather than a refusal or a false badge of authority.
  yield { type: 'meta', tier: 'conversational', sources: [], topSimilarity: null };

  const subjects = await db.subject.findMany({
    where: { id: { in: input.subjectIds } },
    select: { name: true },
  });

  let answer = '';
  let modelUsed: string | null = null;

  try {
    const stream = ai().streamText({
      system: conversationalPrompt(subjects.map((s) => s.name), input.locale),
      messages: [...input.history.slice(-8), { role: 'user', content: input.question }],
      // Low: this is a sentence of chat, and the grounded path is where the
      // thinking budget belongs.
      effort: 'low',
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
    /*
     * Falling back rather than erroring. The grounded path is right to show an
     * error when generation fails, because there is no honest answer to give
     * without it. Here there is: a fixed greeting says everything this turn was
     * ever going to say, and "Generation failed" in response to "hello" is a
     * worse experience than the provider being briefly down deserves.
     */
    console.error('[chat] conversational generation failed', err);
    if (!answer) {
      answer = CONVERSATIONAL_FALLBACK[input.locale];
      yield { type: 'delta', text: answer };
    }
  }

  const message = await persistAssistantMessage({
    sessionId: input.sessionId,
    content: answer,
    tier: 'conversational',
    citedSourceIds: [],
    topSimilarity: null,
    modelUsed,
  });

  console.info(`[chat] conversational turn (${intent.signal})`);
  yield { type: 'done', messageId: message.id, verified: true };
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
