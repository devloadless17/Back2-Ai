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
