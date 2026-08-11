/**
 * Demo seed — a fully populated account for a presentation.
 *
 * Run with `npm run db:demo`. Idempotent: it deletes and rebuilds the demo
 * track, the demo user and everything hanging off them, and touches nothing
 * else. The ordinary `db:seed` data is left alone, so the two can coexist.
 *
 * What this exists to solve: an empty product demos terribly. Every screen in
 * this application is built around a student's history — mastery bars, a
 * readiness score, a streak, a barème breakdown, a deck of cards due today —
 * and with no history they all correctly render their empty states. Nobody buys
 * an empty state.
 *
 * So the demo account is a plausible Grade 12 student two-thirds of the way
 * through the year:
 *
 *   * 60 days of practice, weighted so some chapters are strong and others are
 *     visibly weak — a uniformly excellent student makes the weakness features
 *     unshowable.
 *   * A flashcard deck with cards genuinely due today.
 *   * A sat and marked paper with a real barème breakdown, including one answer
 *     the marker could not mark, because "needs human marking" is a feature and
 *     hiding it from the demo would be dishonest.
 *   * Five recorded tutoring conversations, one of which is a refusal.
 *
 * Everything written here is illustrative content, not ministry material. The
 * account opens with an announcement that says so.
 */

import { PrismaClient, type Prisma } from '@prisma/client';

import { hashPassword } from '../src/lib/auth/password';

import { DEMO_CHATS, DEMO_MODEL_LABEL } from './demo/demo-chats';
import {
  DEMO_CONTENT_CHUNKS,
  DEMO_EXAM_CYCLES,
  DEMO_LANGUAGE,
  DEMO_NOTICE_BODY,
  DEMO_NOTICE_TITLE,
  DEMO_QUESTIONS,
  DEMO_TRACK_CODE,
} from './demo/demo-curriculum';

const db = new PrismaClient();

export const DEMO_EMAIL = 'demo@bac2.local';
export const DEMO_PASSWORD = 'DemoDay2026!';
const DEMO_NAME = 'Maya Haddad';

/** How much history to build. 60 days is enough for a streak and a trend. */
const HISTORY_DAYS = 60;

/**
 * Deterministic pseudo-randomness.
 *
 * A demo must look identical every time it is run — the same weak chapter, the
 * same streak, the same numbers on the slide. `Math.random()` would reshuffle
 * the story between the rehearsal and the meeting.
 */
function makeRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

const random = makeRandom(20_260_811);

function daysAgo(days: number, hour = 18): Date {
  const now = new Date();
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, 0, 0));
  date.setUTCDate(date.getUTCDate() - days);
  return date;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

