import 'server-only';

import { db } from '@/lib/db';
import { MIN_ATTEMPTS_FOR_WEAKNESS } from '@/lib/scoring/mastery';

/**
 * Flashcard deck reads and card creation.
 *
 * A deck is built from two sources and the difference between them matters.
 *
 * The primary one is the student's own work: a card *is* a question they have
 * already attempted, added by `ensureCard` the first time they practise it.
 * That is the stronger form of spaced repetition, because the card carries a
 * memory of getting it wrong, and it stays the default.
 *
 * What it cannot do is cover a chapter nobody has touched — which, in the weeks
 * before an exam, is most of the syllabus. The deck was emptiest exactly when a
 * student most wanted one, and there was no way to fill it but to go and sit a
 * practice session first. So a chapter can also be seeded with cards written
 * from its own textbook passages (`fillFlashcardBank`), and those live in
 * `generated_cards` — deliberately not in `questions`, so that model-written
 * text never enters the corpus every other feature reads from.
 *
 * Both kinds schedule through the same `flashcard_state` row and the same SM-2,
 * so everything downstream of a due date is unchanged. What is not unchanged is
 * that a card now has to say which it is: `DueCard.source` travels all the way
 * to the screen, because a student is owed the knowledge that this particular
 * card was written from their book rather than set by an examiner.
 */

export type ReviewScope =
  | { kind: 'all' }
  | { kind: 'subject'; subjectId: string }
  | { kind: 'unit'; unitId: string }
  | { kind: 'chapter'; chapterId: string }
  /** Several chapters at once — revising a whole topic before a test. */
  | { kind: 'chapters'; chapterIds: string[] }
  /**
   * The chapters the student's own attempts say they are weakest in.
   *
   * `subjectId` narrows it to one subject. Reached from inside a subject the
   * unscoped deck is wrong twice over: it mixes in chapters the student did not
   * ask about, and the count beside the card counts them, so a subject with no
   * weak chapters advertises six.
   */
  | { kind: 'weak'; subjectId?: string };

export type DueCard = {
  /**
   * Which table the card came from.
   *
   * Carried rather than inferred: the grading endpoint needs it to know which
   * unique constraint to resolve, and the review screen needs it to label a
   * generated card honestly.
   */
  source: 'question' | 'generated';
  /** Id of the row in the table `source` names. */
  cardId: string;
  contentText: string;
  contentLatex: string | null;
  officialSolution: string | null;
  officialSolutionLatex: string | null;
  chapterId: string;
  chapterName: string;
  subjectName: string;
  easiness: number;
  intervalDays: number;
  repetitions: number;
  /**
   * True when the card was not due and was pulled in anyway because its chapter
   * is weak. Shown to the student — being handed a card early without being told
   * why looks like the scheduler is broken.
   */
  aheadOfSchedule: boolean;
};

/** How many weak chapters a "weak spots" session draws from. */
export const WEAK_CHAPTER_LIMIT = 5;

/** A chapter is only weak enough to target below this mastery. */
export const WEAKNESS_MASTERY_CEILING = 0.7;

/**
 * The chapter-side predicate for a scope, without saying which relation it
 * hangs off.
 *
 * Both `question` and `generatedCard` reach a chapter, so the filter is written
 * once here and applied to each below. Writing it twice is how the two sources
 * quietly drift into disagreeing about what "this unit" means.
 */
function chapterWhere(scope: ReviewScope, trackId: string | null) {
  switch (scope.kind) {
    case 'chapter':
      return { chapterId: scope.chapterId };
    case 'chapters':
      return { chapterId: { in: scope.chapterIds } };
    case 'unit':
      return { chapter: { unitId: scope.unitId } };
    case 'subject':
      return { chapter: { subjectId: scope.subjectId } };
    default:
      return { chapter: { subject: { trackId: trackId ?? undefined } } };
  }
}

/**
 * One `where` covering both kinds of card.
 *
 * An OR across the two relations rather than two queries and a merge: they
 * share a table, so the database can order the whole deck by due date in one
 * pass. Two queries would have to be interleaved in memory, and any `take`
 * applied before the merge would silently favour whichever source was read
 * first.
 *
 * Retired cards are excluded here, at the only place a deck is read, so a card
 * a reviewer pulled stops being dealt everywhere at once.
 */
function scopeWhere(scope: ReviewScope, trackId: string | null) {
  const chapter = chapterWhere(scope, trackId);
  return {
    OR: [{ question: chapter }, { generatedCard: { retiredAt: null, ...chapter } }],
  };
}

export type WeakChapter = {
  chapterId: string;
  chapterName: string;
  subjectName: string;
  masteryScore: number;
  attemptsCount: number;
};

