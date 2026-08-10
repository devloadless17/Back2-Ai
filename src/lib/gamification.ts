/**
 * Levels, badges and the daily goal.
 *
 * The point of this module is to make effort visible. A student revising for a
 * national exam gets feedback twice a year; everything in between is invisible
 * work, and invisible work is the kind people stop doing. Levels and badges are
 * a way of paying that work back the same evening it happens.
 *
 * Three rules keep it from becoming a slot machine:
 *
 *   1. **Every reward is earned by something real.** XP comes from attempts
 *      that were marked, cards that were reviewed, papers that were sat. There
 *      is no XP for opening the app, and none for reading a solution — the one
 *      surface that would be trivially farmable (old-cycle mode) writes no
 *      attempt rows at all, so it cannot pay out.
 *   2. **Nothing here touches mastery or readiness.** Those numbers are the
 *      product's honest assessment of whether a student is ready to sit an
 *      exam, and a motivational layer must never be able to inflate them. This
 *      module reads; it does not write.
 *   3. **It is derived, never stored.** Level and badges are computed from the
 *      rows that already exist. Nothing can drift out of sync with reality, and
 *      a student cannot end up with a level their work does not support.
 *
 * Pure functions with no database access, so the curve is testable without a
 * Postgres instance.
 */

// ---------------------------------------------------------------------------
// XP
// ---------------------------------------------------------------------------

/**
 * What each kind of work is worth.
 *
 * Deliberately flat-ish. A big multiplier on hard questions sounds fair and in
 * practice teaches students to farm whatever the multiplier is on, rather than
 * to study what they are weakest at.
 */
export const XP = {
  /** Any marked attempt, right or wrong. Turning up is the hard part. */
  attempt: 10,
  /** On top of the base, for full marks. */
  attemptCorrectBonus: 15,
  /** Partial credit earns a share of the bonus, rounded down. */
  flashcardReview: 5,
  /** Sitting a full paper under timed conditions. */
  examSimulation: 120,
  /** Each chapter brought above the mastery threshold, counted once. */
  chapterMastered: 60,
} as const;

export type XpInput = {
  attempts: number;
  /** Attempts that earned full marks. Must not exceed `attempts`. */
  correctAttempts: number;
  /** Attempts that earned partial credit. */
  partialAttempts: number;
  flashcardReviews: number;
  examSimulations: number;
  chaptersMastered: number;
};

export function totalXp(input: XpInput): number {
  const partialBonus = Math.floor(XP.attemptCorrectBonus / 2);

  return (
    input.attempts * XP.attempt +
    input.correctAttempts * XP.attemptCorrectBonus +
    input.partialAttempts * partialBonus +
    input.flashcardReviews * XP.flashcardReview +
    input.examSimulations * XP.examSimulation +
    input.chaptersMastered * XP.chapterMastered
  );
}

// ---------------------------------------------------------------------------
// Levels
// ---------------------------------------------------------------------------

/**
 * XP required to go from level `n` to level `n + 1`.
 *
 * Linear growth rather than exponential. An exponential curve makes the first
 * evening feel great and month three feel pointless, which is exactly backwards
 * for a product whose whole job is the six months before an exam.
 */
export function xpForNextLevel(level: number): number {
  return 150 + Math.max(0, level - 1) * 75;
}

/** Cumulative XP needed to *reach* a level. Level 1 starts at zero. */
export function xpToReachLevel(level: number): number {
  let total = 0;
  for (let n = 1; n < level; n += 1) total += xpForNextLevel(n);
  return total;
}

export type LevelState = {
  level: number;
  /** XP earned inside the current level. */
  xpIntoLevel: number;
  /** XP the current level requires in total. */
  xpForLevel: number;
  /** 0..1 — how far through the current level. */
  progress: number;
  totalXp: number;
};

/** A hard ceiling, so a pathological input cannot spin the loop forever. */
const MAX_LEVEL = 99;

