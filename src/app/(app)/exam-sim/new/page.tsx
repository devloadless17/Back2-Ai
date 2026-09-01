import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { NewSimulationForm, type SimulationOption } from '@/components/exam/new-simulation-form';
import { PageHeader } from '@/components/ui/sheet';
import { requireUser } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { PUBLISHED_FILTER } from '@/lib/generation';
import { getTranslations } from '@/lib/i18n';
import { listSubjects, subjectLanguagesFor } from '@/lib/queries/taxonomy';
import { LOCALE_LABELS } from '@/lib/i18n/config';

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

  const subjects = await listSubjects(user.trackId, user.preferredLanguage);

  const options: SimulationOption[] = await Promise.all(
    subjects.map(async (subject) => {
      const [cycles, generatedCount, realPoolCount] = await Promise.all([
        /*
         * Only editions the student can read.
         *
         * The same filter the past-paper list uses, and it matters more here:
         * that page offers a paper to read, this one starts a timed sitting.
         * The humanities have one Arabic subject that a French-track student is
         * shown — `subjectLanguagesFor('fr')` returns ['fr','ar'] — and the
         * CRDP prints those papers in three languages. Without this the picker
         * offers all three editions of "Philosophie LH 2018" under the same
         * title, and a French candidate can start a two-hour Arabic paper by
         * choosing the wrong identical row.
         */
        db.examCycle.findMany({
          where: {
            subjectId: subject.id,
            questions: { some: {} },
            language: { in: subjectLanguagesFor(user.preferredLanguage) },
          },
          select: {
            id: true,
            title: true,
            year: true,
            session: true,
            language: true,
            durationMinutes: true,
            _count: { select: { questions: true } },
          },
          orderBy: [{ year: 'desc' }, { session: 'asc' }],
        }),
        db.generatedProblem.count({
          where: { chapter: { subjectId: subject.id }, ...PUBLISHED_FILTER },
        }),
        /*
         * How many real past-exam questions this subject could assemble a mock
         * paper from. Counted rather than assumed, because the mode is only
         * offered where there is a pool to draw on — and unlike the generated
         * one, most subjects have thousands.
         */
        db.question.count({
          where: {
            chapter: { subjectId: subject.id },
            sourceType: 'past_exam',
            verifiedStatus: { not: 'rejected' },
          },
        }),
      ]);

      return {
        subjectId: subject.id,
        subjectName: subject.name,
        realPoolCount,
        cycles: cycles.map((cycle) => ({
          id: cycle.id,
          /*
           * The edition is part of the label, not decoration. A French-track
           * student is offered their own printing and the Arabic one, and the
           * two carry the same title and year — without the language they are
           * two identical rows in a dropdown, and picking the wrong one starts
           * a timed paper in a language the candidate cannot sit.
           */
          label:
            `${cycle.title} · ${cycle.year}` +
            `${cycle.session ? ` · ${cycle.session}` : ''}` +
            ` · ${LOCALE_LABELS[cycle.language]}`,
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
