import { describe, expect, it } from 'vitest';

import {
  ACADEMIC_TIME_ZONE,
  addDays,
  dayOf,
  daysBetween,
  isValidDay,
  startOfWeek,
  today,
  toStoredDate,
  weekOf,
  weekdayOf,
} from '@/lib/calendar';

/**
 * The date boundary that was wrong.
 *
 * Everything in this product decided "today" from a UTC `Date`. The students
 * are in Lebanon at UTC+2 or +3, so between local midnight and 02:00 or 03:00
 * the product's today was the student's yesterday: the plan showed the wrong
 * day, and the nightly reminder selected sessions against a boundary nobody
 * lived in. These are the cases that were failing.
 */

const at = (iso: string) => new Date(iso);

describe('what day it is in Beirut', () => {
  it('is the same as UTC in the middle of the day', () => {
    expect(today(at('2026-09-17T12:00:00.000Z'))).toBe('2026-09-17');
  });

  it('has already turned over at 23:30 Beirut, which is 20:30 UTC', () => {
    // Summer, UTC+3. Still the 17th in both — the control for the next case.
    expect(today(at('2026-09-17T20:30:00.000Z'))).toBe('2026-09-17');
  });

  it('is TOMORROW once Beirut passes midnight and UTC has not', () => {
    /*
     * The bug, exactly. 22:30 UTC on the 17th is 01:30 on the 18th in Beirut.
     * A student opening the app then is looking at Thursday and was shown
     * Wednesday's plan.
     */
    expect(at('2026-09-17T22:30:00.000Z').toISOString().slice(0, 10)).toBe('2026-09-17');
    expect(today(at('2026-09-17T22:30:00.000Z'))).toBe('2026-09-18');
  });

  it('is tomorrow at 00:30 Beirut in winter too, when the offset is +2', () => {
    // 2026-01-15 22:30Z is 00:30 on the 16th in Beirut at UTC+2.
    expect(today(at('2026-01-15T22:30:00.000Z'))).toBe('2026-01-16');
  });

  it('crosses a month boundary correctly', () => {
    expect(today(at('2026-09-30T22:30:00.000Z'))).toBe('2026-10-01');
  });

  it('crosses a year boundary correctly', () => {
    expect(today(at('2026-12-31T22:30:00.000Z'))).toBe('2027-01-01');
  });

  it('uses the IANA zone rather than a fixed offset, so DST is handled', () => {
    /*
     * Not an offset constant. Lebanon has changed its clocks at short notice
     * before, and an offset baked into the source would have to be chased.
     * Winter and summer differ here by an hour, which only a real zone knows.
     */
    expect(ACADEMIC_TIME_ZONE).toBe('Asia/Beirut');
    const winter = today(at('2026-01-15T21:30:00.000Z')); // 23:30 local, +2
    const summer = today(at('2026-07-15T21:30:00.000Z')); // 00:30 next day, +3
    expect(winter).toBe('2026-01-15');
    expect(summer).toBe('2026-07-16');
  });
});

describe('reading a day that is already stored', () => {
  it('does NOT shift a stored DATE into Beirut', () => {
    /*
     * The opposite mistake, and just as wrong. A DATE column round-trips as
     * midnight UTC; the zone is encoding, not meaning. Formatting it in Beirut
     * would still read the same day here, but treating it as an instant and
     * converting it is how a session silently moves. UTC getters, always.
     */
    expect(dayOf(at('2026-09-17T00:00:00.000Z'))).toBe('2026-09-17');
  });

  it('round-trips through the value handed to Prisma', () => {
    expect(dayOf(toStoredDate('2026-09-17'))).toBe('2026-09-17');
    expect(toStoredDate('2026-09-17').toISOString()).toBe('2026-09-17T00:00:00.000Z');
  });

  it('refuses something that is not a day', () => {
    expect(() => toStoredDate('17/09/2026')).toThrow();
    expect(isValidDay('2026-09-17')).toBe(true);
    expect(isValidDay('2026-13-01')).toBe(false);
    expect(isValidDay('not-a-date')).toBe(false);
  });
});

describe('day arithmetic', () => {
  it('adds and subtracts across a month boundary', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-10-01', -1)).toBe('2026-09-30');
  });

  it('handles a leap day', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2028-02-29', 1)).toBe('2028-03-01');
  });

  it('counts days between, signed', () => {
    expect(daysBetween('2026-09-17', '2026-09-26')).toBe(9);
    expect(daysBetween('2026-09-26', '2026-09-17')).toBe(-9);
    expect(daysBetween('2026-09-17', '2026-09-17')).toBe(0);
  });

  it('is not thrown off by a DST transition inside the range', () => {
    // Arithmetic runs on UTC midnights, so a clock change cannot produce a
    // 23- or 25-hour day and round to the wrong number.
    expect(daysBetween('2026-03-25', '2026-04-05')).toBe(11);
    expect(daysBetween('2026-10-20', '2026-11-05')).toBe(16);
  });
});

describe('the study week', () => {
  it('starts on Monday', () => {
    // 2026-09-17 is a Thursday.
    expect(weekdayOf('2026-09-17')).toBe(4);
    expect(startOfWeek('2026-09-17')).toBe('2026-09-14');
  });

  it('puts Sunday at the END of its week, not the start of the next', () => {
    // The trap in every hand-rolled week calculation. Sunday is weekday 0, so
    // the naive `day - weekday` sends it forward six days.
    expect(weekdayOf('2026-09-20')).toBe(0);
    expect(startOfWeek('2026-09-20')).toBe('2026-09-14');
  });

  it('gives seven consecutive days, Monday first', () => {
    const week = weekOf('2026-09-17');
    expect(week).toHaveLength(7);
    expect(week[0]).toBe('2026-09-14');
    expect(week[6]).toBe('2026-09-20');
  });

  it('spans a month boundary without a gap', () => {
    const week = weekOf('2026-10-01');
    expect(week[0]).toBe('2026-09-28');
    expect(week[6]).toBe('2026-10-04');
  });
});
