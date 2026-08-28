import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MAX_DAILY_MINUTES,
  EXAM_DRILL_WINDOW_DAYS,
  MAX_CHAPTERS_PER_DAY,
  MAX_HORIZON_DAYS,
  REVIEW_GAP_DAYS,
  TASK_MINUTES,
  buildPlan,
  chapterWeight,
  dailyCapacity,
  horizonDays,
  pickTaskType,
  toDateKey,
  type PlannerChapter,
} from '@/lib/planner';

const FROM = new Date('2026-08-17T00:00:00.000Z');

function chapter(over: Partial<PlannerChapter> = {}): PlannerChapter {
  return {
    chapterId: over.chapterId ?? 'c1',
    chapterName: over.chapterName ?? 'Dérivées',
    subjectName: over.subjectName ?? 'Mathematics',
    masteryScore: over.masteryScore ?? 0.2,
    attemptsCount: over.attemptsCount ?? 10,
    dueFlashcards: over.dueFlashcards,
  };
}

describe('horizonDays', () => {
  it('plans two weeks when no exam date is known', () => {
    expect(horizonDays(FROM, null)).toBe(14);
  });

  it('plans up to the exam', () => {
    expect(horizonDays(FROM, new Date('2026-08-27T00:00:00.000Z'))).toBe(10);
  });

  it('caps a distant exam rather than planning the whole year', () => {
    expect(horizonDays(FROM, new Date('2027-06-01T00:00:00.000Z'))).toBe(MAX_HORIZON_DAYS);
  });

  it('returns nothing once the exam has passed', () => {
    expect(horizonDays(FROM, new Date('2026-08-01T00:00:00.000Z'))).toBe(0);
  });
});

describe('chapterWeight', () => {
  it('weights a weaker chapter above a stronger one', () => {
    expect(chapterWeight(chapter({ masteryScore: 0.1 }))).toBeGreaterThan(
      chapterWeight(chapter({ masteryScore: 0.5 })),
    );
  });

  it('drops chapters at or above the weakness ceiling', () => {
    expect(chapterWeight(chapter({ masteryScore: 0.7 }))).toBe(0);
    expect(chapterWeight(chapter({ masteryScore: 0.95 }))).toBe(0);
  });

  it('halves the weight of a chapter with too little evidence', () => {
    const thin = chapterWeight(chapter({ masteryScore: 0.2, attemptsCount: 2 }));
    const solid = chapterWeight(chapter({ masteryScore: 0.2, attemptsCount: 10 }));
    expect(thin).toBeCloseTo(solid / 2);
  });

  it('prefers evidenced mediocrity over unevidenced disaster', () => {
    const noisy = chapterWeight(chapter({ masteryScore: 0.2, attemptsCount: 2 }));
    const known = chapterWeight(chapter({ masteryScore: 0.55, attemptsCount: 20 }));
    expect(known).toBeGreaterThan(noisy);
  });
});

