import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { TutorButton } from '@/components/chat/tutor-button';
import { MarkExplanation } from '@/components/exam/mark-explanation';
import { LinkButton } from '@/components/ui/button';
import { Alert, Badge, EmptyState } from '@/components/ui/feedback';
import { MathText, QuestionBody } from '@/components/ui/math';
import { BandChip } from '@/components/ui/band';
import { Meter } from '@/components/ui/progress';
import { PageHeader, Sheet, SheetBody, SheetFooter, SheetHeader } from '@/components/ui/sheet';
import { requireUser } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { loadSimulation, slotContent } from '@/lib/exam';
import { parseBaremeResult } from '@/lib/grading';
import { getTranslations } from '@/lib/i18n';
import { format } from '@/lib/i18n/format';

export const metadata: Metadata = { title: 'Results' };

/**
 * The marked paper.
 *
 * Every criterion is shown with the marks awarded and the examiner's note for
 * why. That is the only version of automatic marking worth shipping: a total
 * with no breakdown tells a student they got 11/20 and nothing about what to do
 * next, and gives them no basis on which to dispute a mark they think is wrong.
 */
export default async function ExamResultsPage({
  params,
  searchParams,
}: {
  params: Promise<{ examSimulationId: string }>;
  searchParams: Promise<{ expired?: string }>;
}) {
  const { examSimulationId } = await params;
  const { expired } = await searchParams;
  const user = await requireUser();
  const { t } = await getTranslations();

  const simulation = await loadSimulation(examSimulationId, user.id);
  if (!simulation) notFound();

  if (simulation.status === 'in_progress') {
    redirect(`/exam-sim/${simulation.id}`);
  }

  const total = simulation.totalScore === null ? null : Number(simulation.totalScore);
  const max = simulation.maxScore === null ? null : Number(simulation.maxScore);
  const ratio = total !== null && max ? total / max : 0;

  // Questions that were submitted and graded, but that the marker could not
  // mark. They are excluded from the total rather than counted as zeros, so the
  // student must be told they exist — otherwise a 12/16 looks like a complete
  // paper when four questions are still waiting on a human.
  const awaitingMarking = simulation.questions.filter(
    (slot) => slot.answer?.gradedAt && slot.answer.totalScore === null,
  ).length;

  /*
   * The attempt rows written when this paper was marked.
   *
   * They are what makes "go over this with the tutor" useful here: the attempt
   * carries the student's own working, so the conversation starts from their
   * answer rather than from the model one printed above it. Matched on the
   * question and restricted to attempts recorded at or after submission, so an
   * earlier practice attempt at the same question cannot be picked up by
   * mistake — that answer is not the one on this page.
   */
  const questionIds = simulation.questions
    .map((slot) => slot.questionId)
    .filter((id): id is string => Boolean(id));

  const attempts =
    questionIds.length > 0 && simulation.submittedAt
      ? await db.attempt.findMany({
          where: {
            userId: user.id,
            context: 'exam_sim',
            questionId: { in: questionIds },
            attemptedAt: { gte: simulation.submittedAt },
          },
          select: { id: true, questionId: true },
          orderBy: { attemptedAt: 'asc' },
        })
      : [];

  const attemptByQuestionId = new Map(
    attempts.flatMap((attempt) => (attempt.questionId ? [[attempt.questionId, attempt.id]] : [])),
  );

  return (
    <>
      <PageHeader
        title={t.examSim.resultsTitle}
        description={`${simulation.subject.name}${simulation.examCycle ? ` · ${simulation.examCycle.title}` : ''}`}
        actions={
          <LinkButton href="/exam-sim" variant="secondary">
            {t.common.back}
          </LinkButton>
        }
      />

      {expired === '1' && (
        <Alert tone="warning" className="mb-5">
          {t.examSim.expired}
        </Alert>
      )}

      {simulation.status === 'submitted' ? (
        <EmptyState tone="pending" title={t.examSim.grading} body={t.examSim.gradingHint} />
      ) : (
        <div className="space-y-5">
          {/* --- Total --- */}
          <Sheet>
            <SheetHeader title={t.examSim.totalScore} />
            <SheetBody className="space-y-3">
              {max === null || max === 0 ? (
                <p className="text-2xl font-semibold text-ink-faint">
                  {t.examSim.grading}
                </p>
              ) : (
                <>
                  <p className="text-5xl font-semibold tabular-nums leading-none">
                    {total === null ? '—' : total}
                    <span className="text-2xl font-normal text-ink-faint">
                      {' / '}
                      {max}
                    </span>
                  </p>
                  <Meter value={ratio} />
                </>
              )}

              {awaitingMarking > 0 && (
                <Alert tone="warning" title={t.examSim.grading}>
                  {t.examSim.gradingHint}
                </Alert>
              )}
            </SheetBody>
          </Sheet>

          {/* --- Per question --- */}
          {simulation.questions.map((slot, index) => {
            const content = slotContent(slot);
            const results = parseBaremeResult(slot.answer?.baremeResult);
            const slotTotal = slot.answer?.totalScore === null || slot.answer?.totalScore === undefined
              ? null
              : Number(slot.answer.totalScore);
            const slotMax = slot.answer?.maxScore === null || slot.answer?.maxScore === undefined
              ? (slot.maxScore === null ? null : Number(slot.maxScore))
              : Number(slot.answer.maxScore);

            const studentText =
              slot.answer?.ocrExtractedText ?? slot.answer?.typedAnswer ?? '';

            return (
              <Sheet key={slot.id}>
                <SheetHeader
                  title={format(t.examSim.exercise, { number: index + 1 })}
                  description={
                    slotMax
                      ? format(t.examSim.exercisePoints, { points: slotMax })
                      : (content.chapterName ?? undefined)
                  }
                  actions={
                    slotTotal !== null && slotMax ? (
                      <Badge
                        tone={
                          slotTotal >= slotMax
                            ? 'correct'
                            : slotTotal > 0
                              ? 'partial'
                              : 'mark'
                        }
                      >
                        <span className="numeric">
                          {slotTotal} / {slotMax}
                        </span>
                      </Badge>
                    ) : slot.answer?.gradedAt ? (
                      // Graded, but with no mark — the marker could not mark it.
                      // Distinct from "not answered", which is the student's zero.
                      // Carries the same question-badge icon as everywhere else
                      // this state appears, so it is recognisable without colour.
                      <BandChip band="needs_review" label={t.examSim.grading} />
                    ) : (
                      <Badge tone="neutral">{t.examSim.notAnswered}</Badge>
                    )
                  }
                />

                <SheetBody>
                  <QuestionBody
                    contentText={content.contentText}
                    contentLatex={content.contentLatex}
                    images={content.contentImages}
                  />
                </SheetBody>

                {/* Student's answer */}
                <SheetBody className="border-t border-rule bg-paper-sunken/40">
                  <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
                    {t.practice.yourAnswer}
                  </p>
                  {studentText.trim().length > 0 ? (
                    <pre className="scroll-x whitespace-pre-wrap font-mono text-[13px] leading-relaxed text-ink">
                      {studentText}
                    </pre>
                  ) : (
                    <p className="text-sm text-ink-muted">{t.examSim.notAnswered}</p>
                  )}

                  {slot.answer?.ocrConsistencyPassed === false && (
                    <Alert tone="warning" className="mt-3">
                      {slot.answer.ocrConsistencyNotes ?? t.examSim.photoUnreadable}
                    </Alert>
                  )}
                </SheetBody>

                {/* Barème */}
                {results.length > 0 && (
                  <>
                    <SheetHeader
                      title={
                        results.some((item) => item.provisional)
                          ? t.examSim.provisionalMarking
                          : t.examSim.baremeBreakdown
                      }
                      className="border-t"
                    />
                    {/*
                     * Said before the marks, not after them. A student who has
                     * already read a score has already believed it, and a
                     * caveat underneath is a footnote to a number they have
                     * taken as the examiner's.
                     */}
                    {results.some((item) => item.provisional) && (
                      <SheetBody className="border-b border-rule pb-3">
                        <Alert tone="warning">{t.examSim.provisionalNotice}</Alert>
                      </SheetBody>
                    )}
                    <SheetBody className="p-0">
                      <div className="ruled">
                        {results.map((item, i) => (
                          <MarkExplanation
                            key={`${item.criterion}-${i}`}
                            criterion={item.criterion}
                            awarded={item.points_awarded}
                            possible={item.points_possible}
                            justification={item.justification}
                          />
                        ))}
                      </div>
                    </SheetBody>
                  </>
                )}

                {/* Official solution */}
                {content.officialSolution && (
                  <>
                    <SheetHeader title={t.practice.officialSolution} className="border-t" />
                    <SheetBody>
                      <MathText>{content.officialSolution}</MathText>
                    </SheetBody>
                  </>
                )}

                {/* Correction-key tutoring, on the one screen where the student
                    has just seen a mark they did not expect. */}
                {slot.questionId && attemptByQuestionId.has(slot.questionId) && (
                  <SheetFooter className="justify-between gap-3">
                    <p className="text-[12.5px] text-ink-muted">{t.examSim.tutorOnThisHint}</p>
                    <TutorButton
                      attemptId={attemptByQuestionId.get(slot.questionId)}
                      label={t.examSim.tutorOnThis}
                      size="sm"
                    />
                  </SheetFooter>
                )}
              </Sheet>
            );
          })}
        </div>
      )}
    </>
  );
}
