'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { useTutorSession } from '@/components/chat/use-tutor-session';
import { ChoiceList } from '@/components/practice/choice-list';
import { ExaminerMark, type MarkedCriterion } from '@/components/practice/examiner-mark';
import { ModelAnswer } from '@/components/practice/model-answer';
import { Button, LinkButton } from '@/components/ui/button';
import { WorkingArea } from '@/components/ui/field';
import { Alert, Badge } from '@/components/ui/feedback';
import { MathText, QuestionBody } from '@/components/ui/math';
import { Meter } from '@/components/ui/progress';
import { Sheet, SheetBody, SheetFooter, SheetHeader } from '@/components/ui/sheet';
import { cn } from '@/lib/cn';
import { aiErrorMessage } from '@/lib/client/ai-error';
import { sendJson } from '@/lib/client/request';
import { useI18n } from '@/lib/i18n/client';

/**
 * Quiz mode: answer everything, then find out.
 *
 * Nothing is submitted until the end, and nothing is revealed until it is —
 * that withholding is the entire point of a quiz as distinct from practice. It
 * also means the marking cost lands once, in a single burst the student is
 * expecting to wait for, rather than as a pause between every question.
 *
 * Answers are held in memory until submit. A quiz is five questions and a few
 * minutes; the complexity of draft-saving would buy less than it costs.
 */

export type QuizQuestion = {
  id: string;
  questionType: 'mcq' | 'open' | 'problem';
  contentText: string;
  contentLatex: string | null;
  contentImages: string[];
  options: { id: string; text: string }[] | null;
  hasBareme: boolean;
  /** The paper's extract, for a comprehension question. */
  passage?: string | null;
};

type AttemptResponse = {
  attemptId: string;
  isCorrect: boolean | null;
  score: number | null;
  maxScore: number | null;
  /** Each criterion, with `explanation` — the student-facing note on a lost mark. */
  baremeResult: MarkedCriterion[] | null;
  repeats?: Record<string, { times: number; pointsLost: number }>;
  solution: string | null;
  solutionIsOfficial?: boolean;
  /** The right option, for a multiple-choice question. */
  correctOptionId?: string | null;
  needsHumanReview: boolean;
};

type Outcome = AttemptResponse & { questionId: string };