describe('buildPlan', () => {
  it('says nothing when every chapter is already strong', () => {
    const plan = buildPlan({
      chapters: [chapter({ masteryScore: 0.9 }), chapter({ chapterId: 'c2', masteryScore: 0.8 })],
      examDate: null,
      from: FROM,
    });
    expect(plan).toEqual([]);
  });

  it('returns nothing once the exam has passed', () => {
    const plan = buildPlan({
      chapters: [chapter()],
      examDate: new Date('2026-08-01T00:00:00.000Z'),
      from: FROM,
    });
    expect(plan).toEqual([]);
  });

  it('never exceeds the daily ceiling', () => {
    const plan = buildPlan({
      chapters: [
        chapter({ chapterId: 'a', masteryScore: 0.1 }),
        chapter({ chapterId: 'b', masteryScore: 0.2 }),
        chapter({ chapterId: 'c', masteryScore: 0.3 }),
        chapter({ chapterId: 'd', masteryScore: 0.4 }),
      ],
      examDate: null,
      from: FROM,
      maxDailyMinutes: 90,
    });

    const perDay = new Map<string, number>();
    for (const session of plan) {
      perDay.set(session.scheduledDate, (perDay.get(session.scheduledDate) ?? 0) + session.durationMinutes);
    }
    for (const minutes of perDay.values()) expect(minutes).toBeLessThanOrEqual(90);
  });

  it('gives every session the length its activity calls for', () => {
    const plan = buildPlan({
      chapters: [chapter({ masteryScore: 0.1 })],
      examDate: new Date('2026-09-14T00:00:00.000Z'),
      from: FROM,
    });
    expect(plan.length).toBeGreaterThan(0);
    for (const session of plan) {
      expect(session.durationMinutes).toBe(TASK_MINUTES[session.taskType]);
    }
  });

  it('does not put more than the chapter ceiling on one day', () => {
    const plan = buildPlan({
      chapters: Array.from({ length: 8 }, (_, i) =>
        chapter({ chapterId: `c${i}`, chapterName: `Chapter ${i}`, masteryScore: 0.2 }),
      ),
      examDate: new Date('2026-09-14T00:00:00.000Z'),
      from: FROM,
    });

    const perDay = new Map<string, Set<string>>();
    for (const session of plan) {
      const set = perDay.get(session.scheduledDate) ?? new Set<string>();
      set.add(session.chapterId);
      perDay.set(session.scheduledDate, set);
    }
    for (const set of perDay.values()) expect(set.size).toBeLessThanOrEqual(MAX_CHAPTERS_PER_DAY);
  });

  it('gives the weakest chapter the most time', () => {
    const plan = buildPlan({
      chapters: [
        chapter({ chapterId: 'weak', masteryScore: 0.05 }),
        chapter({ chapterId: 'ok', masteryScore: 0.6 }),
      ],
      examDate: new Date('2026-09-14T00:00:00.000Z'),
      from: FROM,
    });

    const minutes = (id: string) =>
      plan.filter((s) => s.chapterId === id).reduce((sum, s) => sum + s.durationMinutes, 0);

    expect(minutes('weak')).toBeGreaterThan(minutes('ok'));
  });

  it('leads with the weakest chapter rather than saving it for later', () => {
    const plan = buildPlan({
      chapters: [
        chapter({ chapterId: 'ok', masteryScore: 0.6 }),
        chapter({ chapterId: 'weak', masteryScore: 0.05 }),
      ],
      examDate: new Date('2026-09-14T00:00:00.000Z'),
      from: FROM,
    });
    expect(plan[0]?.chapterId).toBe('weak');
  });

  it('plans around days the student already has work on', () => {
    const busy = new Set([toDateKey(FROM), toDateKey(new Date('2026-08-18T00:00:00.000Z'))]);
    const plan = buildPlan({
      chapters: [chapter({ masteryScore: 0.1 })],
      examDate: new Date('2026-09-14T00:00:00.000Z'),
      from: FROM,
      busyDates: busy,
    });
    for (const session of plan) expect(busy.has(session.scheduledDate)).toBe(false);
  });

  it('rotates subjects instead of spending days on one', () => {
    // Every chapter untouched, so every weight ties — the case that produced
    // eighteen consecutive days of one subject before subjects were interleaved.
    const chapters = ['Arabic', 'Mathematics', 'Physics'].flatMap((subjectName) =>
      Array.from({ length: 6 }, (_, i) =>
        chapter({
          chapterId: `${subjectName}-${i}`,
          chapterName: `Chapter ${i}`,
          subjectName,
          masteryScore: 0,
          attemptsCount: 0,
        }),
      ),
    );

    const plan = buildPlan({
      chapters,
      examDate: new Date('2026-09-14T00:00:00.000Z'),
      from: FROM,
      maxDailyMinutes: 90,
    });

    // Consecutive sessions rotate subjects — whether they land on the same day
    // or successive ones depends on session length against the daily cap.
    const subjects = plan.map((s) => s.title.split(' — ')[0]);
    expect(new Set(subjects.slice(0, 3)).size).toBe(3);

    // And no subject is starved out of the front of the plan.
    expect(new Set(subjects.slice(0, 9)).size).toBe(3);
  });

  it('titles a session so a student can read it without opening it', () => {
    const plan = buildPlan({
      chapters: [chapter({ subjectName: 'Mathematics', chapterName: 'Dérivées' })],
      examDate: null,
      from: FROM,
      maxDailyMinutes: DEFAULT_MAX_DAILY_MINUTES,
    });
    expect(plan[0]?.title).toBe('Mathematics — Dérivées');
  });
});

