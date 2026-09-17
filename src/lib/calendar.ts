/**
 * Academic calendar days.
 *
 * THE BUG THIS EXISTS TO FIX. A study session's `scheduled_date` is a Postgres
 * `DATE`. It is a calendar day — "the seventeenth of September" — not an
 * instant. Everything in this product decided which day that was by asking a
 * UTC `Date` for its UTC year, month and day. The students are in Lebanon,
 * which is UTC+2 in winter and UTC+3 in summer, so between local midnight and
 * 02:00 or 03:00 the product's "today" was still the student's yesterday. A
 * student opening the app at 00:30 on Thursday was shown Wednesday's plan, and
 * the nightly reminder job selected sessions against a UTC day boundary that
 * had nothing to do with anyone's morning.
 *
 * TWO OPERATIONS, ROUTINELY CONFLATED, AND THAT CONFLATION WAS THE BUG.
 *
 *   1. Deciding what today IS. That depends on where the student is, and the
 *      answer is Beirut. `today()`.
 *
 *   2. Reading a day that is already stored. A `DATE` column round-trips
 *      through Prisma as UTC midnight of that day — the timezone carries no
 *      meaning, it is just how a date is encoded. Reading it must use UTC
 *      getters, and shifting it into Beirut would move it backwards a day.
 *      `dayOf()`.
 *
 * Using Beirut for the second, or UTC for the first, is wrong in opposite
 * directions. Both mistakes were present.
 *
 * WHY BEIRUT AND NOT THE BROWSER. This is a product about one national exam,
 * sat on published dates in one country. "Today's session" and "nine days
 * until the paper" are facts about the Lebanese school calendar, and they must
 * not change because a student opened the app from a holiday abroad, or
 * because Vercel executes a cron in UTC. Where a genuinely device-local
 * reading is wanted, that is a separate decision and must be taken
 * deliberately — not inherited from an unqualified `new Date()`.
 *
 * DST is handled by the IANA database through `Intl`, not by an offset
 * constant. Lebanon has moved its clocks at short notice before.
 */

/** `YYYY-MM-DD`. A day, with no time and no zone. */
export type CalendarDay = string;

/**
 * The timezone the Lebanese Baccalaureate is sat in.
 *
 * One constant, referenced everywhere, so that this is a decision with a name
 * rather than an assumption spread across forty files.
 */
export const ACADEMIC_TIME_ZONE = 'Asia/Beirut';

/*
 * `en-CA` formats as YYYY-MM-DD, which is the shape we want, and the formatter
 * is built once because constructing one is not cheap and these run per row.
 */
const beirutDay = new Intl.DateTimeFormat('en-CA', {
  timeZone: ACADEMIC_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const DAY_MS = 86_400_000;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** What day it is in Beirut right now. */
export function today(now: Date = new Date()): CalendarDay {
  return beirutDay.format(now);
}

/**
 * The calendar day a stored `DATE` represents.
 *
 * UTC getters on purpose — see the header. The value came out of a column that
 * holds no time, and Prisma hands it back as midnight UTC.
 */
export function dayOf(stored: Date): CalendarDay {
  return stored.toISOString().slice(0, 10);
}

/**
 * The `Date` to hand Prisma when querying or writing a `DATE` column.
 *
 * Midnight UTC, matching how Postgres round-trips the type. Comparing a `DATE`
 * against a Beirut-offset instant is how a `gte: today` filter silently starts
 * excluding today.
 */
export function toStoredDate(day: CalendarDay): Date {
  assertDay(day);
  return new Date(`${day}T00:00:00.000Z`);
}

export function addDays(day: CalendarDay, days: number): CalendarDay {
  return dayOf(new Date(toStoredDate(day).getTime() + days * DAY_MS));
}

/** Whole days from `from` to `to`. Negative when `to` is earlier. */
export function daysBetween(from: CalendarDay, to: CalendarDay): number {
  return Math.round((toStoredDate(to).getTime() - toStoredDate(from).getTime()) / DAY_MS);
}

/** 0 = Sunday. Independent of any timezone once the day is known. */
export function weekdayOf(day: CalendarDay): number {
  return toStoredDate(day).getUTCDay();
}

/**
 * The Monday of the week containing `day`.
 *
 * Monday because the Lebanese school week starts there. The weekend is not
 * symmetric in this product either — the planner's default rest day is Sunday.
 */
export function startOfWeek(day: CalendarDay): CalendarDay {
  const weekday = weekdayOf(day);
  // Sunday (0) belongs to the week that began six days earlier, not the one
  // starting tomorrow.
  const back = weekday === 0 ? 6 : weekday - 1;
  return addDays(day, -back);
}

/** The seven days of the week containing `day`, Monday first. */
export function weekOf(day: CalendarDay): CalendarDay[] {
  const monday = startOfWeek(day);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

export function isValidDay(value: string): boolean {
  if (!DAY_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function assertDay(day: CalendarDay): void {
  if (!DAY_PATTERN.test(day)) {
    throw new Error(`Not a calendar day: ${day}`);
  }
}
