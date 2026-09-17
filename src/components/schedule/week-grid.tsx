'use client';

import { useMemo, useState } from 'react';

import { Badge } from '@/components/ui/feedback';
import { addDays, startOfWeek, weekOf } from '@/lib/calendar';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n/client';
import type { PlannerExam, PlannerSession } from '@/components/schedule/schedule-planner';

/**
 * The week the student has committed to.
 *
 * TWO LAYOUTS, BECAUSE A WEEK IS TWO DIFFERENT OBJECTS AT TWO SIZES.
 *
 * On a phone it is an agenda: seven day headings stacked, scanned with one
 * thumb. Seven columns at 360px gives each day about forty pixels, which is
 * enough for a coloured block and not enough for a chapter name — the student
 * would see that something is on Tuesday and have to tap to find out what.
 * That is a calendar impersonation, not a plan.
 *
 * From `lg` up it becomes a board, because there the columns are wide enough
 * to carry a subject and a chapter, and the shape of the week — which days are
 * full, where the free ones are, how many are left before Thursday's paper —
 * is the thing width is actually good for.
 *
 * THERE IS NO TIME OF DAY. `scheduled_date` is a `DATE`. So there is no hour
 * grid, no 09:00 row and nothing positioned by time, because the product does
 * not know any of that and inventing it would be the most convincing lie on
 * the page. Seven buckets is the honest shape.
 *
 * Empty days stay visible and stay quiet. The gap is the information — it is
 * where the next session can go — but a planner that prints "no tasks" five
 * times over is lecturing a student about their own free time.
 */

