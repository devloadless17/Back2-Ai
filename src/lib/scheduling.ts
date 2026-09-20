import 'server-only';

import { z } from 'zod';

import { ai } from '@/lib/ai';
import { db } from '@/lib/db';
import { isAiConfigured } from '@/lib/env';
import type { Locale } from '@/lib/i18n/config';
import { MIN_ATTEMPTS_FOR_WEAKNESS } from '@/lib/scoring/mastery';
import { LIVE_CHAPTER } from '@/lib/queries/taxonomy';

/**
 * Suggested revision plan for one upcoming exam.
 *
 * The allocation is deterministic. That is a deliberate choice: a student can
 * be told exactly why a chapter got three sessions and another got one, and the
 * rule can be tested without a model in the loop. The model is used only to
 * phrase each session — "Revise integration by parts, then two past questions"
 * reads like a plan; "Session 4 — Calcul intégral" reads like a spreadsheet.
 *
 * Nothing here writes to the database. The plan is returned for the student to
 * accept, edit or discard, per the exec plan — a schedule that appears in
 * someone's calendar uninvited is not a suggestion.
 */

/** Sessions per day. More than two is a plan nobody follows. */
const SESSIONS_PER_DAY = 2;

/** Days before the exam that switch from new work to consolidation. */
const CONSOLIDATION_TAIL_DAYS = 3;

const DEFAULT_SESSION_MINUTES = 60;

export type PlannedSession = {
  chapterId: string | null;
  chapterName: string | null;
  title: string;
  scheduledDate: string;
  durationMinutes: number;
  /** Why this session is here, shown to the student under the row. */
  rationale: 'weak' | 'uncovered' | 'consolidate' | 'flashcards';
};

export type PlanInput = {
  examDate: Date;
  today: Date;
  chapters: {
    chapterId: string;
    chapterName: string;
    masteryScore: number;
    attemptsCount: number;
  }[];
  /** Days (ISO date strings) that already have flashcards due, so the plan works around them. */
  flashcardDueDates: string[];
  /** Days that already have a session the student created, so nothing is double-booked. */
  busyDates: string[];
};

/**
 * Priority for a chapter, higher first.
 *
 *   * Never attempted    → highest. An untouched chapter is the biggest risk on
 *                          the paper and the plan must open it early.
 *   * Attempted, weak    → high, scaled by how weak.
 *   * Attempted, strong  → low; it earns a light review near the end instead.
 */
function priorityOf(chapter: PlanInput['chapters'][number]): number {
  if (chapter.attemptsCount === 0) return 1.5;
  const confidence = Math.min(1, chapter.attemptsCount / MIN_ATTEMPTS_FOR_WEAKNESS);
  return (1 - chapter.masteryScore) * (0.5 + 0.5 * confidence);
}

