import { WEAKNESS_MASTERY_CEILING } from '@/lib/queries/flashcards';
import { MIN_ATTEMPTS_FOR_WEAKNESS } from '@/lib/scoring/mastery';

/**
 * The auto-planner.
 *
 * Turns "these are your weak chapters and your exam is on this date" into a
 * day-by-day plan of *activities* — not a to-do list of chapter names.
 *
 * Deliberately rule-based rather than model-generated: the inputs are already
 * numbers the product computed, and asking a model to redistribute minutes
 * across days adds cost and non-determinism to arithmetic. The model earns its
 * place where judgement is needed — explaining a mark, answering a question —
 * not here.
 *
 * Everything written by this module is stamped `ai_suggested`, so a student's
 * own entries are never touched and a plan whose sessions all end up `skipped`
 * can be recognised later as a plan that was wrong about this student.
 */

export type PlannerTaskType = 'quiz' | 'flashcards' | 'exam_drill' | 'review';

/** TUNABLE — typical length of each activity. Sessions are not interchangeable. */
export const TASK_MINUTES: Record<PlannerTaskType, number> = {
  flashcards: 20,
  quiz: 30,
  exam_drill: 45,
  review: 15,
};

/** TUNABLE — the default daily ceiling before the exam ramp is applied. */
export const DEFAULT_MAX_DAILY_MINUTES = 120;
/** TUNABLE — how many distinct chapters a single day may hold. */
export const MAX_CHAPTERS_PER_DAY = 3;
/** TUNABLE — plan no further ahead than this, even for a distant exam. */
export const MAX_HORIZON_DAYS = 60;
/** TUNABLE — inside this window, practice turns into full past-paper drills. */
export const EXAM_DRILL_WINDOW_DAYS = 10;
/** TUNABLE — the last stretch is heavier; capacity scales up to this multiple. */
export const EXAM_RAMP_MAX = 1.5;
/** TUNABLE — the ramp starts this far out and climbs to the exam. */
export const EXAM_RAMP_WINDOW_DAYS = 14;
/** TUNABLE — a chapter studied today gets a short review this many days later. */
export const REVIEW_GAP_DAYS = 3;

/**
 * TUNABLE — inside this window the subject being examined outranks weakness.
 *
 * Weakness is the right signal for most of a term and the wrong one in the last
 * fortnight. Maya sits a Life Sciences mock in nine days; Life Sciences is her
 * STRONGEST subject at 10.2/20, so the weakness weighting ranked it below three
 * subjects she has never practised and her plan for the day was ninety minutes
 * of Francais, Geographie and Histoire. Arithmetically correct, and the kind of
 * suggestion that teaches a student the plan is not worth opening.
 */
export const EXAM_FOCUS_WINDOW_DAYS = 14;
/** TUNABLE — how much the examined subject is worth at the exam itself. */
export const EXAM_FOCUS_MAX = 3;
/**
 * TUNABLE — what a chapter the student already knows is worth, once its subject
 * is days away. Normally such a chapter is dropped outright; before the paper it
 * earns a light review rather than the silence of being treated as finished.
 */
export const EXAM_FOCUS_KNOWN_FLOOR = 0.15;
/** TUNABLE — 0 = Sunday. One day off a week; a plan with no rest gets abandoned. */
export const DEFAULT_REST_WEEKDAY = 0;

export type PlannerChapter = {
  chapterId: string;
  chapterName: string;
  subjectName: string;
  masteryScore: number;
  attemptsCount: number;
  /** Cards already due in this chapter, from the SM-2 scheduler. */
  dueFlashcards?: number;
};

export type PlannedSession = {
  chapterId: string;
  title: string;
  scheduledDate: string; // YYYY-MM-DD
  durationMinutes: number;
  taskType: PlannerTaskType;
  /** One line, shown to the student. A plan that cannot explain itself is ignored. */
  rationale: string;
};