export function WeekGrid({
  sessions,
  exams,
  todayKey,
  onSetStatus,
  onMove,
}: {
  sessions: PlannerSession[];
  exams: PlannerExam[];
  /**
   * Today, decided on the server in Beirut. Not `new Date()` in the browser:
   * that is a different clock in a possibly different timezone, and the day
   * this component highlights must be the same day the plan was built around.
   */
  todayKey: string;
  onSetStatus: (id: string, status: PlannerSession['status']) => void;
  onMove?: (id: string, scheduledDate: string) => void;
}) {
  const { t, formatDate } = useI18n();

  /** Weeks away from the current one. Zero is this week. */
  const [offset, setOffset] = useState(0);
  const [movingId, setMovingId] = useState<string | null>(null);

  const days = useMemo(
    () => weekOf(addDays(startOfWeek(todayKey), offset * 7)),
    [todayKey, offset],
  );

  const byDay = useMemo(() => {
    const map = new Map<string, PlannerSession[]>();
    for (const session of sessions) {
      const list = map.get(session.scheduledDate);
      if (list) list.push(session);
      else map.set(session.scheduledDate, [session]);
    }
    return map;
  }, [sessions]);

  const examsByDay = useMemo(() => {
    const map = new Map<string, PlannerExam[]>();
    for (const exam of exams) {
      const list = map.get(exam.examDate);
      if (list) list.push(exam);
      else map.set(exam.examDate, [exam]);
    }
    return map;
  }, [exams]);

  /*
   * Weekday and day-of-month, in the interface language. Never a hardcoded
   * "Mon" — an Arabic interface says الاثنين and a French one lundi.
   *
   * `timeZone: 'UTC'` matters and is not decoration. A calendar day string
   * parses to midnight UTC, and formatting it in the browser's zone would
   * render the previous day for anyone west of Greenwich. The day is a label,
   * not an instant.
   */
  const dayLabel = (day: string) =>
    formatDate(day, { timeZone: 'UTC', weekday: 'short', day: 'numeric' });
  const fullDayLabel = (day: string) =>
    formatDate(day, { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <section className="mt-5" aria-label={t.schedule.thisWeek}>
      {/* --- Week navigation --------------------------------------------- */}
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-ink">
          {offset === 0 ? t.schedule.thisWeek : fullDayLabel(days[0] as string)}
        </h3>

        <div className="flex items-center gap-1">
          <NavButton label={t.common.previous} onClick={() => setOffset(offset - 1)} glyph="‹" />
          {offset !== 0 && (
            <button
              type="button"
              onClick={() => setOffset(0)}
              className="rounded px-2 py-1 text-meta font-medium text-primary hover:bg-paper-sunken"
            >
              {t.schedule.today}
            </button>
          )}
          <NavButton label={t.common.next} onClick={() => setOffset(offset + 1)} glyph="›" />
        </div>
      </div>

      {/* --- Phones: a vertical agenda ------------------------------------ */}
      <ul className="ruled rounded-sm border border-rule lg:hidden">
        {days.map((day) => {
          const own = byDay.get(day) ?? [];
          const dayExams = examsByDay.get(day) ?? [];
          const planned = own.filter((s) => s.status === 'planned');
          const minutes = planned.reduce((n, s) => n + (s.durationMinutes ?? 0), 0);
          const isToday = day === todayKey;

          return (
            <li
              key={day}
              className={cn('px-4 py-3', isToday && 'bg-primary-soft/40')}
              aria-current={isToday ? 'date' : undefined}
            >
              <div className="flex items-baseline justify-between gap-3">
                <h4 className={cn('text-sm', isToday ? 'font-semibold text-ink' : 'text-ink-muted')}>
                  {fullDayLabel(day)}
                  {isToday && (
                    <span className="ms-2 text-caption font-medium text-primary">
                      {t.schedule.today}
                    </span>
                  )}
                </h4>

                {own.length > 0 && (
                  <p className="shrink-0 text-caption text-ink-faint">
                    {planned.length > 0
                      ? `${planned.length} · ${minutes} min`
                      : t.schedule.weekAllDone}
                  </p>
                )}
              </div>

              {dayExams.map((exam) => (
                <p key={exam.id} className="mt-1.5">
                  <Badge tone="mark">{exam.label}</Badge>
                </p>
              ))}

              {own.length === 0 ? (
                // Quiet, not empty-stated. The gap is the information.
                <p className="mt-1 text-caption text-ink-faint">—</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {own.map((session) => (
                    <SessionCard
                      key={session.id}
                      session={session}
                      moving={movingId === session.id}
                      onToggleMove={() =>
                        setMovingId(movingId === session.id ? null : session.id)
                      }
                      onSetStatus={onSetStatus}
                      onMove={onMove}
                      t={t}
                    />
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>

      {/* --- Desktop: seven columns --------------------------------------- */}
      <div className="hidden grid-cols-7 gap-2 lg:grid">
        {days.map((day) => {
          const own = byDay.get(day) ?? [];
          const dayExams = examsByDay.get(day) ?? [];
          const isToday = day === todayKey;

          return (
            <div
              key={day}
              aria-current={isToday ? 'date' : undefined}
              className={cn(
                'min-h-[8rem] rounded-sm border p-2',
                isToday ? 'border-primary bg-primary-soft/30' : 'border-rule bg-paper',
              )}
            >
              <h4
                className={cn(
                  'mb-2 text-caption',
                  isToday ? 'font-semibold text-primary' : 'text-ink-muted',
                )}
              >
                {dayLabel(day)}
                {/* The border and the tint alone would make "today" a colour,
                    which is not a state a colour-blind student can read. */}
                {isToday && <span className="ms-1 font-medium">· {t.schedule.today}</span>}
              </h4>

              {dayExams.map((exam) => (
                <p key={exam.id} className="mb-1.5">
                  <Badge tone="mark">{exam.label}</Badge>
                </p>
              ))}

              <ul className="space-y-1.5">
                {own.map((session) => (
                  <SessionCard
                    key={session.id}
                    session={session}
                    compact
                    moving={movingId === session.id}
                    onToggleMove={() => setMovingId(movingId === session.id ? null : session.id)}
                    onSetStatus={onSetStatus}
                    onMove={onMove}
                    t={t}
                  />
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}

type Dict = ReturnType<typeof useI18n>['t'];

/**
 * One session.
 *
 * Subject first, then chapter, then activity and length. Not every column of
 * the row — provenance and status appear only where they change what the
 * student should think.
 *
 * Status never rests on colour alone: `done` carries a check glyph and the
 * word, `skipped` carries the word. A completed session keeps its subject and
 * chapter legible rather than being struck through into decoration — a student
 * looking back at their week is entitled to read what they did.
 */
function SessionCard({
  session,
  compact = false,
  moving,
  onToggleMove,
  onSetStatus,
  onMove,
  t,
}: {
  session: PlannerSession;
  compact?: boolean;
  moving: boolean;
  onToggleMove: () => void;
  onSetStatus: (id: string, status: PlannerSession['status']) => void;
  onMove?: (id: string, scheduledDate: string) => void;
  t: Dict;
}) {
  const taskLabel: Record<NonNullable<PlannerSession['taskType']>, string> = {
    quiz: t.schedule.taskQuiz,
    flashcards: t.schedule.taskFlashcards,
    exam_drill: t.schedule.taskExamDrill,
    review: t.schedule.taskReview,
  };

  const done = session.status === 'done';
  const skipped = session.status === 'skipped';

  return (
    <li
      className={cn(
        'rounded-sm border px-2 py-1.5',
        done ? 'border-rule bg-paper-sunken' : 'border-rule bg-paper',
      )}
    >
      {session.subjectName && (
        <p
          className={cn(
            'text-caption font-medium',
            done || skipped ? 'text-ink-faint' : 'text-ink-muted',
          )}
        >
          {session.subjectName}
        </p>
      )}

      {/* Chapter names wrap. An Arabic or French title cut in half is how two
          chapters become the same chapter. */}
      <p
        className={cn(
          'break-words text-sm',
          done || skipped ? 'text-ink-muted' : 'font-medium text-ink',
        )}
      >
        {session.chapterName ?? session.title}
      </p>

      <p className="text-caption text-ink-faint">
        {session.taskType ? taskLabel[session.taskType] : null}
        {session.taskType && session.durationMinutes !== null ? ' · ' : null}
        {session.durationMinutes !== null ? `${session.durationMinutes} min` : null}
      </p>

      {/* Provenance, only where it is not the default. A session the student
          wrote needs no label; one the planner proposed and they accepted
          does. */}
      {session.source === 'ai_suggested' && !done && !skipped && (
        <p className="mt-1">
          <Badge tone="primary">{t.schedule.suggest}</Badge>
        </p>
      )}

      {(done || skipped) && (
        <p className="mt-1 text-caption text-ink-muted">
          {done ? `✓ ${t.schedule.done}` : t.schedule.skipped}
        </p>
      )}

      {session.status === 'planned' && (
        <div className={cn('mt-1.5 flex flex-wrap gap-1', compact && 'flex-col items-start')}>
          <button
            type="button"
            onClick={() => onSetStatus(session.id, 'done')}
            className="rounded px-1.5 py-0.5 text-caption font-medium text-correct hover:bg-correct-soft"
          >
            {t.schedule.markDone}
          </button>
          {onMove && (
            <button
              type="button"
              onClick={onToggleMove}
              aria-expanded={moving}
              className="rounded px-1.5 py-0.5 text-caption text-ink-faint hover:bg-paper-sunken"
            >
              {t.schedule.move}
            </button>
          )}
        </div>
      )}

      {moving && onMove && (
        <label className="mt-1.5 block text-caption text-ink-muted">
          <span className="mb-1 block">{t.schedule.moveTo}</span>
          <input
            type="date"
            defaultValue={session.scheduledDate}
            onChange={(e) => {
              if (e.target.value) onMove(session.id, e.target.value);
            }}
            className="w-full rounded-sm border border-rule bg-paper px-1.5 py-1 text-sm text-ink"
          />
        </label>
      )}
    </li>
  );
}

function NavButton({
  label,
  glyph,
  onClick,
}: {
  label: string;
  glyph: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      // The glyph is decorative; the button's name comes from the label, so a
      // screen reader announces "previous" rather than a bracket.
      aria-label={label}
      className="rounded px-2 py-1 text-ink-muted hover:bg-paper-sunken hover:text-ink"
    >
      <span aria-hidden="true">{glyph}</span>
    </button>
  );
}
