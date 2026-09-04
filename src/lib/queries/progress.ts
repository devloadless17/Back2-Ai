import 'server-only';

import { db } from '@/lib/db';
import { subjectLanguagesFor } from '@/lib/queries/taxonomy';
import { computeMastery, weakestChapter, type ScorableAttempt } from '@/lib/scoring/mastery';
import { computeReadiness, type ChapterMasterySnapshot, type ReadinessResult } from '@/lib/scoring/readiness';

/**
 * Progress reads shared by the dashboard and the performance page.
 *
 * Readiness is computed live from attempts rather than read from
 * `readiness_scores`. That table is a cache the nightly job writes for
 * reporting; recomputing here means a student who just finished a chapter sees
 * the effect immediately instead of tomorrow.
 *
 * The trailing-4-week trend is derived by re-running the mastery formula over
 * only the attempts that existed four weeks ago, evaluated at that date. No
 * history table is needed — `attempts` already is the history.
 */

const TREND_WINDOW_DAYS = 28;

/**
 * How far back attempts are read.
 *
 * Recency weight is `exp(-days / 14)`, so an attempt 120 days old contributes
 * `exp(-120/14) ≈ 0.0002` — four orders of magnitude below a fresh one. Reading
 * past this horizon changes the third decimal of nothing while making the query
 * grow forever: a student two years into the product would otherwise load every
 * attempt they have ever made on every dashboard visit.
 */
const RECENCY_HORIZON_DAYS = 120;

export type SubjectProgress = {
  subjectId: string;
  subjectName: string;
  readiness: ReadinessResult;
  chapters: ChapterProgress[];
};

export type ChapterProgress = ChapterMasterySnapshot & {
  chapterName: string;
  unitName: string | null;
  subjectId: string;
  subjectName: string;
};

/** Subjects belonging to the student's locked track. */
export async function getSubjectsForUser(trackId: string | null, language: string) {
  if (!trackId) return [];
  return db.subject.findMany({
    where: { trackId, language: { in: subjectLanguagesFor(language) } },
    select: { id: true, name: true, language: true },
    orderBy: { name: 'asc' },
  });
}

/**
 * Full progress picture for one student across their track.
 *
 * One query for the chapter list and one for the attempts, then everything is
 * computed in memory — a per-chapter query would be dozens of round trips on a
 * page that loads on every visit.
 */