describe('dailyCapacity', () => {
  it('is flat when no exam is known', () => {
    expect(dailyCapacity(FROM, null, 120)).toBe(120);
  });

  it('is flat while the exam is still distant', () => {
    expect(dailyCapacity(FROM, new Date('2026-12-01T00:00:00.000Z'), 120)).toBe(120);
  });

  it('ramps up as the exam approaches', () => {
    const far = dailyCapacity(FROM, new Date('2026-08-29T00:00:00.000Z'), 120);
    const near = dailyCapacity(FROM, new Date('2026-08-20T00:00:00.000Z'), 120);
    expect(near).toBeGreaterThan(far);
  });
});

describe('pickTaskType', () => {
  it('clears due cards first — they expire if ignored', () => {
    const picked = pickTaskType(chapter({ dueFlashcards: 8, attemptsCount: 20 }), FROM, null);
    expect(picked.taskType).toBe('flashcards');
    expect(picked.rationale).toContain('8 cards due');
  });

  it('quizzes a chapter with too little evidence rather than judging it', () => {
    expect(pickTaskType(chapter({ attemptsCount: 0 }), FROM, null).taskType).toBe('quiz');
    expect(pickTaskType(chapter({ attemptsCount: 2 }), FROM, null).taskType).toBe('quiz');
  });

  it('switches to full drills once the exam is close', () => {
    const soon = new Date(FROM.getTime() + (EXAM_DRILL_WINDOW_DAYS - 2) * 86_400_000);
    expect(pickTaskType(chapter({ attemptsCount: 20 }), FROM, soon).taskType).toBe('exam_drill');
  });

  it('explains itself in one line', () => {
    const picked = pickTaskType(chapter({ masteryScore: 0.12, attemptsCount: 20 }), FROM, null);
    expect(picked.rationale).toContain('12%');
  });
});

describe('buildPlan — enhanced behaviour', () => {
  it('mixes activities rather than scheduling identical blocks', () => {
    const plan = buildPlan({
      chapters: [
        chapter({ chapterId: 'a', attemptsCount: 0 }),
        chapter({ chapterId: 'b', attemptsCount: 20, dueFlashcards: 6, subjectName: 'Physics' }),
      ],
      examDate: new Date('2026-09-14T00:00:00.000Z'),
      from: FROM,
    });
    expect(new Set(plan.map((s) => s.taskType)).size).toBeGreaterThan(1);
  });

  it('schedules a spaced review after a chapter is first covered', () => {
    const plan = buildPlan({
      chapters: [chapter({ masteryScore: 0.1, attemptsCount: 20 })],
      examDate: new Date('2026-09-14T00:00:00.000Z'),
      from: FROM,
    });
    const reviews = plan.filter((s) => s.taskType === 'review');
    expect(reviews.length).toBeGreaterThan(0);
  });

  it('keeps one rest day a week', () => {
    const plan = buildPlan({
      chapters: [chapter({ masteryScore: 0.1 })],
      examDate: new Date('2026-09-14T00:00:00.000Z'),
      from: FROM,
      restWeekday: 0,
    });
    for (const session of plan) {
      expect(new Date(`${session.scheduledDate}T00:00:00.000Z`).getUTCDay()).not.toBe(0);
    }
  });

  it('gives every session a reason the student can read', () => {
    const plan = buildPlan({
      chapters: [chapter({ masteryScore: 0.1 })],
      examDate: new Date('2026-09-14T00:00:00.000Z'),
      from: FROM,
    });
    for (const session of plan) expect(session.rationale.length).toBeGreaterThan(0);
  });
});