export function buildStudyPlan(input: PlanInput): PlannedSession[] {
  const days = availableDays(input.today, input.examDate);
  if (days.length === 0 || input.chapters.length === 0) return [];

  const ranked = [...input.chapters]
    .map((chapter) => ({ chapter, priority: priorityOf(chapter) }))
    .sort((a, b) => b.priority - a.priority);

  const totalPriority = ranked.reduce((sum, r) => sum + r.priority, 0);
  const totalSlots = Math.max(1, days.length * SESSIONS_PER_DAY);

  // Proportional allocation, with every chapter guaranteed at least one slot
  // while slots remain — an untouched chapter getting zero sessions would be
  // the plan quietly writing that chapter off.
  const allocations = ranked.map((entry) => ({
    ...entry,
    slots:
      totalPriority === 0
        ? 1
        : Math.max(1, Math.round((entry.priority / totalPriority) * totalSlots)),
  }));

  const queue: { chapter: PlanInput['chapters'][number]; rationale: PlannedSession['rationale'] }[] = [];
  for (const allocation of allocations) {
    for (let i = 0; i < allocation.slots; i += 1) {
      queue.push({
        chapter: allocation.chapter,
        rationale: allocation.chapter.attemptsCount === 0 ? 'uncovered' : 'weak',
      });
    }
  }

  // Interleave so consecutive sessions are not the same chapter for a week.
  const interleaved = interleaveByChapter(queue);

  const flashcardDays = new Set(input.flashcardDueDates);
  const busyDays = new Set(input.busyDates);
  const sessions: PlannedSession[] = [];

  const consolidationStart = Math.max(0, days.length - CONSOLIDATION_TAIL_DAYS);
  let cursor = 0;

  for (const [dayIndex, day] of days.entries()) {
    const iso = toIso(day);
    const isConsolidation = dayIndex >= consolidationStart;

    // A day that already has the student's own session gets one slot, not two.
    let slotsToday = busyDays.has(iso) ? SESSIONS_PER_DAY - 1 : SESSIONS_PER_DAY;
    if (flashcardDays.has(iso)) {
      // Flashcards already occupy part of this day; don't schedule over them.
      slotsToday -= 1;
      sessions.push({
        chapterId: null,
        chapterName: null,
        title: '',
        scheduledDate: iso,
        durationMinutes: 20,
        rationale: 'flashcards',
      });
    }

    for (let slot = 0; slot < slotsToday; slot += 1) {
      if (isConsolidation) {
        // The last days are for going back over the strongest work, not for
        // opening a chapter for the first time.
        const strongest = ranked[ranked.length - 1 - ((dayIndex + slot) % ranked.length)];
        if (!strongest) continue;
        sessions.push({
          chapterId: strongest.chapter.chapterId,
          chapterName: strongest.chapter.chapterName,
          title: '',
          scheduledDate: iso,
          durationMinutes: 45,
          rationale: 'consolidate',
        });
        continue;
      }

      const item = interleaved[cursor];
      if (!item) continue;
      cursor += 1;

      sessions.push({
        chapterId: item.chapter.chapterId,
        chapterName: item.chapter.chapterName,
        title: '',
        scheduledDate: iso,
        durationMinutes: DEFAULT_SESSION_MINUTES,
        rationale: item.rationale,
      });
    }
  }

  return sessions;
}

function interleaveByChapter<T extends { chapter: { chapterId: string } }>(items: T[]): T[] {
  const byChapter = new Map<string, T[]>();
  for (const item of items) {
    const list = byChapter.get(item.chapter.chapterId) ?? [];
    list.push(item);
    byChapter.set(item.chapter.chapterId, list);
  }

  const result: T[] = [];
  let remaining = items.length;

  while (remaining > 0) {
    for (const list of byChapter.values()) {
      const next = list.shift();
      if (next) {
        result.push(next);
        remaining -= 1;
      }
    }
  }

  return result;
}

function availableDays(today: Date, examDate: Date): Date[] {
  const days: Date[] = [];
  const start = startOfUtcDay(today);
  const end = startOfUtcDay(examDate);

  for (let day = addDays(start, 1); day < end; day = addDays(day, 1)) {
    days.push(day);
    if (days.length >= 120) break; // A plan longer than four months is noise.
  }

  return days;
}

// ---------------------------------------------------------------------------
// Titles
// ---------------------------------------------------------------------------

const TITLES_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['titles'],
  properties: {
    titles: { type: 'array', items: { type: 'string' } },
  },
} as const;

const FALLBACK_TITLE: Record<Locale, Record<PlannedSession['rationale'], string>> = {
  fr: {
    weak: 'Réviser {chapter}',
    uncovered: 'Découvrir {chapter}',
    consolidate: 'Consolider {chapter}',
    flashcards: 'Cartes mémoire dues',
  },
  en: {
    weak: 'Revise {chapter}',
    uncovered: 'First pass on {chapter}',
    consolidate: 'Consolidate {chapter}',
    flashcards: 'Flashcards due',
  },
  ar: {
    weak: 'مراجعة {chapter}',
    uncovered: 'بداية {chapter}',
    consolidate: 'ترسيخ {chapter}',
    flashcards: 'بطاقات المراجعة المستحقة',
  },
};

function applyFallbackTitles(sessions: PlannedSession[], locale: Locale): PlannedSession[] {
  return sessions.map((session) => ({
    ...session,
    title: FALLBACK_TITLE[locale][session.rationale].replace('{chapter}', session.chapterName ?? ''),
  }));
}

/**
 * Asks the model to phrase each session. One call for the whole plan.
 *
 * If it fails or is not configured, the template titles stand — a schedule that
 * cannot be produced without an API key would be a schedule students lose
 * access to the moment a provider has an outage.
 */