export function levelFromXp(xp: number): LevelState {
  const safeXp = Number.isFinite(xp) && xp > 0 ? Math.floor(xp) : 0;

  let level = 1;
  let remaining = safeXp;

  while (level < MAX_LEVEL && remaining >= xpForNextLevel(level)) {
    remaining -= xpForNextLevel(level);
    level += 1;
  }

  const xpForLevel = xpForNextLevel(level);

  return {
    level,
    xpIntoLevel: remaining,
    xpForLevel,
    progress: level >= MAX_LEVEL ? 1 : Math.min(1, remaining / xpForLevel),
    totalXp: safeXp,
  };
}

/**
 * The title shown beside the level.
 *
 * Keyed rather than literal so the words stay translatable — the dictionary
 * holds the actual strings.
 */
export type RankKey = 'beginner' | 'apprentice' | 'scholar' | 'expert' | 'master';

export function rankForLevel(level: number): RankKey {
  if (level >= 30) return 'master';
  if (level >= 20) return 'expert';
  if (level >= 12) return 'scholar';
  if (level >= 5) return 'apprentice';
  return 'beginner';
}

// ---------------------------------------------------------------------------
// Daily goal
// ---------------------------------------------------------------------------

/**
 * Questions per day.
 *
 * Ten is roughly twenty minutes of real work — small enough to do on a school
 * night, big enough to move a chapter. A goal a tired student cannot hit is a
 * goal they stop looking at.
 */
export const DAILY_GOAL_QUESTIONS = 10;

export type DailyGoal = {
  target: number;
  done: number;
  /** 0..1, clamped — 14 out of 10 is a full ring, not a broken one. */
  progress: number;
  met: boolean;
};