export function QuizRunner({
  questions,
  subjectId,
  chapterId,
  paperDir,
}: {
  questions: QuizQuestion[];
  subjectId: string;
  chapterId: string;
  /** The subject's own reading direction. See `ExamRunner`. */
  paperDir: 'ltr' | 'rtl';
}) {
  const { t, formatScore, formatPercent } = useI18n();
  const router = useRouter();
  const tutor = useTutorSession();

  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [outcomes, setOutcomes] = useState<Outcome[] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const question = questions[index];
  const answeredCount = questions.filter(
    (q) => (answers[q.id] ?? '').trim().length > 0 || choices[q.id],
  ).length;

  async function submit() {
    setSubmitting(true);
    setError(null);

    try {
      // Sequential, not parallel: marking runs on the verify model at high
      // effort, and five of those at once is how you get rate-limited halfway
      // through someone's quiz.
      const results: Outcome[] = [];

      for (const q of questions) {
        const response = await sendJson<AttemptResponse>('/api/attempts', 'POST', {
          questionId: q.id,
          context: 'quiz',
          ...(q.questionType === 'mcq'
            ? { selectedOptionId: choices[q.id] ?? '' }
            : { answerText: answers[q.id] ?? '' }),
        });
        results.push({ ...response, questionId: q.id });
      }

      setOutcomes(results);
      router.refresh();
    } catch (err) {
      setError(aiErrorMessage(err, t));
    } finally {
      setSubmitting(false);
    }
  }

  // --- Results -----------------------------------------------------------
  if (outcomes) {
    const scored = outcomes.filter((o) => o.score !== null && o.maxScore !== null);
    const binary = outcomes.filter((o) => o.isCorrect !== null);

    const earned =
      scored.reduce((sum, o) => sum + (o.score ?? 0), 0) +
      binary.filter((o) => o.isCorrect).length;
    const available =
      scored.reduce((sum, o) => sum + (o.maxScore ?? 0), 0) + binary.length;
    const ratio = available > 0 ? earned / available : 0;

    return (
      <div className="space-y-5">
        <Sheet className="animate-fade-up">
          <SheetHeader title={t.examSim.resultsTitle} />
          <SheetBody className="space-y-3">
            <p className="figure text-hero leading-none">
              {formatScore(earned)}
              <span className="text-title font-normal text-ink-faint">
                {' / '}
                {formatScore(available)}
              </span>
            </p>
            <Meter value={ratio} caption={formatPercent(ratio)} />
          </SheetBody>
          <SheetFooter className="justify-end">
            <LinkButton href={`/practice/${subjectId}/${chapterId}`}>{t.nav.practice}</LinkButton>
            <LinkButton href={`/practice/${subjectId}/${chapterId}/quiz`} variant="primary">
              {t.common.retry}
            </LinkButton>
          </SheetFooter>
        </Sheet>

        {questions.map((q, i) => {
          const outcome = outcomes.find((o) => o.questionId === q.id);
          if (!outcome) return null;

          /*
           * FOUR STATES, NOT THREE. An answer the marker declined (or an empty
           * one with no barème) has no mark at all, and it used to be shown as
           * "Incorrect" — telling a student they were wrong when nobody had
           * judged it.
           */
          const unmarked = outcome.isCorrect === null && outcome.score === null;
          const correct =
            outcome.isCorrect === true ||
            (outcome.score !== null && outcome.maxScore !== null && outcome.score >= outcome.maxScore);
          const partial = !correct && !unmarked && (outcome.score ?? 0) > 0;
          const tone = correct ? 'correct' : partial ? 'partial' : unmarked ? 'neutral' : 'mark';

          const written = (answers[q.id] ?? '').trim();
          const chosen = choices[q.id];

          return (
            <Sheet key={q.id}>
              <SheetHeader
                title={`${t.practice.question} ${i + 1}`}
                description={
                  outcome.score !== null && outcome.maxScore !== null
                    ? `${formatScore(outcome.score)} / ${formatScore(outcome.maxScore)}`
                    : undefined
                }
                actions={
                  <Badge tone={tone}>
                    {correct
                      ? t.practice.correct
                      : partial
                        ? t.practice.partial
                        : unmarked
                          ? t.practice.notMarkedBadge
                          : t.practice.incorrect}
                  </Badge>
                }
              />
              <SheetBody>
                <QuestionBody
                  contentText={q.contentText}
                  contentLatex={q.contentLatex}
                  images={q.contentImages}
                  dir={paperDir}
                  passage={q.passage}
                />
              </SheetBody>

              {/*
                WHAT THEY WROTE, next to how it was judged. A mark with no
                answer beside it cannot be understood a minute later.
              */}
              <SheetBody className="border-t border-rule">
                <p className="mb-2 text-meta font-medium text-ink">{t.practice.yourAnswer}</p>
                {q.questionType === 'mcq' && q.options ? (
                  <ul className="space-y-2">
                    {q.options.map((option) => {
                      const isChosen = option.id === chosen;
                      const isRight = option.id === outcome.correctOptionId;
                      return (
                        <li
                          key={option.id}
                          className={cn(
                            'flex items-start gap-3 rounded border px-3 py-2.5',
                            isRight
                              ? 'border-correct/50 bg-correct-soft'
                              : isChosen
                                ? 'border-mark/50 bg-mark-soft'
                                : 'border-rule',
                          )}
                        >
                          <span
                            aria-hidden
                            className={cn(
                              'w-4 shrink-0 text-sm font-medium',
                              isRight ? 'text-correct' : 'text-mark',
                            )}
                          >
                            {isRight ? '✓' : isChosen ? '×' : ''}
                          </span>
                          <MathText compact dir={paperDir} className="min-w-0 flex-1">
                            {option.text}
                          </MathText>
                          {(isChosen || isRight) && (
                            <span
                              className={cn(
                                'shrink-0 text-caption font-medium',
                                isRight ? 'text-correct' : 'text-mark',
                              )}
                            >
                              {isRight ? t.practice.correctAnswer : t.practice.yourAnswer}
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                ) : written ? (
                  <pre className="scroll-x max-h-56 overflow-y-auto whitespace-pre-wrap font-mono text-meta leading-relaxed text-ink">
                    {written}
                  </pre>
                ) : (
                  <p className="text-sm text-ink-muted">{t.examSim.notAnswered}</p>
                )}
              </SheetBody>

              {(outcome.needsHumanReview || (unmarked && written)) && (
                <SheetBody className="pt-0">
                  <Alert tone="warning" title={t.practice.notMarkedTitle}>
                    {t.practice.notMarkedBody}
                  </Alert>
                </SheetBody>
              )}

              {/*
                Criterion by criterion, with Zaki's note on each lost mark —
                the same view practice uses. This printed `justification`,
                which is written for a teacher reviewing the mark, so the
                student never saw what was wrong or how to fix it.
              */}
              {outcome.baremeResult && outcome.baremeResult.length > 0 && (
                <div className="border-t border-rule">
                  <ExaminerMark
                    total={outcome.score ?? 0}
                    max={outcome.maxScore ?? 0}
                    criteria={outcome.baremeResult}
                    repeats={outcome.repeats ? new Map(Object.entries(outcome.repeats)) : undefined}
                    dir={paperDir}
                    labels={{
                      title: t.practice.examinerTitle,
                      zakiNote: t.practice.zakiNote,
                      provisional: t.practice.criterionProvisional,
                      repeated: t.practice.repeatedLoss,
                    }}
                  />
                </div>
              )}

              {outcome.solution ? (
                <details className="border-t border-rule" open={!correct}>
                  <summary className="cursor-pointer list-none px-5 py-3 text-meta font-medium text-ink transition-colors hover:bg-paper-sunken">
                    {outcome.solutionIsOfficial === false
                      ? t.practice.modelSolution
                      : t.practice.officialSolution}
                  </summary>
                  <SheetBody className="pt-0">
                    <MathText dir={paperDir}>{outcome.solution}</MathText>
                  </SheetBody>
                </details>
              ) : (
                q.questionType !== 'mcq' && <ModelAnswer questionId={q.id} dir={paperDir} />
              )}

              {/* The attempt goes with it, so Zaki reads what they wrote and
                  can say which step went wrong. */}
              {!correct && (
                <SheetFooter className="justify-end">
                  <Button
                    onClick={() => void tutor.open({ attemptId: outcome.attemptId, ask: 'why' })}
                    loading={tutor.opening}
                  >
                    {t.practice.whyWrong}
                  </Button>
                </SheetFooter>
              )}
            </Sheet>
          );
        })}
        {tutor.failed && <Alert tone="error">{t.common.unknownError}</Alert>}
      </div>
    );
  }

  if (!question) return null;

  // --- Taking the quiz ---------------------------------------------------
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Meter
        value={answeredCount / questions.length}
        label={`${answeredCount} ${t.common.of} ${questions.length}`}
        size="sm"
        tone="primary"
      />

      <Sheet>
        <SheetHeader
          title={`${t.practice.question} ${index + 1} ${t.common.of} ${questions.length}`}
          description={t.examSim.gradingHint}
        />

        <SheetBody>
          <QuestionBody
            contentText={question.contentText}
            contentLatex={question.contentLatex}
            images={question.contentImages}
            dir={paperDir}
            passage={question.passage}
          />
        </SheetBody>

        <SheetBody className="border-t border-rule">
          {question.questionType === 'mcq' && question.options ? (
            <ChoiceList
              name={`q-${question.id}`}
              legend={t.practice.yourAnswer}
              options={question.options}
              value={choices[question.id]}
              onChange={(optionId) => setChoices((c) => ({ ...c, [question.id]: optionId }))}
              dir={paperDir}
            />
          ) : (
            <div className="space-y-2">
              <label htmlFor="quiz-answer" className="block text-meta font-medium text-ink">
                {t.practice.yourAnswer}
              </label>
              <WorkingArea
                id="quiz-answer"
                value={answers[question.id] ?? ''}
                onChange={(event) =>
                  setAnswers((a) => ({ ...a, [question.id]: event.target.value }))
                }
                placeholder={t.practice.yourAnswerPlaceholder}
              />
            </div>
          )}

          {error && (
            <Alert tone="error" className="mt-3">
              {error}
            </Alert>
          )}
        </SheetBody>

        <SheetFooter className="justify-between">
          <Button
            variant="quiet"
            onClick={() => setIndex((i) => Math.max(0, i - 1))}
            disabled={index === 0}
          >
            {t.common.previous}
          </Button>

          {index < questions.length - 1 ? (
            <Button onClick={() => setIndex((i) => i + 1)}>{t.common.next}</Button>
          ) : (
            <Button variant="primary" onClick={submit} loading={submitting}>
              {submitting ? t.examSim.grading : t.common.submit}
            </Button>
          )}
        </SheetFooter>
      </Sheet>

      {/* Question pips, so an unanswered question is visible before submitting. */}
      <nav className="flex flex-wrap justify-center gap-1.5" aria-label={t.todos.actionQuiz}>
        {questions.map((q, i) => {
          const done = (answers[q.id] ?? '').trim().length > 0 || Boolean(choices[q.id]);
          return (
            <button
              key={q.id}
              type="button"
              onClick={() => setIndex(i)}
              aria-current={i === index ? 'step' : undefined}
              className={cn(
                'h-8 w-8 rounded border text-meta font-medium tabular-nums transition-colors duration-150',
                i === index
                  ? 'border-ink bg-ink text-paper'
                  : done
                    ? 'border-correct/40 bg-correct-soft text-correct'
                    : 'border-rule-strong bg-paper-raised text-ink-muted hover:bg-paper-sunken',
              )}
            >
              {i + 1}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