async function writeTitles(sessions: PlannedSession[], locale: Locale, subjectName: string): Promise<PlannedSession[]> {
  const withFallback = applyFallbackTitles(sessions, locale);
  if (!isAiConfigured() || sessions.length === 0) return withFallback;

  const languageName = locale === 'fr' ? 'French' : locale === 'ar' ? 'Arabic' : 'English';

  try {
    const response = await ai().completeJson({
      system: [
        `You name study sessions for a student revising ${subjectName} for the Lebanese Baccalaureate.`,
        '',
        `Write each title in ${languageName}, at most 8 words, as an instruction the student can act on`,
        'without thinking ("Work through 3 past questions on X", "Re-derive the formula for Y, then test it").',
        '',
        'The intent of each session is given:',
        '  uncovered   — the student has never worked this chapter. Opening it, gently.',
        '  weak        — they have worked it and it is not solid yet.',
        '  consolidate — near the exam, revisiting something already strong.',
        '  flashcards  — a spaced-repetition slot, not a chapter.',
        '',
        'Return exactly one title per session, in order. No numbering, no dates.',
      ].join('\n'),
      messages: [
        {
          role: 'user',
          content: sessions
            .map((s, i) => `${i + 1}. [${s.rationale}] ${s.chapterName ?? 'flashcards'}`)
            .join('\n'),
        },
      ],
      schema: TITLES_SCHEMA as unknown as Record<string, unknown>,
      schemaName: 'session_titles',
      effort: 'low',
      maxTokens: 4000,
      parse: (value) => z.object({ titles: z.array(z.string()) }).parse(value),
    });

    return withFallback.map((session, index) => {
      const title = response.data.titles[index]?.trim();
      return title ? { ...session, title: title.slice(0, 160) } : session;
    });
  } catch (err) {
    console.error('[scheduling] title generation failed, using templates', err);
    return withFallback;
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export type SuggestResult = {
  examLabel: string;
  examDate: string;
  daysRemaining: number;
  sessions: PlannedSession[];
};

export async function suggestSchedule(
  userId: string,
  upcomingExamId: string,
  locale: Locale,
): Promise<SuggestResult | null> {
  const exam = await db.upcomingExam.findFirst({
    where: { id: upcomingExamId, userId },
    select: {
      id: true,
      examDate: true,
      label: true,
      isBacExam: true,
      subjectId: true,
      subject: { select: { id: true, name: true } },
    },
  });

  if (!exam) return null;

  // A whole-Bac entry has no single subject; plan across the student's track.
  const subjectFilter = exam.subjectId
    ? { id: exam.subjectId }
    : { track: { users: { some: { id: userId } } } };

  const chapters = await db.chapter.findMany({
    // Scheduling a cancelled chapter would put a task on a student's plan that
    // opens on a 404.
    where: { subject: subjectFilter, ...LIVE_CHAPTER },
    select: {
      id: true,
      name: true,
      chapterMastery: { where: { userId }, select: { masteryScore: true, attemptsCount: true } },
    },
    orderBy: { orderIndex: 'asc' },
  });

  if (chapters.length === 0) return null;

  const today = new Date();
  const horizon = new Date(today.getTime() + 120 * 86_400_000);

  const [flashcards, existingSessions] = await Promise.all([
    db.flashcardState.findMany({
      where: { userId, dueDate: { gte: startOfUtcDay(today), lte: horizon } },
      select: { dueDate: true },
      distinct: ['dueDate'],
    }),
    db.studySession.findMany({
      where: { userId, scheduledDate: { gte: startOfUtcDay(today) }, status: 'planned' },
      select: { scheduledDate: true },
    }),
  ]);

  const plan = buildStudyPlan({
    examDate: exam.examDate,
    today,
    chapters: chapters.map((chapter) => ({
      chapterId: chapter.id,
      chapterName: chapter.name,
      masteryScore: Number(chapter.chapterMastery[0]?.masteryScore ?? 0),
      attemptsCount: chapter.chapterMastery[0]?.attemptsCount ?? 0,
    })),
    flashcardDueDates: flashcards.map((f) => toIso(f.dueDate)),
    busyDates: existingSessions.map((s) => toIso(s.scheduledDate)),
  });

  const titled = await writeTitles(plan, locale, exam.subject?.name ?? 'all subjects');

  return {
    examLabel: exam.subject?.name ?? exam.label ?? 'Baccalauréat',
    examDate: toIso(exam.examDate),
    daysRemaining: Math.max(0, Math.round((startOfUtcDay(exam.examDate).getTime() - startOfUtcDay(today).getTime()) / 86_400_000)),
    sessions: titled,
  };
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function toIso(date: Date): string {
  return startOfUtcDay(date).toISOString().slice(0, 10);
}