/**
 * The chapters to work on, weakest first.
 *
 * The two thresholds are doing different jobs. `MIN_ATTEMPTS_FOR_WEAKNESS` is
 * the same gate the dashboard uses before naming a weak spot — one bad
 * afternoon in a chapter is not evidence. `WEAKNESS_MASTERY_CEILING` then keeps
 * a student who is at 90% everywhere from being told their best subject is a
 * weakness merely because it is their *relative* worst.
 */
export async function weakChapters(
  userId: string,
  trackId: string | null,
  limit = WEAK_CHAPTER_LIMIT,
  subjectId?: string,
): Promise<WeakChapter[]> {
  const rows = await db.chapterMastery.findMany({
    where: {
      userId,
      attemptsCount: { gte: MIN_ATTEMPTS_FOR_WEAKNESS },
      masteryScore: { lt: WEAKNESS_MASTERY_CEILING },
      // The track filter stays underneath the subject one, so a hand-edited id
      // from another track returns nothing rather than another track's work.
      chapter: { subject: { trackId: trackId ?? undefined, id: subjectId || undefined } },
    },
    select: {
      chapterId: true,
      masteryScore: true,
      attemptsCount: true,
      chapter: { select: { name: true, subject: { select: { name: true } } } },
    },
    orderBy: [{ masteryScore: 'asc' }, { chapterId: 'asc' }],
    take: limit,
  });

  return rows.map((row) => ({
    chapterId: row.chapterId,
    chapterName: row.chapter.name,
    subjectName: row.chapter.subject.name,
    masteryScore: Number(row.masteryScore),
    attemptsCount: row.attemptsCount,
  }));
}

export function startOfToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export async function countDue(userId: string, trackId: string | null, scope: ReviewScope = { kind: 'all' }) {
  if (scope.kind === 'weak') {
    const chapters = await weakChapters(userId, trackId, WEAK_CHAPTER_LIMIT, scope.subjectId);
    if (chapters.length === 0) return 0;

    return db.flashcardState.count({
      where: {
        userId,
        dueDate: { lte: startOfToday() },
        ...scopeWhere({ kind: 'chapters', chapterIds: chapters.map((c) => c.chapterId) }, trackId),
      },
    });
  }

  return db.flashcardState.count({
    where: { userId, dueDate: { lte: startOfToday() }, ...scopeWhere(scope, trackId) },
  });
}

const CHAPTER_SELECT = {
  select: { id: true, name: true, subject: { select: { name: true } } },
} as const;

const CARD_SELECT = {
  easiness: true,
  intervalDays: true,
  repetitions: true,
  question: {
    select: {
      id: true,
      contentText: true,
      contentLatex: true,
      officialSolution: true,
      officialSolutionLatex: true,
      chapter: CHAPTER_SELECT,
    },
  },
  /*
   * A generated card has a front and a back and nothing else — no LaTeX field,
   * no barème, no images. That is not an omission: it is written from a passage
   * as two short strings, and giving it the shape of a question would invite
   * the rest of the product to treat it as one.
   */
  generatedCard: {
    select: { id: true, front: true, back: true, chapter: CHAPTER_SELECT },
  },
} as const;

type ChapterRow = { id: string; name: string; subject: { name: string } };

type CardRow = {
  easiness: unknown;
  intervalDays: number;
  repetitions: number;
  question: {
    id: string;
    contentText: string;
    contentLatex: string | null;
    officialSolution: string | null;
    officialSolutionLatex: string | null;
    chapter: ChapterRow;
  } | null;
  generatedCard: {
    id: string;
    front: string;
    back: string;
    chapter: ChapterRow;
  } | null;
};

/**
 * Filters a deck on read, not just on write.
 *
 * Decks already exist. A student who practised a five-part exercise last week
 * has a card for it, and waiting on a migration to clean those up would mean
 * serving them an exam paper as a flashcard until it ran. Filtering here fixes
 * it for everyone on the next page load; the rows stay in the table and simply
 * stop being dealt.
 *
 * Done in memory because Prisma cannot express a string-length bound and a raw
 * query here would cost the type safety on the rest of this file. A deck is tens
 * to low hundreds of rows per student, so the over-fetch is immaterial — that
 * would not be true of a table-wide query, and this is not one.
 */
function isCardRow(row: CardRow): boolean {
  // A generated card is length-bounded when it is written, so there is nothing
  // to re-check here. The filter exists for decks built before questions were
  // length-bounded at all.
  if (row.generatedCard) return true;
  return row.question ? isCardShaped(row.question) : false;
}

/**
 * Normalises either kind of row into the one shape the review screen renders.
 *
 * Returns null for a row whose source has gone — the `CHECK` on the table makes
 * that unreachable, and a deck that threw on it would take the whole session
 * down rather than skip one card.
 */
