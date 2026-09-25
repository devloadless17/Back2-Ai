import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { TutorAnchor } from '@/components/chat/tutor-context';
import { TutorButton } from '@/components/chat/tutor-button';
import { ExaminerMark } from '@/components/practice/examiner-mark';
import { NextUpCard } from '@/components/progress/next-up-card';
import { LinkButton } from '@/components/ui/button';
import { Alert, Badge, EmptyState } from '@/components/ui/feedback';
import { MathText, QuestionBody } from '@/components/ui/math';
import { BandChip } from '@/components/ui/band';
import { Meter } from '@/components/ui/progress';
import { PageHeader, Sheet, SheetBody, SheetFooter, SheetHeader } from '@/components/ui/sheet';
import { BackLink } from '@/components/ui/back-link';
import { requireUser } from '@/lib/auth/guards';
import { getNextUp } from '@/lib/queries/next-up';
import { db } from '@/lib/db';
import { loadSimulation, slotContent } from '@/lib/exam';
import { parseBaremeResult } from '@/lib/grading';
import { getTranslations } from '@/lib/i18n';
import { format } from '@/lib/i18n/format';
import { dirForLanguage } from '@/lib/i18n/config';
import { visualKeysFor } from '@/lib/visual-evidence';

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

  const [simulation, next] = await Promise.all([
    loadSimulation(examSimulationId, user.id),
    getNextUp(user.id, user.trackId, user.preferredLanguage),
  ]);
  if (!simulation) notFound();

  if (simulation.status === 'in_progress') {
    redirect(`/exam-sim/${simulation.id}`);
  }

  // The one visual selector — the same call Nour's retrieval makes.
  const visualKeys = await visualKeysFor(simulation.questions.flatMap((s) => (s.question ? [s.question] : [])));

  /*
   * The paper's direction, not the student's. The sitting has always carried
   * `subjects.language` — `SIMULATION_INCLUDE` selects it — and only the
   * rendering ignored it, so an Arabic paper was marked up left-to-right on
   * the screen where the student reads why they lost marks.
   */
  const paperDir = dirForLanguage(simulation.subject.language);

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

  /*
   * What the docked tutor opens on.
   *
   * The first question that actually lost marks, rather than the first question
   * on the paper: a student who taps "Explain this" straight after a result
   * means the one they got wrong. Questions still awaiting a human marker are
   * skipped — there is no verdict to explain yet — and if nothing lost marks the
   * dock carries the paper as context and no anchor.
   */
  const firstLostMarks = simulation.questions.find((slot) => {
    if (!slot.questionId || !attemptByQuestionId.has(slot.questionId)) return false;
    const awarded = slot.answer?.totalScore;
    const possible = slot.answer?.maxScore ?? slot.maxScore;
    if (awarded === null || awarded === undefined || possible === null || possible === undefined) {
      return false;
    }
    return Number(awarded) < Number(possible);
  });

  return (
    <>
      {/* The paper's own direction. The sitting already carried
          `subjects.language`; only the rendering ignored it. */}
      <TutorAnchor label={simulation.subject.name} subjectId={simulation.subject.id} />

      <BackLink href="/exam-sim" label={t.nav.examSim} />

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
          {/* --- How I did ---------------------------------------------------
              The paper's own mark on the paper's own scale. A /20 appears only
              when every question was markable: the denominator excludes
              questions still waiting on a human, so scaling a partial paper to
              20 would hand the student a familiar-looking figure computed from
              an unfamiliar denominator. When something is unmarked they get
              the raw fraction and a count, which is the true shape of what we
              know. */}
          <Sheet hero>
            <SheetHeader
              title={t.examSim.totalScore}
              description={
                /* What was actually sat. The student should not have to infer
                   whether this was a real paper or one we composed. */
                simulation.sourceMode === 'real_cycle'
                  ? t.examSim.modeRealCycle
                  : simulation.sourceMode === 'real_mixed'
                    ? t.examSim.modeRealMixed
                    : t.examSim.modeAiGenerated
              }
            />
            <SheetBody className="space-y-3">
              {max === null || max === 0 ? (
                <p className="text-title font-semibold text-ink-faint">
                  {t.examSim.grading}
                </p>
              ) : (
                <>
                  <p className="figure text-hero leading-none text-ink">
                    {total === null ? '—' : total}
                    <span className="text-title font-normal text-ink-faint">
                      {' / '}
                      {max}
                    </span>
                  </p>

                  {total !== null && awaitingMarking === 0 && (
                    <p className="figure text-body text-ink-muted">
                      {format(t.standing.outOf, {
                        mark: Math.round((total / max) * 20 * 10) / 10,
                        scale: 20,
                      })}
                      <span className="ms-2 text-meta text-ink-faint">
                        {t.examSim.outOf20Hint}
                      </span>
                    </p>
                  )}

                  <Meter value={ratio} />

                  {/* Grading completeness, always — not a footnote that only
                      appears when something is wrong. */}
                  <p className="text-meta text-ink-muted">
                    {format(t.examSim.gradedOf, {
                      graded: simulation.questions.length - awaitingMarking,
                      total: simulation.questions.length,
                    })}
                    {awaitingMarking > 0 && (
                      <>
                        {' · '}
                        {format(t.examSim.awaitingHuman, { count: awaitingMarking })}
                      </>
                    )}
                  </p>
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

                {/* --- Progressive disclosure -----------------------------
                    Twelve papers' worth of question, answer, barème and model
                    solution expanded at once is a wall nobody reads, and on a
                    390px screen it is several minutes of scrolling before the
                    second question. The mark is in the header, so the whole
                    paper can be scanned closed; the first question that lost
                    marks opens, because that is the one the student came for.

                    `<details>` rather than state: it works before hydration,
                    it is keyboard- and screen-reader-operable with no ARIA,
                    and find-in-page reaches inside a closed section. */}
                <details open={slot.id === firstLostMarks?.id} className="group">
                  <summary className="cursor-pointer list-none border-t border-rule px-5 py-2.5 text-meta font-medium text-primary hover:bg-paper-sunken">
                    {t.examSim.reviewQuestion}
                  </summary>

                <SheetBody>
                  <QuestionBody
                    contentText={content.contentText}
                    contentLatex={content.contentLatex}
                    images={slot.question ? (visualKeys.get(slot.question.id) ?? []) : content.contentImages}
                    dir={paperDir}
                    passage={content.passage}
                  />
                </SheetBody>

                {/* Student's answer */}
                <SheetBody className="border-t border-rule bg-paper-sunken/40">
                  <p className="mb-1.5 text-caption font-semibold uppercase tracking-wide text-ink-faint">
                    {t.practice.yourAnswer}
                  </p>
                  {studentText.trim().length > 0 ? (
                    <pre className="scroll-x whitespace-pre-wrap font-mono text-meta leading-relaxed text-ink">
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

                {/* --- The marking, in the product's one grammar -----------
                    This rendered `MarkExplanation`, which predates the
                    `ExaminerMark` built for Practice. Two components for one
                    idea, and the exam's was the poorer of the two: no ✓ ◐ ×
                    glyph, no Nour's note, no per-criterion provisional state.
                    They were kept apart only because one was written first.

                    The shapes turned out to be identical — `bareme_result` is
                    already `{ criterion, points_awarded, points_possible,
                    justification, explanation, provisional }`, which is
                    `MarkedCriterion` exactly — so nothing had to be invented
                    or dropped to move across. */}
                {results.length > 0 && (
                  <div className="border-t border-rule">
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
                    <ExaminerMark
                      total={slotTotal ?? 0}
                      max={slotMax ?? 0}
                      criteria={results}
                      dir={paperDir}
                      labels={{
                        title: results.some((item) => item.provisional)
                          ? t.examSim.provisionalMarking
                          : t.practice.examinerTitle,
                        nourNote: t.practice.nourNote,
                        provisional: t.practice.criterionProvisional,
                        repeated: t.practice.repeatedLoss,
                      }}
                    />
                  </div>
                )}

                {/* Official solution */}
                {content.officialSolution && (
                  <>
                    {/* "Official solution" only when an examiner wrote it.
                        A generated problem's solution is a model answer, and
                        Practice already makes this distinction — the exam had
                        its own reader and was heading every one of them
                        official. */}
                    <SheetHeader
                      title={
                        content.solutionIsOfficial
                          ? t.practice.officialSolution
                          : t.practice.modelSolution
                      }
                      className="border-t"
                    />
                    <SheetBody>
                      <MathText dir={paperDir}>{content.officialSolution}</MathText>
                    </SheetBody>
                  </>
                )}

                {/* Correction-key tutoring, on the one screen where the student
                    has just seen a mark they did not expect. */}
                {slot.questionId && attemptByQuestionId.has(slot.questionId) && (
                  <SheetFooter className="justify-between gap-3">
                    <p className="text-meta text-ink-muted">{t.examSim.tutorOnThisHint}</p>
                    <TutorButton
                      attemptId={attemptByQuestionId.get(slot.questionId)}
                      label={t.examSim.tutorOnThis}
                      size="sm"
                    />
                  </SheetFooter>
                )}
                </details>
              </Sheet>
            );
          })}

          {/* --- What next ------------------------------------------------
              The end of the story, after the mark and the review — not before
              them, where it was competing with the score for the first thing
              the student read.

              The same `getNextUp` the Dashboard, Progress and the plan read.
              The attempts this sitting wrote are already inside it, so the
              recommendation reflects the paper that was just marked without a
              second engine being asked. Progress sits beside it because a sat
              paper is the largest piece of evidence this product ever collects
              and the student may reasonably want to see what it moved. */}
          <div className="space-y-3">
            <NextUpCard next={next} />
            <p className="text-meta text-ink-muted">
              <Link href="/progress" className="text-primary underline-offset-2 hover:underline">
                {t.standing.title}
              </Link>
            </p>
          </div>
        </div>
      )}
    </>
  );
}
