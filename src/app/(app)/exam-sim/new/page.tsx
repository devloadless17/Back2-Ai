import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { NewSimulationForm, type SimulationOption } from '@/components/exam/new-simulation-form';
import { PageHeader } from '@/components/ui/sheet';
import { requireUser } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { PUBLISHED_FILTER } from '@/lib/generation';
import { getTranslations } from '@/lib/i18n';
import { listSubjects } from '@/lib/queries/taxonomy';

export const metadata: Metadata = { title: 'New simulation' };

/**
 * Composing a paper.
 *
 * The AI-generated option is only offered for subjects that actually have
 * approved problems in the pool. Offering it everywhere and failing on submit
 * would be a worse version of the same constraint — the review gate is not
 * something to discover after choosing.
 */
export default async function NewSimulationPage() {
  const user = await requireUser();
  const { t } = await getTranslations();

  // One live paper at a time.
  const existing = await db.examSimulation.findFirst({
    where: { userId: user.id, status: 'in_progress' },
    select: { id: true, expiresAt: true },
  });
  if (existing && existing.expiresAt.getTime() > Date.now()) {
    redirect(`/exam-sim/${existing.id}`);
  }

  const subjects = await listSubjects(user.trackId);

  const options: SimulationOption[] = await Promise.all(
    subjects.map(async (subject) => {
      const [cycles, generatedCount] = await Promise.all([
        db.examCycle.findMany({
          where: { subjectId: subject.id, questions: { some: {} } },
          select: {
            id: true,
            title: true,
            year: true,
            session: true,
            durationMinutes: true,
            _count: { select: { questions: true } },
          },
          orderBy: [{ year: 'desc' }, { session: 'asc' }],
        }),
        db.generatedProblem.count({
          where: { chapter: { subjectId: subject.id }, ...PUBLISHED_FILTER },
        }),
      ]);

      return {
        subjectId: subject.id,
        subjectName: subject.name,
        cycles: cycles.map((cycle) => ({
          id: cycle.id,
          label: `${cycle.title} · ${cycle.year}${cycle.session ? ` · ${cycle.session}` : ''}`,
          questionCount: cycle._count.questions,
          durationMinutes: cycle.durationMinutes,
        })),
        generatedAvailable: generatedCount,
      };
    }),
  );

  return (
    <>
      <PageHeader title={t.examSim.newTitle} description={t.examSim.subtitle} />
      <NewSimulationForm options={options} />
    </>
  );
}