function toCard(row: CardRow, aheadOfSchedule: boolean): DueCard | null {
  const scheduling = {
    easiness: Number(row.easiness),
    intervalDays: row.intervalDays,
    repetitions: row.repetitions,
    aheadOfSchedule,
  };

  if (row.generatedCard) {
    const card = row.generatedCard;
    return {
      source: 'generated',
      cardId: card.id,
      contentText: card.front,
      contentLatex: null,
      officialSolution: card.back,
      officialSolutionLatex: null,
      chapterId: card.chapter.id,
      chapterName: card.chapter.name,
      subjectName: card.chapter.subject.name,
      ...scheduling,
    };
  }

  if (!row.question) return null;
  const question = row.question;
  return {
    source: 'question',
    cardId: question.id,
    contentText: question.contentText,
    contentLatex: question.contentLatex,
    officialSolution: question.officialSolution,
    officialSolutionLatex: question.officialSolutionLatex,
    chapterId: question.chapter.id,
    chapterName: question.chapter.name,
    subjectName: question.chapter.subject.name,
    ...scheduling,
  };
}

/** Maps a batch and drops anything unrenderable, in one place. */
function toCards(rows: CardRow[], aheadOfSchedule: boolean): DueCard[] {
  return rows
    .filter(isCardRow)
    .map((row) => toCard(row, aheadOfSchedule))
    .filter((card): card is DueCard => card !== null);
}

/**
 * The cards due now, oldest due-date first so the longest-overdue card is seen
 * first rather than last.
 */
export async function getDueCards(
  userId: string,
  trackId: string | null,
  scope: ReviewScope = { kind: 'all' },
  limit = 40,
  /**
   * Fill the session from the chosen scope even when nothing is due.
   *
   * The clock decides what a student *should* review; it should not decide what
   * they are *allowed* to review. Someone with a test on Thursday who wants to
   * run their whole Dérivées deck tonight is doing exactly the right thing, and
   * refusing them because SM-2 has those cards scheduled for next week is the
   * scheduler serving itself.
   *
   * The cost is real and is not hidden: a card answered early earns an interval
   * it has not quite proved, so every topped-up card is flagged
   * `aheadOfSchedule` and says so on screen. Off by default, so the plain deck
   * still means "what is due".
   */
  topUp = false,
): Promise<DueCard[]> {
  if (scope.kind === 'weak') return getWeakCards(userId, trackId, limit, scope.subjectId);

  const where = scopeWhere(scope, trackId);

  const due = await db.flashcardState.findMany({
    where: { userId, dueDate: { lte: startOfToday() }, ...where },
    select: CARD_SELECT,
    orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
    // Over-fetch: some rows will be dropped by the shape filter below, and a
    // session that came back half-empty because of it would look like a bug.
    take: limit * 2,
  });

  const cards = toCards(due, false).slice(0, limit);
  if (!topUp || cards.length >= limit) return cards;

  // Nearest-due first: the cards closest to falling due are the ones an early
  // review costs least on.
  const early = await db.flashcardState.findMany({
    where: { userId, dueDate: { gt: startOfToday() }, ...where },
    select: CARD_SELECT,
    orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
    take: limit - cards.length,
  });

  return [...cards, ...toCards(early, true)];
}

/**
 * A session built from what the student is worst at rather than from the clock.
 *
 * Due cards in weak chapters come first, and only if there are not enough of
 * them is the session topped up with cards that are not due yet — nearest due
 * date first, so the ones pulled forward are the ones closest to being needed
 * anyway.
 *
 * Reviewing early is a real cost: SM-2 lengthens an interval on a correct
 * answer, and answering a card the day after you last saw it is easier than
 * answering it in three weeks, so the interval it earns is not quite honest.
 * That is accepted deliberately and only inside this scope. A student who has
 * asked to drill their weak chapters is not served by "nothing due, come back
 * Thursday", and the top-up cards are labelled so the choice is visible rather
 * than silent.
 */
async function getWeakCards(
  userId: string,
  trackId: string | null,
  limit: number,
  subjectId?: string,
): Promise<DueCard[]> {
  const chapters = await weakChapters(userId, trackId, WEAK_CHAPTER_LIMIT, subjectId);
  if (chapters.length === 0) return [];

  const chapterIds = chapters.map((chapter) => chapter.chapterId);
  const today = startOfToday();
  const where = scopeWhere({ kind: 'chapters', chapterIds }, trackId);

  const due = await db.flashcardState.findMany({
    where: { userId, dueDate: { lte: today }, ...where },
    select: CARD_SELECT,
    orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
    take: limit,
  });

  const dueCards = toCards(due, false);
  if (dueCards.length >= limit) return dueCards;

  const upcoming = await db.flashcardState.findMany({
    where: { userId, dueDate: { gt: today }, ...where },
    select: CARD_SELECT,
    orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
    take: limit - dueCards.length,
  });

  return [...dueCards, ...toCards(upcoming, true)];
}

