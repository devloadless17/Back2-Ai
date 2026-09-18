import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { ExamRunner, type ExamSlot } from '@/components/exam/exam-runner';
import { requireUser } from '@/lib/auth/guards';
import { loadSimulation, remainingSeconds, slotContent } from '@/lib/exam';
import { dirForLanguage } from '@/lib/i18n/config';

export const metadata: Metadata = { title: 'Examination' };

/**
 * The sitting.
 *
 * If the deadline has already passed when the page loads, the student is sent
 * to the results rather than shown a paper they cannot submit — the cron sweep
 * will have marked it, or the submit call will.
 */
export default async function ExamSittingPage({
  params,
}: {
  params: Promise<{ examSimulationId: string }>;
}) {
  const { examSimulationId } = await params;
  const user = await requireUser();

  const simulation = await loadSimulation(examSimulationId, user.id);
  if (!simulation) notFound();

  if (simulation.status !== 'in_progress') {
    redirect(`/exam-sim/${simulation.id}/results`);
  }

  const remaining = remainingSeconds(simulation);

  const slots: ExamSlot[] = simulation.questions.map((slot) => {
    const content = slotContent(slot);
    return {
      id: slot.id,
      orderIndex: slot.orderIndex,
      contentText: content.contentText,
      contentLatex: content.contentLatex,
      contentImages: content.contentImages,
      chapterName: content.chapterName,
      maxScore: slot.maxScore === null ? null : Number(slot.maxScore),
      savedAnswer: slot.answer?.typedAnswer ?? null,
      savedPhotoKey: slot.answer?.photoUrl ?? null,
      photoRejected: slot.answer?.ocrConsistencyPassed === false,
    };
  });

  return (
    <ExamRunner
      paperDir={dirForLanguage(simulation.subject.language)}
      simulationId={simulation.id}
      subjectName={simulation.subject.name}
      /*
       * A composed or generated paper has no printed duration to be faithful
       * to, so our length IS its length and the marker would be noise. Only a
       * real cycle can disagree with the paper it claims to reproduce.
       */
      durationIsOfficial={
        simulation.sourceMode !== 'real_cycle' || (simulation.examCycle?.durationIsOfficial ?? false)
      }
      title={simulation.examCycle?.title ?? simulation.subject.name}
      slots={slots}
      initialRemainingSeconds={remaining}
    />
  );
}