export async function getProgressForUser(
  userId: string,
  trackId: string | null,
  language: string,
): Promise<SubjectProgress[]> {
  const subjects = await getSubjectsForUser(trackId, language);
  if (subjects.length === 0) return [];

  const subjectIds = subjects.map((s) => s.id);

  const now = new Date();
  const horizon = new Date(now.getTime() - RECENCY_HORIZON_DAYS * 86_400_000);

  /*
   * Current mastery is read, not recomputed.
   *
   * `chapter_mastery` is upserted inline on every attempt write, using this
   * same formula, so it is never stale. It is also *exactly* correct despite
   * being computed at an earlier moment, which is worth spelling out because it
   * looks like a bug:
   *
   *   mastery = Σ(credit·wᵢ) / Σ(wᵢ),  wᵢ = exp(-(t_now - tᵢ)/14)
   *
   * Waiting Δ days multiplies every wᵢ by the same exp(-Δ/14), and a constant
   * factor cancels in a weighted mean. A stored mastery does not drift while a
   * student is inactive — it stays exactly what it was.
   *
   * Attempts are still read for the trend component, because that genuinely
   * needs to re-run the formula against a past cutoff.
   */
  const chapters = await db.chapter.findMany({
    where: { subjectId: { in: subjectIds } },
    select: {
      id: true,
      name: true,
      subjectId: true,
      orderIndex: true,
      unit: { select: { name: true } },
      chapterMastery: {
        where: { userId },
        select: { masteryScore: true, attemptsCount: true },
      },
    },
    orderBy: [{ subjectId: 'asc' }, { orderIndex: 'asc' }],
  });

  const chapterIds = chapters.map((c) => c.id);
  if (chapterIds.length === 0) return [];

  // Trend input only, bounded by the recency horizon.
  const attempts = await db.attempt.findMany({
    where: {
      userId,
      attemptedAt: { gte: horizon },
      OR: [
        { question: { chapterId: { in: chapterIds } } },
        { generatedProblem: { chapterId: { in: chapterIds } } },
      ],
    },
    select: {
      attemptedAt: true,
      isCorrect: true,
      score: true,
      maxScore: true,
      question: { select: { chapterId: true, difficulty: true } },
      generatedProblem: { select: { chapterId: true, difficulty: true } },
    },
  });

  const byChapter = new Map<string, ScorableAttempt[]>();
  for (const attempt of attempts) {
    const source = attempt.question ?? attempt.generatedProblem;
    if (!source) continue;

    const list = byChapter.get(source.chapterId) ?? [];
    list.push({
      attemptedAt: attempt.attemptedAt,
      isCorrect: attempt.isCorrect,
      score: attempt.score ? Number(attempt.score) : null,
      maxScore: attempt.maxScore ? Number(attempt.maxScore) : null,
      difficulty: source.difficulty ? Number(source.difficulty) : null,
    });
    byChapter.set(source.chapterId, list);
  }

  const cutoff = new Date(now.getTime() - TREND_WINDOW_DAYS * 86_400_000);

  const subjectNameById = new Map(subjects.map((s) => [s.id, s.name]));
  const bySubject = new Map<string, { current: ChapterProgress[]; past: ChapterMasterySnapshot[] }>();

  for (const chapter of chapters) {
    const chapterAttempts = byChapter.get(chapter.id) ?? [];
    const stored = chapter.chapterMastery[0];

    // Same formula, but as it would have read four weeks ago.
    const pastAttempts = chapterAttempts.filter((a) => a.attemptedAt <= cutoff);
    const past = computeMastery(pastAttempts, cutoff);

    const bucket = bySubject.get(chapter.subjectId) ?? { current: [], past: [] };

    bucket.current.push({
      chapterId: chapter.id,
      chapterName: chapter.name,
      unitName: chapter.unit?.name ?? null,
      subjectId: chapter.subjectId,
      subjectName: subjectNameById.get(chapter.subjectId) ?? '',
      masteryScore: Number(stored?.masteryScore ?? 0),
      attemptsCount: stored?.attemptsCount ?? 0,
    });

    bucket.past.push({
      chapterId: chapter.id,
      masteryScore: past.masteryScore,
      attemptsCount: past.attemptsCount,
    });

    bySubject.set(chapter.subjectId, bucket);
  }

  return subjects.map((subject) => {
    const bucket = bySubject.get(subject.id) ?? { current: [], past: [] };

    const pastMean =
      bucket.past.length === 0
        ? null
        : bucket.past.reduce((sum, c) => sum + c.masteryScore, 0) / bucket.past.length;

    // Before there is any history at all, "flat" is the honest reading; a
    // student who started yesterday has not declined.
    const hasHistory = bucket.past.some((c) => c.attemptsCount > 0);

    return {
      subjectId: subject.id,
      subjectName: subject.name,
      readiness: computeReadiness({
        chapters: bucket.current,
        masteryFourWeeksAgo: hasHistory ? pastMean : null,
      }),
      chapters: bucket.current,
    };
  });
}

/** Flattens progress across subjects and returns the weakest eligible chapter. */
export function findWeakestChapter(progress: SubjectProgress[]): ChapterProgress | null {
  const all = progress.flatMap((s) => s.chapters);
  return weakestChapter(all);
}

/** Chapters ranked weakest first, for the performance page. Eligible chapters only. */
export function rankChapters(progress: SubjectProgress[], limit = 8): ChapterProgress[] {
  return progress
    .flatMap((s) => s.chapters)
    .filter((c) => c.attemptsCount > 0)
    .sort((a, b) => a.masteryScore - b.masteryScore)
    .slice(0, limit);
}