export type BuildPlanInput = {
  chapters: PlannerChapter[];
  /** Null when the student has not told us when they sit. */
  examDate: Date | null;
  from: Date;
  maxDailyMinutes?: number;
  /** Dates the student already has work on — we plan around them. */
  busyDates?: Set<string>;
  /** 0–6, or null for no rest day. */
  restWeekday?: number | null;
  /**
   * The subject of the next exam. Without it the plan knows WHEN the paper is
   * and not WHAT it is on, which is how a Life Sciences candidate nine days out
   * was handed a day of Geography.
   */
  examSubject?: string | null;
};

export function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function daysUntil(from: Date, to: Date): number {
  return Math.ceil((to.getTime() - from.getTime()) / 86_400_000);
}

/**
 * Days between now and the exam, bounded.
 *
 * An exam eight months out does not want 240 planned days — the plan would be
 * stale long before the student reached the end of it, and every re-weight
 * would rewrite hundreds of rows. Plan the near horizon and re-plan as it moves.
 */
export function horizonDays(from: Date, examDate: Date | null): number {
  if (!examDate) return 14;
  const days = daysUntil(from, examDate);
  if (days <= 0) return 0;
  return Math.min(days, MAX_HORIZON_DAYS);
}

/**
 * How much the subject being examined is worth right now.
 *
 * 1 outside the window and at its edge, climbing to EXAM_FOCUS_MAX on the day.
 * Same shape as `dailyCapacity`, deliberately: that one decides how many minutes
 * the last fortnight gets, this one decides whose minutes they are.
 */
export function examFocusRamp(daysOut: number): number {
  const clamped = Math.max(0, Math.min(daysOut, EXAM_FOCUS_WINDOW_DAYS));
  const closeness = (EXAM_FOCUS_WINDOW_DAYS - clamped) / EXAM_FOCUS_WINDOW_DAYS;
  return 1 + closeness * (EXAM_FOCUS_MAX - 1);
}

/** The subject the student sits next, and how far off it is. Null when unknown. */
export type ExamFocus = { subjectName: string; daysOut: number };

/**
 * How much a chapter deserves of the available time.
 *
 * Three signals, deliberately kept separate. `1 - mastery` is how far the
 * student is from knowing it. The evidence multiplier halves the weight of a
 * chapter we have barely seen: a chapter at 0.2 mastery off two attempts is a
 * worse bet than one at 0.4 off twenty, because the first number is mostly
 * noise. Chapters at or above the ceiling are dropped rather than given a small
 * share — revising something already known is the most expensive thing a
 * student short of time can do.
 *
 * And then the exam, which overrides all of that inside its window. Weakness is
 * the right question in November and the wrong one the week of the paper: what
 * is being sat next matters more than what is weakest, because a student walks
 * into one room on one morning and is asked about one subject.
 */
export function chapterWeight(chapter: PlannerChapter, focus: ExamFocus | null = null): number {
  const examined =
    focus !== null &&
    chapter.subjectName === focus.subjectName &&
    focus.daysOut <= EXAM_FOCUS_WINDOW_DAYS;

  if (chapter.masteryScore >= WEAKNESS_MASTERY_CEILING) {
    // Revising what you already know is the most expensive thing a student
    // short of time can do — unless it is on the paper this week, when going in
    // cold on a chapter you last saw in October is more expensive still.
    if (!examined) return 0;
    return EXAM_FOCUS_KNOWN_FLOOR * examFocusRamp(focus.daysOut);
  }

  const gap = Math.max(0, 1 - chapter.masteryScore);
  const evidence = chapter.attemptsCount >= MIN_ATTEMPTS_FOR_WEAKNESS ? 1 : 0.5;
  const base = gap * evidence;
  return examined ? base * examFocusRamp(focus.daysOut) : base;
}

/**
 * Daily capacity on a given day.
 *
 * Flat until the exam is in sight, then climbing to `EXAM_RAMP_MAX`. Students
 * do step up in the final fortnight, and a plan that ignores that either
 * under-uses the last two weeks or exhausts them for the whole term.
 */
