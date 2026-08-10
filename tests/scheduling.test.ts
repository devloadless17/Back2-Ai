import { describe, expect, it } from 'vitest';

import { buildStudyPlan, toIso } from '@/lib/scheduling';

const TODAY = new Date('2026-06-01T09:00:00.000Z');
const EXAM = new Date('2026-06-15T00:00:00.000Z');

const CHAPTERS = [
  { chapterId: 'strong', chapterName: 'Strong', masteryScore: 0.9, attemptsCount: 20 },
  { chapterId: 'weak', chapterName: 'Weak', masteryScore: 0.2, attemptsCount: 20 },
  { chapterId: 'untouched', chapterName: 'Untouched', masteryScore: 0, attemptsCount: 0 },
];

function plan(overrides: Partial<Parameters<typeof buildStudyPlan>[0]> = {}) {
  return buildStudyPlan({
    examDate: EXAM,
    today: TODAY,
    chapters: CHAPTERS,
    flashcardDueDates: [],
    busyDates: [],
    ...overrides,
  });
}

describe('buildStudyPlan', () => {
  it('returns nothing when the exam is tomorrow', () => {
    expect(
      plan({ examDate: new Date('2026-06-02T00:00:00.000Z') }),
    ).toEqual([]);
  });

  it('returns nothing when there is no syllabus to plan', () => {
    expect(plan({ chapters: [] })).toEqual([]);
  });

  it('never schedules on or after the exam date', () => {
    for (const session of plan()) {
      expect(session.scheduledDate < toIso(EXAM)).toBe(true);
    }
  });

  it('never schedules in the past', () => {
    for (const session of plan()) {
      expect(session.scheduledDate > toIso(TODAY)).toBe(true);
    }
  });

  it('gives weak and untouched chapters more time than strong ones', () => {
    const sessions = plan();
    const count = (id: string) => sessions.filter((s) => s.chapterId === id && s.rationale !== 'consolidate').length;

    expect(count('untouched')).toBeGreaterThan(count('strong'));
    expect(count('weak')).toBeGreaterThan(count('strong'));
  });

  it('opens untouched chapters early rather than leaving them to the end', () => {
    const sessions = plan().filter((s) => s.rationale === 'uncovered');
    expect(sessions.length).toBeGreaterThan(0);

    const firstUncovered = sessions[0]!.scheduledDate;
    const lastDay = plan().at(-1)!.scheduledDate;
    expect(firstUncovered < lastDay).toBe(true);
  });

  it('turns the last days before the exam into consolidation', () => {
    const sessions = plan();
    const lastDay = sessions.at(-1)!.scheduledDate;
    const finalDaySessions = sessions.filter((s) => s.scheduledDate === lastDay);

    expect(finalDaySessions.every((s) => s.rationale === 'consolidate')).toBe(true);
  });

  it('works around days that already have flashcards due instead of over-filling them', () => {
    const busyDay = '2026-06-05';
    const sessions = plan({ flashcardDueDates: [busyDay] });
    const onBusyDay = sessions.filter((s) => s.scheduledDate === busyDay);

    expect(onBusyDay.some((s) => s.rationale === 'flashcards')).toBe(true);
    expect(onBusyDay.length).toBeLessThanOrEqual(2);
  });

  it('leaves room on days the student has already booked themselves', () => {
    const bookedDay = '2026-06-06';
    const sessions = plan({ busyDates: [bookedDay] });
    const onBookedDay = sessions.filter((s) => s.scheduledDate === bookedDay);

    expect(onBookedDay.length).toBeLessThanOrEqual(1);
  });

  it('does not put the same chapter in consecutive slots for a whole week', () => {
    const sessions = plan().filter((s) => s.rationale !== 'consolidate' && s.chapterId);
    let runs = 0;
    for (let i = 1; i < sessions.length; i += 1) {
      if (sessions[i]!.chapterId === sessions[i - 1]!.chapterId) runs += 1;
    }
    // Some repetition is fine; a plan that is one chapter for six days is not.
    expect(runs).toBeLessThan(sessions.length / 2);
  });
});
