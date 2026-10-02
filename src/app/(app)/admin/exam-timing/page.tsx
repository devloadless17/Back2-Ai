import type { Metadata } from 'next';

import { ExamTimingManager, type AdminExamCycle } from '@/components/admin/exam-timing-manager';
import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';

export const metadata: Metadata = { title: 'Exam timing' };

/**
 * How long each paper is sat for, set by a person.
 *
 * Every cycle starts on a 180-minute fallback, and across this corpus not one
 * of the 1,656 is official. That is wrong in both directions: the civics paper
 * prints «المدّة: ساعة واحدة» and is given three hours, Mathematics SG really
 * runs four and is given three. The timer is the part of an exam simulation
 * that has to be true — practising at the wrong length is worse than not
 * practising under time.
 *
 * SCOPED TO ONE SUBJECT, by a plain GET form, for the same reason the chapter
 * screen is: 1,656 cycles is not a list anybody should be shown at once, and a
 * duration is decided a subject at a time because it is a property of that
 * subject's paper. Keeping the choice in the URL means an admin can come back
 * to it or send it to whoever is checking against the papers.
 *
 * Ordered newest first: recent years are the ones a duration is most likely to
 * be known for, and the ones students sit most.
 */
export default async function AdminExamTimingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();

  const params = await searchParams;
  const raw = params.subject;
  const subjectId = (Array.isArray(raw) ? raw[0] : raw) ?? '';

  const subjects = await db.subject.findMany({
    select: {
      id: true,
      name: true,
      examDurationMinutes: true,
      track: { select: { code: true } },
      _count: { select: { examCycles: true } },
    },
    orderBy: [{ track: { code: 'asc' } }, { name: 'asc' }],
  });

  const cycles = subjectId
    ? await db.examCycle.findMany({
        where: { subjectId },
        select: {
          id: true,
          year: true,
          session: true,
          title: true,
          durationMinutes: true,
          durationIsOfficial: true,
          /*
           * What is behind the cycle, so the decision is made with it in view.
           * A paper nobody has sat and one sat two hundred times are the same
           * edit with different consequences, and changing the length does not
           * rewrite the sittings already recorded against it.
           */
          _count: { select: { questions: true, examSimulations: true } },
        },
        orderBy: [{ year: 'desc' }, { session: 'asc' }],
      })
    : [];

  const rows: AdminExamCycle[] = cycles.map((cycle) => ({
    id: cycle.id,
    year: cycle.year,
    session: cycle.session,
    title: cycle.title,
    durationMinutes: cycle.durationMinutes,
    durationIsOfficial: cycle.durationIsOfficial,
    questionCount: cycle._count.questions,
    sittingCount: cycle._count.examSimulations,
  }));

  return (
    <ExamTimingManager
      cycles={rows}
      subjects={subjects.map((s) => ({
        id: s.id,
        label: `${s.track?.code ?? '—'} · ${s.name}`,
        track: s.track?.code ?? '—',
        name: s.name,
        examDurationMinutes: s.examDurationMinutes,
        paperCount: s._count.examCycles,
      }))}
      subjectId={subjectId}
    />
  );
}