export function dailyGoal(answeredToday: number, target = DAILY_GOAL_QUESTIONS): DailyGoal {
  const safeTarget = Math.max(1, target);
  const done = Math.max(0, answeredToday);

  return {
    target: safeTarget,
    done,
    progress: Math.min(1, done / safeTarget),
    met: done >= safeTarget,
  };
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

/**
 * The badge set.
 *
 * Each one is a threshold against a number the product already tracks. There
 * are no secret badges and no random drops: a student can see every badge, what
 * it needs, and how close they are — which is the only version of this that
 * doubles as a study plan rather than as a lottery.
 *
 * `glyph` is a character rather than an image so the set stays weightless and
 * works in every locale and text direction.
 */
export type BadgeKey =
  | 'firstSteps'
  | 'tenQuestions'
  | 'fiftyQuestions'
  | 'twoHundredQuestions'
  | 'fiveHundredQuestions'
  | 'weekStreak'
  | 'monthStreak'
  | 'firstChapter'
  | 'fiveChapters'
  | 'firstPaper'
  | 'fivePapers'
  | 'centuryOfCards'
  | 'perfectPaper';

export type BadgeMetric =
  | 'attempts'
  | 'streak'
  | 'chaptersMastered'
  | 'examSimulations'
  | 'flashcardReviews'
  | 'bestPaperRatio';

export type BadgeDefinition = {
  key: BadgeKey;
  metric: BadgeMetric;
  threshold: number;
  glyph: string;
  /** Badges of the same family are shown as one progressing tier. */
  tier: number;
};

export const BADGES: readonly BadgeDefinition[] = [
  { key: 'firstSteps', metric: 'attempts', threshold: 1, glyph: '✦', tier: 1 },
  { key: 'tenQuestions', metric: 'attempts', threshold: 10, glyph: '✎', tier: 2 },
  { key: 'fiftyQuestions', metric: 'attempts', threshold: 50, glyph: '✒', tier: 3 },
  { key: 'twoHundredQuestions', metric: 'attempts', threshold: 200, glyph: '❖', tier: 4 },
  { key: 'fiveHundredQuestions', metric: 'attempts', threshold: 500, glyph: '★', tier: 5 },
  { key: 'weekStreak', metric: 'streak', threshold: 7, glyph: '▲', tier: 1 },
  { key: 'monthStreak', metric: 'streak', threshold: 30, glyph: '⬢', tier: 2 },
  { key: 'firstChapter', metric: 'chaptersMastered', threshold: 1, glyph: '◉', tier: 1 },
  { key: 'fiveChapters', metric: 'chaptersMastered', threshold: 5, glyph: '◈', tier: 2 },
  { key: 'firstPaper', metric: 'examSimulations', threshold: 1, glyph: '▣', tier: 1 },
  { key: 'fivePapers', metric: 'examSimulations', threshold: 5, glyph: '▤', tier: 2 },
  { key: 'centuryOfCards', metric: 'flashcardReviews', threshold: 100, glyph: '◐', tier: 1 },
  // Expressed in percent so the threshold reads the same as the metric.
  { key: 'perfectPaper', metric: 'bestPaperRatio', threshold: 90, glyph: '♔', tier: 1 },
];

/** A chapter counts as mastered at this score, with enough attempts behind it. */
export const CHAPTER_MASTERED_AT = 0.8;

export type BadgeStats = Record<BadgeMetric, number>;

export type BadgeState = BadgeDefinition & {
  earned: boolean;
  /** Current value of the badge's metric. */
  current: number;
  /** 0..1 towards the threshold. */
  progress: number;
};

export function badgeStates(stats: BadgeStats): BadgeState[] {
  return BADGES.map((badge) => {
    const current = Math.max(0, stats[badge.metric] ?? 0);
    return {
      ...badge,
      current,
      earned: current >= badge.threshold,
      progress: Math.min(1, current / badge.threshold),
    };
  });
}

/**
 * The badge to show next: the closest unearned one.
 *
 * "You are three questions from your next badge" is a reason to do three more
 * questions. A wall of locked badges is not.
 */
export function nextBadge(states: BadgeState[]): BadgeState | null {
  const unearned = states.filter((badge) => !badge.earned);
  if (unearned.length === 0) return null;

  return unearned.reduce((closest, badge) => (badge.progress > closest.progress ? badge : closest));
}

// ---------------------------------------------------------------------------
// Session deltas — what a student is told after an action
// ---------------------------------------------------------------------------

/**
 * The smallest description of a student's progress that a client needs.
 *
 * Sent back by the study APIs and diffed against what the page was rendered
 * with, which is why it is deliberately tiny: it rides on the response of every
 * marked attempt, and nobody needs a badge wall serialised onto that.
 */
export type ProgressSummary = {
  xp: number;
  level: number;
  badges: BadgeKey[];
  goalMet: boolean;
  streak: number;
};

export type ProgressEvent =
  | { kind: 'xp'; amount: number }
  | { kind: 'level'; level: number; rank: RankKey }
  | { kind: 'badge'; badge: BadgeKey; glyph: string }
  | { kind: 'goal'; target: number }
  | { kind: 'streak'; days: number };

/**
 * Works out what changed between two snapshots, in the order it should be
 * announced.
 *
 * Ordering matters: XP is the small constant reward and comes first, then the
 * rarer things. Announcing a level-up before the XP that caused it reads as two
 * unrelated events.
 *
 * Only genuine transitions are returned. A student who was already on a 6-day
 * streak yesterday is not told about it again today.
 */
export function progressEvents(
  before: { xp: number; level: number; badges: BadgeKey[]; goalMet: boolean; streak: number },
  after: { xp: number; level: number; badges: BadgeKey[]; goalMet: boolean; streak: number },
  goalTarget = DAILY_GOAL_QUESTIONS,
): ProgressEvent[] {
  const events: ProgressEvent[] = [];

  const gained = after.xp - before.xp;
  if (gained > 0) events.push({ kind: 'xp', amount: gained });

  if (after.level > before.level) {
    events.push({ kind: 'level', level: after.level, rank: rankForLevel(after.level) });
  }

  const known = new Set(before.badges);
  for (const key of after.badges) {
    if (known.has(key)) continue;
    const definition = BADGES.find((badge) => badge.key === key);
    if (definition) events.push({ kind: 'badge', badge: key, glyph: definition.glyph });
  }

  if (after.goalMet && !before.goalMet) events.push({ kind: 'goal', target: goalTarget });
  if (after.streak > before.streak) events.push({ kind: 'streak', days: after.streak });

  return events;
}