describe('the exam decides what, not only how much', () => {
  const EXAM = new Date('2026-08-26T00:00:00.000Z'); // nine days out from FROM

  /** Maya: strongest at the subject she sits next, unpractised at three others. */
  function mayasChapters(): PlannerChapter[] {
    return [
      chapter({ chapterId: 'ls1', chapterName: 'Hormones', subjectName: 'Life Sciences', masteryScore: 0.55, attemptsCount: 20 }),
      chapter({ chapterId: 'ls2', chapterName: 'Reproduction', subjectName: 'Life Sciences', masteryScore: 0.5, attemptsCount: 18 }),
      chapter({ chapterId: 'fr1', chapterName: 'Sous-theme 1', subjectName: 'Francais', masteryScore: 0, attemptsCount: 0 }),
      chapter({ chapterId: 'ge1', chapterName: 'Le monde', subjectName: 'Geographie', masteryScore: 0, attemptsCount: 0 }),
      chapter({ chapterId: 'hi1', chapterName: 'La guerre', subjectName: 'Histoire', masteryScore: 0, attemptsCount: 0 }),
    ];
  }

  it('ranks the examined subject above an unpractised one when the paper is close', () => {
    const focus = { subjectName: 'Life Sciences', daysOut: 9 };
    const examined = chapter({ subjectName: 'Life Sciences', masteryScore: 0.55, attemptsCount: 20 });
    const stranger = chapter({ subjectName: 'Geographie', masteryScore: 0, attemptsCount: 0 });
    expect(chapterWeight(examined, focus)).toBeGreaterThan(chapterWeight(stranger, focus));
    // ...and does not, once the same paper is a term away.
    const far = { subjectName: 'Life Sciences', daysOut: 90 };
    expect(chapterWeight(examined, far)).toBeLessThan(chapterWeight(stranger, far));
  });

  it('still drops a mastered chapter, unless its paper is days away', () => {
    const known = chapter({ subjectName: 'Life Sciences', masteryScore: 0.95, attemptsCount: 30 });
    expect(chapterWeight(known, null)).toBe(0);
    expect(chapterWeight(known, { subjectName: 'Life Sciences', daysOut: 3 })).toBeGreaterThan(0);
  });

  it('puts the examined subject in the plan at all', () => {
    const without = buildPlan({ chapters: mayasChapters(), examDate: EXAM, from: FROM });
    const withFocus = buildPlan({
      chapters: mayasChapters(), examDate: EXAM, from: FROM, examSubject: 'Life Sciences',
    });
    const share = (p: ReturnType<typeof buildPlan>) =>
      p.filter((s) => s.title.startsWith('Life Sciences')).length / Math.max(p.length, 1);

    expect(withFocus.length).toBeGreaterThan(0);
    expect(share(withFocus)).toBeGreaterThan(share(without));
    // Day one is the one a student actually sees.
    const firstDay = withFocus.filter((s) => s.scheduledDate === withFocus[0]!.scheduledDate);
    expect(firstDay.some((s) => s.title.startsWith('Life Sciences'))).toBe(true);
  });

  it('never lets the examined subject monopolise the plan', () => {
    const plan = buildPlan({
      chapters: mayasChapters(), examDate: EXAM, from: FROM, examSubject: 'Life Sciences',
    });
    const subjects = new Set(plan.map((s) => s.title.split(' — ')[0]));
    // Eighteen consecutive days of one subject is the failure the interleave
    // exists to prevent; focusing the exam must not reintroduce it.
    expect(subjects.size).toBeGreaterThan(1);
  });
});