export function rankStrongest(progress: SubjectProgress[], limit = 5): ChapterProgress[] {
  return progress
    .flatMap((s) => s.chapters)
    .filter((c) => c.attemptsCount > 0)
    .sort((a, b) => b.masteryScore - a.masteryScore)
    .slice(0, limit);
}

/**
 * Recomputes and persists one chapter's mastery after an attempt is recorded.
 * Called inline on the attempt write path so the dashboard is never stale.
 */
export async function recomputeChapterMastery(userId: string, chapterId: string): Promise<void> {
  const attempts = await db.attempt.findMany({
    where: {
      userId,
      /*
       * Bounded by the same horizon the read path uses, and for the same reason
       * spelled out above: at a 14-day half-life an attempt 120 days old carries
       * exp(-120/14) ≈ 0.0002 of the weight of a fresh one.
       *
       * This runs on the write path of every single attempt, so leaving it
       * unbounded meant the cost of answering one question grew with everything
       * the student had ever answered in that chapter — a year of revision
       * making each new answer slower than the last. The horizon changes the
       * fourth decimal place and nothing a student could notice.
       */
      attemptedAt: { gte: new Date(Date.now() - RECENCY_HORIZON_DAYS * 86_400_000) },
      /*
       * The chapter the student was practising in, not the one the exercise is
       * filed under. Those are the same thing until a chapter starts offering
       * exercises from another track — GS and LS sit the same chemistry — and
       * then counting by the filing posts a GS student's marks to the LS copy of
       * their chapter, where nothing will ever show them.
       *
       * The null branch is the old rule, kept for attempts recorded before the
       * column existed and for any whose chapter has since been deleted.
       */
      OR: [
        { chapterId },
        { chapterId: null, question: { chapterId } },
        { chapterId: null, generatedProblem: { chapterId } },
      ],
    },
    select: {
      attemptedAt: true,
      isCorrect: true,
      score: true,
      maxScore: true,
      question: { select: { difficulty: true } },
      generatedProblem: { select: { difficulty: true } },
    },
  });

  const scorable: ScorableAttempt[] = attempts.map((attempt) => ({
    attemptedAt: attempt.attemptedAt,
    isCorrect: attempt.isCorrect,
    score: attempt.score ? Number(attempt.score) : null,
    maxScore: attempt.maxScore ? Number(attempt.maxScore) : null,
    difficulty: attempt.question?.difficulty
      ? Number(attempt.question.difficulty)
      : attempt.generatedProblem?.difficulty
        ? Number(attempt.generatedProblem.difficulty)
        : null,
  }));

  const { masteryScore, attemptsCount } = computeMastery(scorable);

  await db.chapterMastery.upsert({
    where: { userId_chapterId: { userId, chapterId } },
    update: { masteryScore, attemptsCount, lastUpdated: new Date() },
    create: { userId, chapterId, masteryScore, attemptsCount },
  });
}

/**
 * The chapter a mark should be posted to.
 *
 * In order: the chapter the student says they are in, if it is theirs and offers
 * this question; then the question's own chapter, if that is in their track; then
 * any chapter of their track that offers it, taken in a fixed order so two
 * students answering the same shared exercise credit the same chapter.
 */
export async function resolveCreditChapter(input: {
  userTrackId: string | null;
  questionId: string;
  questionChapterId: string;
  claimed?: string;
  isGenerated: boolean;
}): Promise<string | null> {
  const trackId = input.userTrackId ?? undefined;

  // A generated problem belongs to one chapter and is never shared across
  // tracks, so there is nothing to resolve and nothing to get wrong.
  if (input.isGenerated) return input.questionChapterId;

  const inTrack = await db.questionChapter.findMany({
    where: { questionId: input.questionId, chapter: { subject: { trackId } } },
    select: { chapterId: true },
    orderBy: { chapterId: 'asc' },
  });

  const offered = new Set(inTrack.map((row) => row.chapterId));
  if (input.claimed && offered.has(input.claimed)) return input.claimed;
  if (offered.has(input.questionChapterId)) return input.questionChapterId;
  return inTrack[0]?.chapterId ?? null;
}
