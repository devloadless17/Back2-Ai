import 'server-only';

import { db } from '@/lib/db';

/**
 * Day-by-day activity, for the dashboard's habit strip and streak.
 *
 * Counted from `attempts`, which means it counts work that was actually
 * assessed. Opening a chapter and reading it does not appear here, and neither
 * does old-cycle mode — that surface writes no attempt rows by design. A streak
 * that could be kept alive by opening the app would be worth nothing.
 *
 * Days are bucketed in UTC, matching every other date boundary in the product
 * (`startOfToday`, flashcard due dates). A student in Beirut therefore rolls
 * over at 02:00 or 03:00 local rather than at midnight — the alternative is to
 * make every one of those boundaries timezone-aware together, which is a change
 * worth making deliberately rather than here.
 */

export type ActivityDay = { date: Date; count: number };

export async function attemptsByDay(userId: string, days = 14): Promise<ActivityDay[]> {
  const span = Math.max(1, Math.min(90, days));
  const from = startOfUtcDay(new Date());
  from.setUTCDate(from.getUTCDate() - (span - 1));

  // The day comes back as a 'YYYY-MM-DD' string rather than a timestamp.
  // Bucketing and matching on text keeps the driver's timezone handling out of
  // it entirely: a timestamp round-tripped through JS can land on the previous
  // day west of UTC, which would silently shift every column in the strip.
  const rows = await db.$queryRaw<{ day: string; count: bigint }[]>`
    SELECT to_char(attempted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS "day",
           COUNT(*)                                               AS "count"
    FROM attempts
    WHERE user_id = ${userId}::uuid
      AND attempted_at >= ${from}
    GROUP BY 1
    ORDER BY 1
  `;

  const counts = new Map(rows.map((row) => [row.day, Number(row.count)]));

  // Every day in the window is returned, including the empty ones. A strip that
  // silently omits quiet days would compress a fortnight of two sessions into
  // something that looks like a fortnight of work.
  return Array.from({ length: span }, (_, index) => {
    const date = new Date(from);
    date.setUTCDate(from.getUTCDate() + index);
    return { date, count: counts.get(utcDayKey(date)) ?? 0 };
  });
}

/** 'YYYY-MM-DD' in UTC — the same key shape the query groups by. */
function utcDayKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/**
 * Consecutive days ending today, or ending yesterday if nothing has been done
 * yet today.
 *
 * The grace day is the point: at 9am a student has done nothing today, and
 * telling them their six-day streak is over before the day has started is both
 * wrong and the kind of thing that makes people close the app.
 */
export function streakFrom(activity: ActivityDay[]): number {
  if (activity.length === 0) return 0;

  const days = [...activity].sort((a, b) => b.date.getTime() - a.date.getTime());
  let streak = 0;

  for (const [index, day] of days.entries()) {
    if (day.count > 0) {
      streak += 1;
      continue;
    }
    // Today with nothing done yet does not break the run; any other empty day
    // does.
    if (index === 0) continue;
    break;
  }

  return streak;
}

function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

/**
 * What the last seven days actually produced.
 *
 * The dashboard hero prints three figures a student recognises: how many
 * questions they answered this week, how much of it they got right, and how
 * many chapters are currently flagged weak. The third is derived from progress
 * the page already has; these two are the ones that need the database.
 *
 * `accuracy` is deliberately nullable. Marks are the honest denominator when
 * they exist — a barème-marked answer worth 3 of 4 is not "wrong" — so the
 * ratio prefers `score / max_score` and only falls back to counting right and
 * wrong answers where no barème was involved. With neither, it returns null and
 * the hero prints that we cannot say yet, rather than printing 0% at a student
 * who has done nothing to be 0% at.
 */
export type WeeklyEffort = {
  /** Attempts in the window, whatever their outcome. */
  answered: number;
  /** 0–1, or null when nothing in the window carries a verdict. */
  accuracy: number | null;
};

export async function weeklyEffort(userId: string, days = 7): Promise<WeeklyEffort> {
  const span = Math.max(1, Math.min(90, days));
  const from = startOfUtcDay(new Date());
  from.setUTCDate(from.getUTCDate() - (span - 1));

  const [row] = await db.$queryRaw<
    { answered: number; scored: string; available: string; correct: number; judged: number }[]
  >`
    SELECT COUNT(*)::int                                                  AS "answered",
           COALESCE(SUM(score)     FILTER (WHERE max_score > 0), 0)::text AS "scored",
           COALESCE(SUM(max_score) FILTER (WHERE max_score > 0), 0)::text AS "available",
           COUNT(*) FILTER (WHERE is_correct IS TRUE)::int                AS "correct",
           COUNT(*) FILTER (WHERE is_correct IS NOT NULL)::int            AS "judged"
    FROM attempts
    WHERE user_id = ${userId}::uuid
      AND attempted_at >= ${from}
  `;

  if (!row) return { answered: 0, accuracy: null };

  const available = Number(row.available);
  if (available > 0) {
    return { answered: row.answered, accuracy: clamp01(Number(row.scored) / available) };
  }
  if (row.judged > 0) {
    return { answered: row.answered, accuracy: clamp01(row.correct / row.judged) };
  }
  return { answered: row.answered, accuracy: null };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