async function main() {
  console.log('\nSeeding the demo account…\n');

  // --- Clean slate -------------------------------------------------------
  /*
   * Only the demo *user* is removed, never the curriculum.
   *
   * The taxonomy under LS is the real one, loaded from the transcribed CRDP
   * textbooks and shared with every other account. An earlier version of this
   * script created and dropped its own LS track, which silently overwrote real
   * chapter names with invented ones. It now attaches to what is already there
   * and fails loudly if it is not.
   */
  const existingUser = await db.user.findFirst({ where: { email: DEMO_EMAIL }, select: { id: true } });
  if (existingUser) await db.user.delete({ where: { id: existingUser.id } });

  const track = await db.track.findUnique({
    where: { code: DEMO_TRACK_CODE },
    select: { id: true, name: true },
  });
  if (!track) {
    throw new Error(
      `No ${DEMO_TRACK_CODE} track in the database. Run "npm run db:seed:taxonomy" first — the demo ` +
        'is built on the real curriculum and will not invent one.',
    );
  }

  // --- The real taxonomy this demo hangs off -------------------------------
  const subjects = await db.subject.findMany({
    where: { trackId: track.id, language: DEMO_LANGUAGE },
    select: {
      id: true,
      name: true,
      chapters: { select: { id: true, name: true }, orderBy: { orderIndex: 'asc' } },
    },
  });

  const subjectIdByName = new Map(subjects.map((s) => [s.name, s.id]));
  const chapterIdByKey = new Map<string, string>();
  const chapterMeta = new Map<string, { subjectId: string; subjectName: string; name: string }>();

  for (const subject of subjects) {
    for (const chapter of subject.chapters) {
      chapterIdByKey.set(`${subject.name}::${chapter.name}`, chapter.id);
      chapterMeta.set(chapter.id, {
        subjectId: subject.id,
        subjectName: subject.name,
        name: chapter.name,
      });
    }
  }

  console.log(
    `  curriculum: ${DEMO_TRACK_CODE} (${track.name}) — ${subjects.length} subjects, ${chapterIdByKey.size} chapters, from the real books`,
  );

  // --- Past papers -------------------------------------------------------
  const cycleIdByKey = new Map<string, string>();
  for (const cycle of DEMO_EXAM_CYCLES) {
    const subjectId = subjectIdByName.get(cycle.subject);
    if (!subjectId) continue;

    // Upsert, not create: the demo now shares a curriculum with everything
    // else in the database, so its cycles survive a re-run and have to be
    // updated in place rather than inserted again.
    const row = await db.examCycle.upsert({
      where: {
        subjectId_year_session: { subjectId, year: cycle.year, session: cycle.session },
      },
      update: { title: cycle.title, durationMinutes: cycle.durationMinutes },
      create: {
        subjectId,
        year: cycle.year,
        session: cycle.session,
        title: cycle.title,
        durationMinutes: cycle.durationMinutes,
      },
      select: { id: true },
    });
    cycleIdByKey.set(`${cycle.subject}::${cycle.year}::${cycle.session}`, row.id);
  }

  // --- Questions ---------------------------------------------------------
  const questionIds: { id: string; chapterId: string; subject: string; text: string; maxScore: number }[] = [];

  for (const question of DEMO_QUESTIONS) {
    const chapterId = chapterIdByKey.get(`${question.subject}::${question.chapter}`);
    if (!chapterId) {
      /*
       * Every demo question must land on a real chapter. Skipping quietly is
       * how a demo ends up with an empty practice screen five minutes before
       * the meeting, so this stops instead.
       */
      throw new Error(
        `Demo question references "${question.subject} / ${question.chapter}", which is not a chapter in the ` +
          `${DEMO_TRACK_CODE} curriculum. Fix prisma/demo/demo-curriculum.ts, or re-run db:seed:taxonomy.`,
      );
    }

    const cycleId = question.cycle
      ? cycleIdByKey.get(`${question.subject}::${question.cycle.year}::${question.cycle.session}`)
      : undefined;

    /*
     * Replace this exact question if a previous demo run wrote it.
     *
     * Matching on (chapter, contentText) rather than deleting everything in the
     * chapter: real ingested questions live in these same chapters now, and a
     * demo re-run must not touch them.
     */
    await db.question.deleteMany({ where: { chapterId, contentText: question.contentText } });

    const row = await db.question.create({
      data: {
        chapterId,
        sourceType: question.cycle ? 'past_exam' : 'textbook',
        sourceExamId: cycleId ?? null,
        questionType: question.questionType,
        difficulty: question.difficulty,
        // Author-assigned in the demo. The nightly job recalibrates from real
        // attempts once there are enough of them.
        difficultyConfidence: 0.35,
        contentText: question.contentText,
        contentLatex: question.contentLatex ?? null,
        contentImages: [],
        options: (question.options ?? undefined) as Prisma.InputJsonValue | undefined,
        correctOptionId: question.correctOptionId ?? null,
        officialSolution: question.officialSolution ?? null,
        bareme: (question.bareme ?? undefined) as Prisma.InputJsonValue | undefined,
        orderIndex: question.cycle?.orderIndex ?? null,
        verifiedStatus: 'verified',
      },
      select: { id: true },
    });

    questionIds.push({
      id: row.id,
      chapterId,
      subject: question.subject,
      text: question.contentText,
      maxScore: (question.bareme ?? []).reduce((sum, item) => sum + item.points, 0),
    });
  }

  console.log(`  questions: ${questionIds.length}`);

  // --- Course material ---------------------------------------------------
  const chunkIdByTitle = new Map<string, string>();
  for (const chunk of DEMO_CONTENT_CHUNKS) {
    const chapterId = chapterIdByKey.get(`${chunk.subject}::${chunk.chapter}`);
    if (!chapterId) continue;

    await db.contentChunk.deleteMany({
      where: { chapterId, title: chunk.title, sourceRef: 'demo:illustrative' },
    });

    const row = await db.contentChunk.create({
      data: {
        chapterId,
        kind: chunk.kind,
        title: chunk.title,
        contentText: chunk.contentText,
        sourceRef: 'demo:illustrative',
      },
      select: { id: true },
    });
    chunkIdByTitle.set(chunk.title, row.id);
  }

  console.log(`  course material chunks: ${chunkIdByTitle.size}`);

  // --- The demo student --------------------------------------------------
  const user = await db.user.create({
    data: {
      email: DEMO_EMAIL,
      passwordHash: await hashPassword(DEMO_PASSWORD),
      role: 'student',
      displayName: DEMO_NAME,
      trackId: track.id,
      preferredLanguage: 'en',
      country: 'LB',
      createdAt: daysAgo(HISTORY_DAYS + 5),
      subscription: {
        create: {
          plan: 'annual',
          status: 'pending',
          cardBrand: 'visa',
          cardLast4: '4242',
          cardExpMonth: 7,
          cardExpYear: 2029,
          cardholderName: DEMO_NAME,
        },
      },
    },
    select: { id: true },
  });

  // --- Practice history --------------------------------------------------
  /*
   * The story the numbers tell.
   *
   * Chapters are given a target competence, and attempts are generated to land
   * near it. Two chapters are deliberately weak so that "your weakest chapter",
   * the weak-spot flashcard scope and the red bars on the dashboard all have
   * something real to point at. A demo where everything is green cannot show
   * the half of the product that finds problems.
   */
  const COMPETENCE: Record<string, number> = {
    // Life Sciences
    'Transmission of genes and genetic recombination': 0.82,
    'Human Genetics': 0.58,
    'Role and components of the immune system': 0.9,
    'The immune response': 0.71,
    'Disorders of the Immune System': 0.66,
    'Function of neurons': 0.62,
    'Myotatic reflex': 0.74,
    'Neurotransmitters and medical applications': 0.55,
    'Regulation of glycemia': 0.68,
    'Regulation of arterial blood pressure': 0.6,
    // The weakest chapter in the account, and the one the demo points at.
    'Regulation of the female sexual hormones': 0.34,

    // Mathematics
    'Conditional probability': 0.7,
    'Bernoulli distribution - Binomial distribution': 0.79,
    'Exponential functions': 0.56,
    'Methods of integration': 0.41,
    'Modulus and argument of a complex number': 0.85,

    // Chemistry
    'Kinetic Factors': 0.8,
    'Chemical Equilibrium': 0.63,
    'Reaction between a weak acid and a strong base': 0.5,
    'Carboxylic acids and their derivatives': 0.72,
    'Functional Groups': 0.87,

    // Physics
    'Mechanical Oscillations': 0.47,
    'Radioactivity': 0.73,
    'Electromagnetic Induction': 0.64,
    'Energy': 0.76,
  };

  /*
   * Which days were studied.
   *
   * Not every day: a student with a perfect 60-day attendance record is not a
   * student, and the activity strip is more convincing with gaps in it. The
   * last nine days are unbroken so the demo opens on a nine-day streak.
   */
  const studiedDays: number[] = [];
  for (let day = HISTORY_DAYS; day >= 0; day -= 1) {
    if (day <= 8) {
      studiedDays.push(day);
      continue;
    }
    // Roughly five days in seven, skewed against weekends-in-the-middle.
    if (random() < 0.68) studiedDays.push(day);
  }

  const attemptRows: Prisma.AttemptCreateManyInput[] = [];
  const reviewedQuestionIds = new Set<string>();

  for (const day of studiedDays) {
    // Between two and seven questions on a studied day.
    const count = 2 + Math.floor(random() * 6);

    for (let i = 0; i < count; i += 1) {
      const question = questionIds[Math.floor(random() * questionIds.length)];
      if (!question) continue;

      const meta = chapterMeta.get(question.chapterId);
      const competence = COMPETENCE[meta?.name ?? ''] ?? 0.6;

      // Competence improves slightly over the period, so trends point up.
      const improvement = ((HISTORY_DAYS - day) / HISTORY_DAYS) * 0.12;
      const p = Math.min(0.97, competence + improvement);

      const hour = 15 + Math.floor(random() * 7);
      const attemptedAt = daysAgo(day, hour);

      if (question.maxScore > 0) {
        // Barème-marked: partial credit, which is what makes the mastery
        // formula worth having.
        const ratio = Math.max(0, Math.min(1, p + (random() - 0.5) * 0.3));
        const score = round2(Math.round(ratio * question.maxScore * 2) / 2);
        attemptRows.push({
          userId: user.id,
          questionId: question.id,
          isCorrect: null,
          submittedAnswer: DEMO_WORKING,
          score,
          maxScore: question.maxScore,
          timeTakenSeconds: 180 + Math.floor(random() * 600),
          context: 'practice',
          attemptedAt,
        });
      } else {
        attemptRows.push({
          userId: user.id,
          questionId: question.id,
          isCorrect: random() < p,
          submittedAnswer: null,
          timeTakenSeconds: 40 + Math.floor(random() * 120),
          context: 'practice',
          attemptedAt,
        });
      }

      reviewedQuestionIds.add(question.id);
    }
  }

  await db.attempt.createMany({ data: attemptRows });
  console.log(`  attempts: ${attemptRows.length} across ${studiedDays.length} days`);

  // --- Flashcards --------------------------------------------------------
  /*
   * Every practised question becomes a card, exactly as the live path does.
   * Due dates are spread so that a useful number are due *today* — a flashcard
   * demo with nothing due shows an empty state and a congratulation.
   */
  const cardRows: Prisma.FlashcardStateCreateManyInput[] = [];
  const practised = [...reviewedQuestionIds];

  for (const [index, questionId] of practised.entries()) {
    const repetitions = 1 + Math.floor(random() * 5);
    const easiness = round2(2.1 + random() * 0.6);
    const intervalDays = [1, 2, 4, 7, 15, 30][Math.min(repetitions, 5)] ?? 1;

    // Two in five are due today or overdue; the rest are scheduled ahead.
    const due = index % 5 < 2 ? -Math.floor(random() * 3) : 1 + Math.floor(random() * 12);

    cardRows.push({
      userId: user.id,
      questionId,
      easiness,
      intervalDays,
      repetitions,
      dueDate: daysAgo(due, 0),
      lastReviewedAt: daysAgo(due + intervalDays, 19),
    });
  }

  await db.flashcardState.createMany({ data: cardRows });
  const dueToday = cardRows.filter((card) => (card.dueDate as Date) <= new Date()).length;
  console.log(`  flashcards: ${cardRows.length} cards, ${dueToday} due today`);

  // --- Chapter mastery ---------------------------------------------------
  // Computed from the attempts just written, using the real scoring module, so
  // the demo's numbers are produced by the same code that produces a real
  // student's — not typed in by hand.
  const { computeMastery } = await import('../src/lib/scoring/mastery');

  const byChapter = new Map<string, { attemptedAt: Date; isCorrect: boolean | null; score?: number | null; maxScore?: number | null }[]>();
  for (const attempt of attemptRows) {
    const question = questionIds.find((q) => q.id === attempt.questionId);
    if (!question) continue;
    const list = byChapter.get(question.chapterId) ?? [];
    list.push({
      attemptedAt: attempt.attemptedAt as Date,
      isCorrect: (attempt.isCorrect as boolean | null) ?? null,
      score: attempt.score as number | null,
      maxScore: attempt.maxScore as number | null,
    });
    byChapter.set(question.chapterId, list);
  }

  for (const [chapterId, attempts] of byChapter) {
    const mastery = computeMastery(attempts);
    await db.chapterMastery.create({
      data: {
        userId: user.id,
        chapterId,
        masteryScore: mastery.masteryScore,
        attemptsCount: mastery.attemptsCount,
      },
    });
  }
  console.log(`  chapter mastery rows: ${byChapter.size}`);

  await seedExamSimulation(user.id, subjectIdByName, cycleIdByKey, questionIds);
  await seedChats(user.id, questionIds, chunkIdByTitle);
  await seedPlanning(user.id, subjectIdByName, chapterIdByKey, track.id);

  console.log('\n  ────────────────────────────────────────────────');
  console.log('  Demo account ready');
  console.log(`    ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  console.log('    English · Life Sciences (LS) · Lebanon');
  console.log('  ────────────────────────────────────────────────');
  console.log('  Content is illustrative, not official ministry material.\n');
}

/** A plausible piece of student working, reused across generated attempts. */
const DEMO_WORKING =
  'A = T and G = C, so T = 900 and A + T = 1800.\n' +
  '3000 - 1800 = 1200 shared between G and C, so C = 600.\n' +
  'Replication is semi-conservative: 1 -> 2 -> 4 molecules.\n' +
  'All 4 contain 15N because the original molecule was labelled.';

/**
 * One sat, marked paper.
 *
 * Includes an answer the marker could not mark, because that is a real outcome
 * of the marking engine and the demo should show it rather than hide it: an
 * unmarkable answer is excluded from the total and filed for a human, never
 * silently scored zero.
 */
async function seedExamSimulation(
  userId: string,
  subjectIdByName: Map<string, string>,
  cycleIdByKey: Map<string, string>,
  questions: { id: string; chapterId: string; subject: string; text: string; maxScore: number }[],
) {
  const subjectId = subjectIdByName.get('Life Sciences');
  const cycleId = cycleIdByKey.get('Life Sciences::2023::session1');
  if (!subjectId || !cycleId) return;

  const paperQuestions = questions.filter((q) => q.subject === 'Life Sciences' && q.maxScore > 0).slice(0, 3);
  if (paperQuestions.length === 0) return;

  const submittedAt = daysAgo(6, 11);

  const simulation = await db.examSimulation.create({
    data: {
      userId,
      subjectId,
      sourceMode: 'real_cycle',
      examCycleId: cycleId,
      status: 'graded',
      durationMinutes: 180,
      expiresAt: new Date(submittedAt.getTime() + 180 * 60_000),
      startedAt: new Date(submittedAt.getTime() - 165 * 60_000),
      submittedAt,
      gradedAt: new Date(submittedAt.getTime() + 4 * 60_000),
    },
    select: { id: true },
  });

  let awarded = 0;
  let available = 0;

  for (const [index, question] of paperQuestions.entries()) {
    const full = await db.question.findUnique({
      where: { id: question.id },
      select: { bareme: true, contentText: true },
    });
    const bareme = (full?.bareme as { criterion: string; points: number }[] | null) ?? [];

    const slot = await db.examSimulationQuestion.create({
      data: {
        examSimulationId: simulation.id,
        questionId: question.id,
        orderIndex: index,
        baremeSnapshot: bareme as unknown as Prisma.InputJsonValue,
        maxScore: question.maxScore,
      },
      select: { id: true },
    });

    // The last question is the unmarkable one.
    const unmarkable = index === paperQuestions.length - 1;

    if (unmarkable) {
      await db.examAnswer.create({
        data: {
          examSimulationQuestionId: slot.id,
          submissionType: 'photo',
          photoUrl: null,
          ocrExtractedText: '[the photograph could not be read clearly enough to mark]',
          ocrConsistencyChecked: true,
          ocrConsistencyPassed: false,
          ocrConsistencyNotes:
            'Two readings of this photograph disagreed on several lines of working, so it was not marked. Re-photograph the page in better light with the whole sheet in frame.',
          baremeResult: undefined,
          totalScore: null,
          maxScore: null,
          gradedAt: new Date(submittedAt.getTime() + 4 * 60_000),
        },
      });
      continue;
    }

    // Marked, with a criterion-by-criterion breakdown and examiner notes.
    const results = bareme.map((criterion, position) => {
      const awardedHere = position < bareme.length - 1 ? criterion.points : round2(criterion.points / 2);
      return {
        criterion: criterion.criterion,
        points_awarded: awardedHere,
        points_possible: criterion.points,
        justification:
          awardedHere >= criterion.points
            ? 'Stated clearly and correctly.'
            : 'The conclusion is right but the justification asked for is missing; half the marks are for the reasoning.',
      };
    });

    const total = round2(results.reduce((sum, r) => sum + r.points_awarded, 0));
    awarded += total;
    available += question.maxScore;

    await db.examAnswer.create({
      data: {
        examSimulationQuestionId: slot.id,
        submissionType: 'typed',
        typedAnswer: DEMO_WORKING,
        ocrConsistencyChecked: false,
        baremeResult: results as unknown as Prisma.InputJsonValue,
        totalScore: total,
        maxScore: question.maxScore,
        gradedAt: new Date(submittedAt.getTime() + 4 * 60_000),
      },
    });

    // Exam answers count towards mastery exactly like practice does.
    await db.attempt.create({
      data: {
        userId,
        questionId: question.id,
        isCorrect: null,
        submittedAnswer: DEMO_WORKING,
        score: total,
        maxScore: question.maxScore,
        context: 'exam_sim',
        attemptedAt: submittedAt,
      },
    });
  }

  await db.examSimulation.update({
    where: { id: simulation.id },
    data: { totalScore: awarded, maxScore: available },
  });

  console.log(`  exam simulation: ${awarded}/${available}, one answer awaiting human marking`);
}

/** The recorded tutoring transcripts. */
async function seedChats(
  userId: string,
  questions: { id: string; text: string }[],
  chunkIdByTitle: Map<string, string>,
) {
  for (const chat of DEMO_CHATS) {
    const anchor = chat.anchorQuestion
      ? questions.find((q) => q.text.startsWith(chat.anchorQuestion!))
      : undefined;

    // Anchoring to the attempt is what puts the student's own working in front
    // of the tutor, which is the whole point of the correction-key transcript.
    const attempt = anchor && chat.anchorAttempt
      ? await db.attempt.findFirst({
          where: { userId, questionId: anchor.id },
          orderBy: { attemptedAt: 'desc' },
          select: { id: true },
        })
      : null;

    const session = await db.chatSession.create({
      data: {
        userId,
        questionId: anchor?.id ?? null,
        attemptId: attempt?.id ?? null,
        title: chat.title,
        createdAt: daysAgo(chat.daysAgo, 20),
        updatedAt: daysAgo(chat.daysAgo, 20),
      },
      select: { id: true },
    });

    for (const [index, turn] of chat.turns.entries()) {
      const citedIds: string[] = [];
      if (turn.citeQuestion) {
        const cited = questions.find((q) => q.text.startsWith(turn.citeQuestion!));
        if (cited) citedIds.push(cited.id);
      }
      if (turn.citeChunk) {
        const chunkId = chunkIdByTitle.get(turn.citeChunk);
        if (chunkId) citedIds.push(chunkId);
      }

      await db.chatMessage.create({
        data: {
          sessionId: session.id,
          role: turn.role,
          content: turn.content,
          groundingTier: turn.role === 'assistant' ? (turn.tier ?? 'concept_level') : null,
          citedSourceIds: citedIds,
          topSimilarity: turn.topSimilarity ?? null,
          modelUsed: turn.role === 'assistant' ? DEMO_MODEL_LABEL : null,
          // Minutes apart, so the thread reads in order.
          createdAt: new Date(daysAgo(chat.daysAgo, 20).getTime() + index * 90_000),
        },
      });
    }
  }

  console.log(`  tutoring conversations: ${DEMO_CHATS.length} (one ends in a refusal)`);
}

/** Schedule, to-dos, grades, exam dates, notifications and the demo notice. */
async function seedPlanning(
  userId: string,
  subjectIdByName: Map<string, string>,
  chapterIdByKey: Map<string, string>,
  trackId: string,
) {
  const lifeSciences = subjectIdByName.get('Life Sciences');
  const maths = subjectIdByName.get('Mathematics');

  // The official sitting, plus a school mock.
  await db.upcomingExam.createMany({
    data: [
      { userId, examDate: nextMidJune(), label: 'Baccalauréat', isBacExam: true },
      {
        userId,
        examDate: daysAgo(-24, 8),
        label: 'School mock — Life Sciences',
        isBacExam: false,
        subjectId: lifeSciences ?? null,
      },
    ],
  });

  const studySessions: Prisma.StudySessionCreateManyInput[] = [
    { userId, chapterId: chapterIdByKey.get('Life Sciences::Regulation of the female sexual hormones') ?? null, title: 'Female sexual hormones — feedback loops', scheduledDate: daysAgo(-1, 17), durationMinutes: 45, source: 'ai_suggested', status: 'planned' },
    { userId, chapterId: chapterIdByKey.get('Mathematics::Methods of integration') ?? null, title: 'Integration by substitution drill', scheduledDate: daysAgo(-2, 17), durationMinutes: 40, source: 'ai_suggested', status: 'planned' },
    { userId, chapterId: chapterIdByKey.get('Physics::Mechanical Oscillations') ?? null, title: 'Oscillations — differential equation', scheduledDate: daysAgo(-3, 18), durationMinutes: 30, source: 'manual', status: 'planned' },
    { userId, chapterId: chapterIdByKey.get('Life Sciences::Human Genetics') ?? null, title: 'Human genetics — reading a pedigree', scheduledDate: daysAgo(1, 17), durationMinutes: 45, source: 'ai_suggested', status: 'done' },
    { userId, chapterId: chapterIdByKey.get('Chemistry::Reaction between a weak acid and a strong base') ?? null, title: 'Titration practice', scheduledDate: daysAgo(3, 17), durationMinutes: 40, source: 'manual', status: 'done' },
  ];
  await db.studySession.createMany({ data: studySessions });

  await db.todo.createMany({
    data: [
      { userId, content: 'Re-do the 2022 genetics question without notes', isDone: false, linkedChapterId: chapterIdByKey.get('Life Sciences::Transmission of genes and genetic recombination') ?? null, linkedAction: 'practice' },
      { userId, content: 'Ask Mr Karam about the LH feedback threshold', isDone: false },
      { userId, content: 'Review integral substitution cards', isDone: false, linkedChapterId: chapterIdByKey.get('Mathematics::Methods of integration') ?? null, linkedAction: 'flashcards' },
      { userId, content: 'Sit a full Life Sciences paper under time', isDone: true, linkedAction: 'exam_sim' },
    ],
  });

  await db.userGrade.createMany({
    data: [
      { userId, subjectId: lifeSciences ?? null, label: 'Class test — Immunology', grade: 15.5, maxGrade: 20, date: daysAgo(21, 9) },
      { userId, subjectId: maths ?? null, label: 'Class test — Sequences', grade: 17, maxGrade: 20, date: daysAgo(35, 9) },
      { userId, subjectId: lifeSciences ?? null, label: 'Mock paper — first term', grade: 12.5, maxGrade: 20, date: daysAgo(48, 9) },
    ],
  });

  // The demo notice, and one ordinary announcement so the card is not obviously
  // a single-purpose banner.
  await db.announcement.createMany({
    data: [
      { title: DEMO_NOTICE_TITLE, body: DEMO_NOTICE_BODY, targetTrackId: trackId, createdAt: daysAgo(0, 7) },
      {
        title: 'Official exam dates published',
        body: 'The ministry calendar for the June session is out. Your countdown on the dashboard is already set to it.',
        targetTrackId: trackId,
        createdAt: daysAgo(4, 9),
      },
    ],
  });

  await db.notification.createMany({
    data: [
      { userId, type: 'flashcards_due', message: 'You have cards due today across three subjects.', href: '/flashcards/review', isRead: false, createdAt: daysAgo(0, 7) },
      { userId, type: 'schedule_reminder', message: 'Hormonal regulation tomorrow — 45 minutes, suggested because it is your weakest chapter.', href: '/schedule', isRead: false, createdAt: daysAgo(1, 7) },
      { userId, type: 'announcement', message: 'Official exam dates published: the ministry calendar for the June session is out.', href: '/dashboard', isRead: true, createdAt: daysAgo(4, 9) },
    ],
  });

  console.log('  planning: schedule, to-dos, grades, exam dates, notifications');
}

function nextMidJune(): Date {
  const now = new Date();
  const thisYear = new Date(Date.UTC(now.getUTCFullYear(), 5, 15));
  return thisYear > now ? thisYear : new Date(Date.UTC(now.getUTCFullYear() + 1, 5, 15));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
