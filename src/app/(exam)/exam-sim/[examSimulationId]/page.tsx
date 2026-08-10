import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { ExamRunner, type ExamSlot } from '@/components/exam/exam-runner';
import { requireUser } from '@/lib/auth/guards';
import { loadSimulation, remainingSeconds, slotContent } from '@/lib/exam';

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
      simulationId={simulation.id}
      subjectName={simulation.subject.name}
      title={simulation.examCycle?.title ?? simulation.subject.name}
      slots={slots}
      initialRemainingSeconds={remaining}
    />
  );
}
