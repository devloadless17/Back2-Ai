'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { FlagButton } from '@/components/practice/flag-button';
import { Button, LinkButton } from '@/components/ui/button';
import { WorkingArea } from '@/components/ui/field';
import { Alert, Badge, EmptyState } from '@/components/ui/feedback';
import { MathText, QuestionBody } from '@/components/ui/math';
import { Meter } from '@/components/ui/progress';
import { RuledRow, Sheet, SheetBody, SheetFooter, SheetHeader } from '@/components/ui/sheet';
import { cn } from '@/lib/cn';
import { ApiRequestError, sendJson } from '@/lib/client/request';
import { useI18n } from '@/lib/i18n/client';

/**
 * The practice loop: answer → marked → solution → next.
 *
 * Two things here are deliberate rather than incidental:
 *
 *   * The mastery bar is live. It is handed the value returned by the attempt
 *     write and animates to it, so the student watches the number they just
 *     moved. Progress that only appears after a page refresh teaches them that
 *     nothing they do registers.
 *   * The solution is not fetched until an answer is submitted. There is no
 *     "peek" path in this component, because the whole value of practice is the
 *     minute spent stuck.
 */

export type PracticeQuestion = {
  /**
   * Which pool this came from. It changes the id field the attempt is posted
   * under, what a flag reports against, and whether a card is created — a
   * generated problem has no place in a long-term flashcard deck while its
   * source can still be withdrawn at review.
   */
  kind: 'question' | 'generated';
  id: string;
  questionType: 'mcq' | 'open' | 'problem';
  difficulty: number | null;
  contentText: string;
  contentLatex: string | null;
  contentImages: string[];
  options: { id: string; text: string }[] | null;
  baremeCriteria: string[];
  attemptedByYou: boolean;
};

type BaremeResultItem = {
  criterion: string;
  points_awarded: number;
  points_possible: number;
  justification: string;
};

type AttemptResponse = {
  attemptId: string;
  isCorrect: boolean | null;
  score: number | null;
  maxScore: number | null;
  baremeResult: BaremeResultItem[] | null;
  needsHumanReview: boolean;
  solution: string | null;
  mastery: { chapterId: string; masteryScore: number; attemptsCount: number };
};