/**
 * The longest a question may be and still work as a card.
 *
 * Cards are questions the student has already met — which is the right instinct,
 * and was wrong in practice. A Lebanese Bac paper is built from *exercises*: the
 * `problem` questions in this corpus average around 2,400 characters and run to
 * 18,000, with a shared énoncé, a data table and four numbered parts. Putting
 * one of those on a flashcard produces a card a student cannot answer in ten
 * seconds and therefore cannot self-grade honestly — and SM-2's whole premise is
 * an honest snap judgement about recall.
 *
 * 320 characters is about a paragraph: long enough for a real definition,
 * derivation prompt or short-answer question, short enough to read at a glance.
 * A question longer than that is revision material, and the product already has
 * two better homes for it — practice, and the exam simulator.
 *
 * `TUNABLE`, but raising it much past a paragraph turns the deck back into a
 * reading list.
 */
export const MAX_CARD_LENGTH = 320;

/**
 * Whether a question can carry a card.
 *
 * Exported because the same rule has to hold in two places — deciding what to
 * add, and filtering a deck that was built before the rule existed.
 */
export function isCardShaped(question: {
  contentText: string;
  questionType?: string | null;
}): boolean {
  return question.contentText.trim().length <= MAX_CARD_LENGTH;
}

/**
 * Adds a question to the deck the first time it is practised.
 *
 * `create`-only on conflict: a card that already exists carries scheduling
 * state, and re-practising a question must not reset the interval a student has
 * built up over weeks.
 *
 * Long exercises are skipped rather than added — see `MAX_CARD_LENGTH`. Silently,
 * because "this question was too long to become a flashcard" is not something a
 * student asked about or needs to act on.
 */
export async function ensureCard(userId: string, questionId: string): Promise<void> {
  const question = await db.question.findUnique({
    where: { id: questionId },
    select: { contentText: true, questionType: true },
  });
  if (!question || !isCardShaped(question)) return;

  await db.flashcardState
    .create({ data: { userId, questionId, dueDate: startOfToday() } })
    .catch(() => undefined);
}

/**
 * Due counts per chapter, in one query.
 *
 * The scope selector needs a number next to every chapter, unit and subject.
 * Doing that with one count query per node would be dozens of round trips on a
 * page that loads constantly, so it is counted once at chapter level and summed
 * upwards in memory.
 */
export async function dueCountsByChapter(
  userId: string,
): Promise<{ chapterId: string; unitId: string | null; subjectId: string; due: number }[]> {
  // Both card kinds reach a chapter, by different joins. COALESCE picks
  // whichever of the two the row actually has — the CHECK on the table
  // guarantees it is exactly one — so a chapter's count is the whole deck for
  // that chapter rather than only the attempted half of it.
  const rows = await db.$queryRaw<
    { chapterId: string; unitId: string | null; subjectId: string; due: bigint }[]
  >`
    SELECT c.id         AS "chapterId",
           c.unit_id    AS "unitId",
           c.subject_id AS "subjectId",
           COUNT(*)     AS "due"
    FROM flashcard_state fs
    LEFT JOIN questions       q  ON q.id  = fs.question_id
    LEFT JOIN generated_cards gc ON gc.id = fs.generated_card_id
                                AND gc.retired_at IS NULL
    JOIN chapters c ON c.id = COALESCE(q.chapter_id, gc.chapter_id)
    WHERE fs.user_id = ${userId}::uuid
      AND fs.due_date <= CURRENT_DATE
    GROUP BY c.id, c.unit_id, c.subject_id
  `;

  return rows.map((row) => ({ ...row, due: Number(row.due) }));
}

/** Deck size and how it is distributed, for the flashcards landing page. */
export async function deckSummary(userId: string) {
  const [total, due, upcoming] = await Promise.all([
    // Retired cards are excluded so the headline deck size matches what the
    // student can actually be dealt.
    db.flashcardState.count({
      where: { userId, OR: [{ questionId: { not: null } }, { generatedCard: { retiredAt: null } }] },
    }),
    countDue(userId, null),
    db.flashcardState.findMany({
      where: { userId, dueDate: { gt: startOfToday() } },
      select: { dueDate: true },
      orderBy: { dueDate: 'asc' },
      take: 1,
    }),
  ]);

  return { total, due, nextDueDate: upcoming[0]?.dueDate ?? null };
}