export function dailyCapacity(day: Date, examDate: Date | null, base: number): number {
  if (!examDate) return base;
  const out = daysUntil(day, examDate);
  if (out <= 0 || out > EXAM_RAMP_WINDOW_DAYS) return base;
  const closeness = (EXAM_RAMP_WINDOW_DAYS - out) / EXAM_RAMP_WINDOW_DAYS;
  return Math.round((base * (1 + closeness * (EXAM_RAMP_MAX - 1))) / 5) * 5;
}

/**
 * Which activity this chapter needs next.
 *
 * Ordered by what the student is missing, not by variety for its own sake:
 * cards already due are the cheapest win and expire if ignored; a chapter with
 * too little evidence needs attempts before any judgement about it means
 * anything; close to the exam, isolated questions stop being the point.
 */
export function pickTaskType(
  chapter: PlannerChapter,
  day: Date,
  examDate: Date | null,
): { taskType: PlannerTaskType; rationale: string } {
  if ((chapter.dueFlashcards ?? 0) > 0) {
    return {
      taskType: 'flashcards',
      rationale: `${chapter.dueFlashcards} card${chapter.dueFlashcards === 1 ? '' : 's'} due`,
    };
  }
  if (chapter.attemptsCount < MIN_ATTEMPTS_FOR_WEAKNESS) {
    return {
      taskType: 'quiz',
      rationale:
        chapter.attemptsCount === 0
          ? 'Not attempted yet — a quiz gives us something to measure'
          : `Only ${chapter.attemptsCount} attempt${chapter.attemptsCount === 1 ? '' : 's'} so far — too little to judge`,
    };
  }
  if (examDate) {
    const out = daysUntil(day, examDate);
    if (out > 0 && out <= EXAM_DRILL_WINDOW_DAYS) {
      return { taskType: 'exam_drill', rationale: `Exam in ${out} days — sit a full question` };
    }
  }
  return {
    taskType: 'quiz',
    rationale: `Mastery ${Math.round(chapter.masteryScore * 100)}% — your weakest area`,
  };
}

type Slot = { chapter: PlannerChapter; weight: number };

/**
 * Build the plan.
 *
 * Weight the chapters, spend the horizon's capacity in proportion, choose an
 * activity per session, then lay them out day by day — rotating subjects so no
 * one subject monopolises a week, and dropping a short review a few days after
 * each chapter's first sitting.
 */