export function PracticeRunner({
  chapterId,
  chapterName,
  questions,
  initialMastery,
  initialAttempts,
}: {
  chapterId: string;
  chapterName: string;
  questions: PracticeQuestion[];
  initialMastery: number;
  initialAttempts: number;
}) {
  const { t, formatPercent, formatScore, format } = useI18n();
  const router = useRouter();

  // Unattempted questions first — returning to a chapter should continue, not
  // restart. Order is otherwise preserved (easiest first).
  const ordered = useMemo(
    () => [...questions].sort((a, b) => Number(a.attemptedByYou) - Number(b.attemptedByYou)),
    [questions],
  );

  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState('');
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [result, setResult] = useState<AttemptResponse | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mastery, setMastery] = useState({ score: initialMastery, attempts: initialAttempts });
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const [askingExplain, setAskingExplain] = useState(false);
  const [poolExhausted, setPoolExhausted] = useState(false);
  const [queuedMore, setQueuedMore] = useState(false);

  const question = ordered[index];
  const isLast = index >= ordered.length - 1;

  async function submit() {
    if (!question || submitting) return;
    setSubmitting(true);
    setError(null);

    try {
      const response = await sendJson<AttemptResponse>('/api/attempts', 'POST', {
        ...(question.kind === 'generated'
          ? { generatedProblemId: question.id }
          : { questionId: question.id }),
        context: 'practice',
        ...(question.questionType === 'mcq'
          ? { selectedOptionId: selectedOption ?? '' }
          : { answerText: answer }),
        timeTakenSeconds: Math.min(24 * 3600, Math.round((Date.now() - startedAt) / 1000)),
      });

      setResult(response);
      setMastery({ score: response.mastery.masteryScore, attempts: response.mastery.attemptsCount });
      // The sidebar's flashcard count and the dashboard both change on this write.
      router.refresh();
    } catch (err) {
      setError(
        err instanceof ApiRequestError && err.code === 'OPTION_REQUIRED'
          ? t.practice.yourAnswer
          : t.common.unknownError,
      );
    } finally {
      setSubmitting(false);
    }
  }

  function next() {
    setResult(null);
    setAnswer('');
    setSelectedOption(null);
    setError(null);
    setStartedAt(Date.now());
    setIndex((current) => Math.min(current + 1, ordered.length));
  }

  /**
   * Opens a grounded conversation about this question.
   *
   * Once the answer has been marked, the attempt goes with it: the student's
   * question is almost never "what is the method" but "why did my version not
   * get the marks", and only the attempt can answer that. Generated problems
   * have no attempt to anchor to, so they fall back to the question.
   */
  async function explain() {
    if (!question) return;
    setAskingExplain(true);
    try {
      const session = await sendJson<{ id: string }>('/api/chat/sessions', 'POST', {
        ...(result && question.kind === 'question'
          ? { attemptId: result.attemptId }
          : { questionId: question.id }),
      });
      router.push(`/chat/${session.id}`);
    } catch {
      setError(t.common.unknownError);
      setAskingExplain(false);
    }
  }

  /** Asks the pool for one more problem in this chapter. */
  async function requestMore() {
    setSubmitting(true);
    try {
      const response = await sendJson<{ source: string; queued: boolean }>(
        '/api/generation/practice',
        'POST',
        { chapterId },
      );
      if (response.source === 'pool') {
        router.refresh();
      } else {
        setPoolExhausted(true);
        setQueuedMore(response.queued);
      }
    } catch {
      setPoolExhausted(true);
    } finally {
      setSubmitting(false);
    }
  }

  // --- Finished every question in the chapter -----------------------------
  if (!question) {
    return (
      <div className="space-y-5">
        <EmptyState
          tone="positive"
          title={t.practice.chapterComplete}
          body={
            poolExhausted && queuedMore
              ? t.admin.publishNotice
              : poolExhausted
                ? t.practice.chapterCompleteHint
                : t.practice.chapterCompleteHint
          }
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <LinkButton href="/flashcards/review" variant="primary">
                {t.flashcards.startReview}
              </LinkButton>
              {!poolExhausted && (
                <Button onClick={requestMore} loading={submitting}>
                  {t.practice.nextQuestion}
                </Button>
              )}
            </div>
          }
        />
        <MasterySheet score={mastery.score} attempts={mastery.attempts} chapterName={chapterName} />
      </div>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_260px]">
      <div className="min-w-0 space-y-5">
        <Sheet>
          <SheetHeader
            title={`${t.practice.question} ${index + 1} ${t.common.of} ${ordered.length}`}
            description={difficultyLabel(question.difficulty, t)}
            actions={
              question.attemptedByYou ? <Badge tone="neutral">{t.practice.attempts}</Badge> : null
            }
          />

          <SheetBody>
            <QuestionBody
              contentText={question.contentText}
              contentLatex={question.contentLatex}
              images={question.contentImages}
            />
          </SheetBody>

          <SheetBody className="border-t border-rule">
            {question.questionType === 'mcq' && question.options ? (
              <fieldset className="space-y-2" disabled={Boolean(result)}>
                <legend className="mb-2 text-[13px] font-medium text-ink">{t.practice.yourAnswer}</legend>
                {question.options.map((option) => (
                  <label
                    key={option.id}
                    className={cn(
                      'flex cursor-pointer items-start gap-3 rounded border px-3 py-2.5 transition-colors duration-150',
                      selectedOption === option.id
                        ? 'border-primary bg-primary-soft'
                        : 'border-rule-strong hover:bg-paper-sunken',
                      result && 'cursor-default',
                    )}
                  >
                    <input
                      type="radio"
                      name="option"
                      value={option.id}
                      checked={selectedOption === option.id}
                      onChange={() => setSelectedOption(option.id)}
                      className="mt-1 h-4 w-4 shrink-0 accent-[hsl(var(--primary))]"
                    />
                    <MathText compact className="min-w-0 flex-1">
                      {option.text}
                    </MathText>
                  </label>
                ))}
              </fieldset>
            ) : (
              <div className="space-y-2">
                <label htmlFor="working" className="block text-[13px] font-medium text-ink">
                  {t.practice.yourAnswer}
                </label>
                <WorkingArea
                  id="working"
                  value={answer}
                  onChange={(event) => setAnswer(event.target.value)}
                  placeholder={t.practice.yourAnswerPlaceholder}
                  disabled={Boolean(result)}
                />
                {question.baremeCriteria.length > 0 && !result && (
                  <p className="text-[12.5px] text-ink-muted">
                    {`${t.examSim.baremeBreakdown}: ${question.baremeCriteria.length}`}
                  </p>
                )}
              </div>
            )}

            {error && (
              <Alert tone="error" className="mt-3">
                {error}
              </Alert>
            )}
          </SheetBody>

          <SheetFooter className="justify-between">
            <FlagButton
              itemType={question.kind === 'generated' ? 'generated_problem' : 'tagged_question'}
              itemId={question.id}
            />

            {result ? (
              <div className="flex gap-2">
                <Button onClick={explain} loading={askingExplain}>
                  {t.practice.explainThis}
                </Button>
                <Button variant="primary" onClick={next}>
                  {isLast ? t.common.next : t.practice.nextQuestion}
                </Button>
              </div>
            ) : (
              <Button variant="primary" onClick={submit} loading={submitting}>
                {t.practice.checkAnswer}
              </Button>
            )}
          </SheetFooter>
        </Sheet>

        {result && <ResultSheet result={result} />}
      </div>

      <div className="space-y-5">
        <MasterySheet score={mastery.score} attempts={mastery.attempts} chapterName={chapterName} />
      </div>
    </div>
  );

  function difficultyLabel(difficulty: number | null, dict: typeof t): string | undefined {
    if (difficulty === null) return undefined;
    if (difficulty < 0.34) return dict.practice.difficultyEasy;
    if (difficulty < 0.67) return dict.practice.difficultyMedium;
    return dict.practice.difficultyHard;
  }

  function ResultSheet({ result: outcome }: { result: AttemptResponse }) {
    const tone =
      outcome.isCorrect === true
        ? 'correct'
        : outcome.isCorrect === false
          ? 'incorrect'
          : outcome.maxScore && outcome.score !== null
            ? outcome.score >= outcome.maxScore
              ? 'correct'
              : outcome.score > 0
                ? 'partial'
                : 'incorrect'
            : 'partial';

    return (
      <Sheet className="animate-fade-up">
        <SheetHeader
          title={
            tone === 'correct'
              ? t.practice.correct
              : tone === 'partial'
                ? t.practice.partial
                : t.practice.incorrect
          }
          description={
            outcome.score !== null && outcome.maxScore !== null
              ? format(t.practice.scoreAwarded, {
                  score: formatScore(outcome.score),
                  max: formatScore(outcome.maxScore),
                })
              : t.practice.attemptSaved
          }
          actions={
            <Badge tone={tone === 'correct' ? 'correct' : tone === 'partial' ? 'partial' : 'mark'}>
              {tone === 'correct' ? t.practice.correct : tone === 'partial' ? t.practice.partial : t.practice.incorrect}
            </Badge>
          }
        />

        {outcome.needsHumanReview && (
          <SheetBody className="pb-0">
            <Alert tone="warning">{t.chat.aiNotConfiguredHint}</Alert>
          </SheetBody>
        )}

        {outcome.baremeResult && outcome.baremeResult.length > 0 && (
          <SheetBody className="p-0">
            <div className="ruled">
              {outcome.baremeResult.map((item, i) => (
                <RuledRow key={`${item.criterion}-${i}`} className="flex-col items-stretch gap-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="min-w-0 text-[13.5px] font-medium text-ink">{item.criterion}</p>
                    <p
                      className={cn(
                        'shrink-0 tabular-nums text-[13px] font-semibold',
                        item.points_awarded >= item.points_possible
                          ? 'text-correct'
                          : item.points_awarded > 0
                            ? 'text-partial'
                            : 'text-mark',
                      )}
                    >
                      {formatScore(item.points_awarded)} / {formatScore(item.points_possible)}
                    </p>
                  </div>
                  <p className="text-[12.5px] leading-snug text-ink-muted">{item.justification}</p>
                </RuledRow>
              ))}
            </div>
          </SheetBody>
        )}

        {outcome.solution && (
          <>
            <SheetHeader title={t.practice.officialSolution} className="border-t" />
            <SheetBody>
              <MathText>{outcome.solution}</MathText>
            </SheetBody>
          </>
        )}
      </Sheet>
    );
  }

  function MasterySheet({
    score,
    attempts,
    chapterName: name,
  }: {
    score: number;
    attempts: number;
    chapterName: string;
  }) {
    return (
      <Sheet>
        <SheetHeader title={t.practice.mastery} description={name} />
        <SheetBody className="space-y-3">
          <p className="font-serif text-3xl font-semibold tabular-nums leading-none">
            {formatPercent(score)}
          </p>
          <Meter value={score} caption={`${attempts} ${t.practice.attempts}`} />
        </SheetBody>
      </Sheet>
    );
  }
}
