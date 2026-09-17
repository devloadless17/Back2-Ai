import type { Metadata } from 'next';

import { NextUpCard } from '@/components/progress/next-up-card';
import { PlanBacklog } from '@/components/schedule/plan-backlog';
import { PlanBuilder } from '@/components/schedule/plan-builder';
import { PlanToday } from '@/components/schedule/plan-today';
import {
  SchedulePlanner,
  type PlannerExam,
  type PlannerSession,
} from '@/components/schedule/schedule-planner';
import { PageHeader } from '@/components/ui/sheet';
import { requireUser } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { getTranslations } from '@/lib/i18n';
import { getNextUp } from '@/lib/queries/next-up';
import { getPlan } from '@/lib/queries/plan';
import { listSubjects } from '@/lib/queries/taxonomy';

export const metadata: Metadata = { title: 'Schedule' };

/**
 * The plan — one page for what to study and when.
 *
 * `/todos` redirects here. Todos and sessions remain different things in the
 * database and that distinction is kept: a todo is an intention with no date,
 * a session is a commitment with one. What changed is that they are read in
 * the same place. A todo used to appear on `/todos` and nowhere else — not on
 * the Dashboard, not in Today, not in any count — which made writing one a way
 * of filing work away from yourself.
 *
 * The order is the order a student needs it in. What is due now, then the one
 * thing worth doing if nothing is, then the week, then the things they noted
 * but have not committed to.
 *
 * Nothing here claims to know when the student is free. Sessions carry a date
 * and no time of day — the column is a DATE — so the plan never says "18:00",
 * and the only capacity it works from is the minutes-a-day and rest-day the
 * student types into the plan builder themselves.
 */
export default async function SchedulePage() {
  const user = await requireUser();
  const { t } = await getTranslations();

  /*
   * THE CHAPTER LIST IS KEPT, DELIBERATELY, AND THE NUMBER IS WHY.
   *
   * I described this earlier as "more than a thousand rows on a GS account".
   * That was wrong: 1,193 is the whole corpus across four tracks, and a single
   * track is 243 chapters — the figure `standing.ts` and `content-health.ts`
   * both cite for GS and LS. At roughly ninety bytes a row that is about 22 kB
   * uncompressed and a few kB over the wire.
   *
   * A searchable endpoint would trade that for a network round trip on every
   * keystroke, on Lebanese mobile connections, to solve a problem the
   * measurement does not support. The picker stays. What `getPlan` removed was
   * the real duplication: `/todos` loaded the same list again for its own
   * picker, and both pages read sessions and todos separately.
   */
  const [plan, next, subjects, chapters] = await Promise.all([
    getPlan(user.id),
    getNextUp(user.id, user.trackId, user.preferredLanguage),
    listSubjects(user.trackId, user.preferredLanguage),
    db.chapter.findMany({
      where: { subject: { trackId: user.trackId ?? undefined } },
      select: { id: true, name: true, subject: { select: { name: true } } },
      orderBy: [{ subjectId: 'asc' }, { orderIndex: 'asc' }],
    }),
  ]);

  const today = plan.sessions.filter((s) => s.scheduledDate === plan.todayKey);

  const plannerSessions: PlannerSession[] = plan.sessions.map((session) => ({
    id: session.id,
    title: session.title,
    scheduledDate: session.scheduledDate,
    durationMinutes: session.durationMinutes,
    source: session.source,
    status: session.status,
    chapterName: session.chapterName,
    subjectName: session.subjectName,
    taskType: session.taskType,
  }));

  const plannerExams: PlannerExam[] = plan.exams.map((exam) => ({
    id: exam.id,
    examDate: exam.examDate,
    label: exam.subjectName ?? exam.label ?? t.schedule.bacExam,
    isBacExam: exam.isBacExam,
  }));

  return (
    <>
      <PageHeader title={t.schedule.title} description={t.schedule.subtitle} />

      {/* --- What is due now ----------------------------------------------- */}
      <PlanToday sessions={today} />

      {/* --- The one thing worth doing -------------------------------------
          The same `getNextUp` the Dashboard and Progress read. A third place
          asking "what should I work on" must not answer it a third way, and
          this is a recommendation rather than a plan: nothing about showing it
          here puts it in anyone's week. */}
      <div className="mt-5">
        <NextUpCard next={next} />
      </div>

      <div className="mt-5">
        <PlanBuilder hasExam={plannerExams.length > 0} />
      </div>

      <SchedulePlanner
        sessions={plannerSessions}
        exams={plannerExams}
        subjects={subjects.map((s) => ({ id: s.id, name: s.name }))}
        chapters={chapters.map((c) => ({ id: c.id, name: `${c.subject.name} — ${c.name}` }))}
        todayKey={plan.todayKey}
      />

      {/* --- Noted, not committed to ---------------------------------------- */}
      <div className="mt-5">
        <PlanBacklog items={plan.backlog} todayKey={plan.todayKey} />
      </div>
    </>
  );
}