export function buildPlan(input: BuildPlanInput): PlannedSession[] {
  const { chapters, examDate, from, busyDates } = input;
  const base = input.maxDailyMinutes ?? DEFAULT_MAX_DAILY_MINUTES;
  const restWeekday = input.restWeekday === undefined ? DEFAULT_REST_WEEKDAY : input.restWeekday;

  const days = horizonDays(from, examDate);
  if (days <= 0) return [];

  const focus: ExamFocus | null =
    input.examSubject && examDate
      ? { subjectName: input.examSubject, daysOut: daysUntil(from, examDate) }
      : null;

  const weighted: Slot[] = chapters
    .map((chapter) => ({ chapter, weight: chapterWeight(chapter, focus) }))
    .filter((entry) => entry.weight > 0)
    .sort((a, b) => b.weight - a.weight);

  // Nothing qualifies as weak. Say nothing rather than inventing filler — a
  // planner that schedules busywork to look useful teaches students to ignore it.
  if (weighted.length === 0) return [];

  // Open days: not already spoken for, not the weekly rest day.
  const openDays: Date[] = [];
  for (let i = 0; i < days; i += 1) {
    const day = addDays(from, i);
    if (busyDates?.has(toDateKey(day))) continue;
    if (restWeekday !== null && day.getUTCDay() === restWeekday) continue;
    openDays.push(day);
  }
  if (openDays.length === 0) return [];

  const capacities = openDays.map((day) => dailyCapacity(day, examDate, base));
  const totalMinutes = capacities.reduce((sum, n) => sum + n, 0);
  const totalWeight = weighted.reduce((sum, entry) => sum + entry.weight, 0);

  // Turn each chapter's share of the time into whole sessions. The activity is
  // chosen later, per day, because it depends on how close the exam is by then.
  const byChapter = new Map<string, number>();
  for (const entry of weighted) {
    const share = (entry.weight / totalWeight) * totalMinutes;
    byChapter.set(entry.chapter.chapterId, Math.max(1, Math.round(share / TASK_MINUTES.quiz)));
  }

  // Interleave the chapters by subject before scheduling anything.
  //
  // Without this the plan collapses into one subject at a time: a student who
  // has never practised has every chapter sitting at the same mastery, the
  // weights tie, and a stable sort then hands back whatever order the subjects
  // came out of the database in. The first version of this produced eighteen
  // consecutive days of Arabic — arithmetically correct and useless.
  const bySubject = new Map<string, Slot[]>();
  for (const entry of weighted) {
    const list = bySubject.get(entry.chapter.subjectName) ?? [];
    list.push(entry);
    bySubject.set(entry.chapter.subjectName, list);
  }
  const subjectQueues = [...bySubject.entries()];

  /*
   * How many chapters each subject contributes per rotation.
   *
   * One, normally — that is the anti-monopoly rule above. But strict equality
   * also flattens the exam: weighting Life Sciences three times heavier than
   * Geography still produced three sessions each, because the rotation handed
   * out one slot per subject regardless of what the weights said. A student
   * nine days from a Life Sciences paper got an eighth of her plan on it.
   *
   * So inside the window the examined subject takes more slots per rotation,
   * and every other subject keeps exactly one. The plan tilts hard toward the
   * paper without ever becoming the single-subject grind the interleave exists
   * to prevent.
   */
  const focusPulls =
    focus === null ? 1 : Math.max(1, Math.round(examFocusRamp(focus.daysOut)));

  const cursors = new Map<string, number>();
  const interleaved: Slot[] = [];
  for (let guard = 0; interleaved.length < weighted.length && guard < weighted.length; guard += 1) {
    let placed = false;
    for (const [subjectName, queueForSubject] of subjectQueues) {
      const pulls = focus !== null && subjectName === focus.subjectName ? focusPulls : 1;
      for (let n = 0; n < pulls; n += 1) {
        const at = cursors.get(subjectName) ?? 0;
        const next = queueForSubject[at];
        if (!next) break;
        cursors.set(subjectName, at + 1);
        interleaved.push(next);
        placed = true;
      }
    }
    if (!placed) break;
  }

  // Round-robin across chapters in that interleaved order.
  const ordered: PlannerChapter[] = [];
  const remainingByChapter = new Map(byChapter);
  let anyLeft = true;
  while (anyLeft) {
    anyLeft = false;
    for (const entry of interleaved) {
      const left = remainingByChapter.get(entry.chapter.chapterId) ?? 0;
      if (left > 0) {
        ordered.push(entry.chapter);
        remainingByChapter.set(entry.chapter.chapterId, left - 1);
        anyLeft = true;
      }
    }
  }

  const sessions: PlannedSession[] = [];
  const firstSeen = new Map<string, number>();

  /**
   * Minutes to hold back on a given day for the reviews it is owed.
   *
   * Reviews were originally appended after the day was already full, so they
   * almost never fitted and the spacing they exist to provide silently never
   * happened. Reserving the slot up front is the difference between a feature
   * and a comment describing one. Days are laid out in order, so every chapter
   * first seen `REVIEW_GAP_DAYS` earlier is already known by the time we get here.
   */
  const reviewReserve = (index: number): number => {
    if (index < REVIEW_GAP_DAYS) return 0;
    let owed = 0;
    for (const seenAt of firstSeen.values()) {
      if (seenAt === index - REVIEW_GAP_DAYS) owed += 1;
    }
    return Math.min(owed, MAX_CHAPTERS_PER_DAY) * TASK_MINUTES.review;
  };

  let dayIndex = 0;
  let dayMinutes = 0;
  let dayChapters = new Set<string>();

  const place = (chapter: PlannerChapter, session: Omit<PlannedSession, 'scheduledDate'>, index: number) => {
    sessions.push({ ...session, scheduledDate: toDateKey(openDays[index] as Date) });
  };

  for (const chapter of ordered) {
    const day = openDays[dayIndex];
    if (!day) break;

    const { taskType } = pickTaskType(chapter, day, examDate);
    const minutes = TASK_MINUTES[taskType];
    const capacity = (capacities[dayIndex] ?? base) - reviewReserve(dayIndex);

    const wouldExceedMinutes = dayMinutes + minutes > capacity;
    const wouldExceedChapters = !dayChapters.has(chapter.chapterId) && dayChapters.size >= MAX_CHAPTERS_PER_DAY;

    if (wouldExceedMinutes || wouldExceedChapters) {
      dayIndex += 1;
      dayMinutes = 0;
      dayChapters = new Set();
    }

    const finalDay = openDays[dayIndex];
    if (!finalDay) break;

    const resolved = pickTaskType(chapter, finalDay, examDate);
    place(
      chapter,
      {
        chapterId: chapter.chapterId,
        title: `${chapter.subjectName} — ${chapter.chapterName}`,
        durationMinutes: TASK_MINUTES[resolved.taskType],
        taskType: resolved.taskType,
        rationale: resolved.rationale,
      },
      dayIndex,
    );
    dayMinutes += TASK_MINUTES[resolved.taskType];
    dayChapters.add(chapter.chapterId);

    if (!firstSeen.has(chapter.chapterId)) firstSeen.set(chapter.chapterId, dayIndex);
  }

  // Spaced review: a short pass over each chapter a few days after its first
  // sitting. Scheduled only where the day still has room — a review that pushes
  // a day over its ceiling is worse than no review.
  const usedByDay = new Map<number, number>();
  const chaptersByDay = new Map<number, Set<string>>();
  for (const session of sessions) {
    const index = openDays.findIndex((d) => toDateKey(d) === session.scheduledDate);
    usedByDay.set(index, (usedByDay.get(index) ?? 0) + session.durationMinutes);
    const set = chaptersByDay.get(index) ?? new Set<string>();
    set.add(session.chapterId);
    chaptersByDay.set(index, set);
  }

  for (const [chapterId, firstIndex] of firstSeen) {
    const reviewIndex = firstIndex + REVIEW_GAP_DAYS;
    const day = openDays[reviewIndex];
    if (!day) continue;
    const used = usedByDay.get(reviewIndex) ?? 0;
    const capacity = capacities[reviewIndex] ?? base;
    if (used + TASK_MINUTES.review > capacity) continue;

    // A review must respect the same per-day chapter ceiling as everything
    // else. Slipping a fourth subject onto a day through the back door is how
    // a plan quietly becomes the scattered thing it was built to avoid.
    const onDay = chaptersByDay.get(reviewIndex) ?? new Set<string>();
    if (!onDay.has(chapterId) && onDay.size >= MAX_CHAPTERS_PER_DAY) continue;

    const chapter = chapters.find((c) => c.chapterId === chapterId);
    if (!chapter) continue;

    sessions.push({
      chapterId,
      title: `${chapter.subjectName} — ${chapter.chapterName}`,
      scheduledDate: toDateKey(day),
      durationMinutes: TASK_MINUTES.review,
      taskType: 'review',
      rationale: 'Spaced review of what you covered earlier this week',
    });
    usedByDay.set(reviewIndex, used + TASK_MINUTES.review);
    onDay.add(chapterId);
    chaptersByDay.set(reviewIndex, onDay);
  }

  return sessions.sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate));
}
