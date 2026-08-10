import type { Metadata } from 'next';

import { SchedulePlanner, type PlannerExam, type PlannerSession } from '@/components/schedule/schedule-planner';
import { PageHeader } from '@/components/ui/sheet';
import { requireUser } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { getTranslations } from '@/lib/i18n';
import { listSubjects } from '@/lib/queries/taxonomy';

export const metadata: Metadata = { title: 'Schedule' };

/**
 * The planner.
 *
 * Sessions from today onwards, plus a short tail of the recent past so a
 * student can still tick off yesterday's work — a planner that hides the moment
 * it becomes "yesterday" is one people stop marking up.
 */
export default async function SchedulePage() {
  const user = await requireUser();
  const { t } = await getTranslations();

  const today = startOfToday();
  const from = new Date(today.getTime() - 7 * 86_400_000);

  const [sessions, exams, subjects, chapters] = await Promise.all([
    db.studySession.findMany({
      where: { userId: user.id, scheduledDate: { gte: from } },
      select: {
        id: true,
        title: true,
        scheduledDate: true,
        durationMinutes: true,
        source: true,
        status: true,
        chapter: { select: { id: true, name: true } },
      },
      orderBy: [{ scheduledDate: 'asc' }, { createdAt: 'asc' }],
    }),
    db.upcomingExam.findMany({
      where: { userId: user.id, examDate: { gte: today } },
      select: {
        id: true,
        examDate: true,
        label: true,
        isBacExam: true,
        subject: { select: { id: true, name: true } },
      },
      orderBy: { examDate: 'asc' },
    }),
    listSubjects(user.trackId),
    db.chapter.findMany({
      where: { subject: { trackId: user.trackId ?? undefined } },
      select: { id: true, name: true, subject: { select: { name: true } } },
      orderBy: [{ subjectId: 'asc' }, { orderIndex: 'asc' }],
    }),
  ]);

  const plannerSessions: PlannerSession[] = sessions.map((session) => ({
    id: session.id,
    title: session.title,
    scheduledDate: session.scheduledDate.toISOString().slice(0, 10),
    durationMinutes: session.durationMinutes,
    source: session.source,
    status: session.status,
    chapterName: session.chapter?.name ?? null,
  }));

  const plannerExams: PlannerExam[] = exams.map((exam) => ({
    id: exam.id,
    examDate: exam.examDate.toISOString().slice(0, 10),
    label: exam.subject?.name ?? exam.label ?? t.schedule.bacExam,
    isBacExam: exam.isBacExam,
  }));

  return (
    <>
      <PageHeader title={t.schedule.title} description={t.schedule.subtitle} />

      <SchedulePlanner
        sessions={plannerSessions}
        exams={plannerExams}
        subjects={subjects.map((s) => ({ id: s.id, name: s.name }))}
        chapters={chapters.map((c) => ({ id: c.id, name: `${c.subject.name} — ${c.name}` }))}
      />
    </>
  );
}

function startOfToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
