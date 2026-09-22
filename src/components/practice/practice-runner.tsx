'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { AcademicQuestion } from '@/components/practice/academic-question';
import { ExaminerMark } from '@/components/practice/examiner-mark';
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
  /** The paper this came off. Null for textbook and generated questions. */
  examYear: number | null;
  examSession: string | null;
  /** Total marks, summed from the barème. Null when it carries none. */
  marks: number | null;
  attemptedByYou: boolean;
};

type BaremeResultItem = {
  criterion: string;
  points_awarded: number;
  points_possible: number;
  justification: string;
  /** Set when the criterion is ours rather than the examiner's. */
  provisional?: boolean;
};

type AttemptResponse = {
  attemptId: string;
  isCorrect: boolean | null;
  score: number | null;
  maxScore: number | null;
  baremeResult: BaremeResultItem[] | null;
  /**
   * How often each lost criterion has cost this student marks before, keyed by
   * the criterion text. Server-computed from every persisted attempt — the
   * runner holds only what is on screen and could not count this honestly.
   */
  repeats?: Record<string, { times: number; pointsLost: number }>;
  needsHumanReview: boolean;
  /** True only for a past-exam question. A generated problem's is ours. */
  solutionIsOfficial?: boolean;
  solution: string | null;
  mastery: { chapterId: string; masteryScore: number; attemptsCount: number };
};

/**
 * Fisher-Yates within each difficulty band, bands left in their given order.
 * Keeps the easiest-first scaffolding while a student does not solve the same
 * question first every time they open the chapter.
 */
function shuffleWithinDifficulty(questions: PracticeQuestion[]): PracticeQuestion[] {
  const bands = new Map<number | null, PracticeQuestion[]>();
  for (const question of questions) {
    const band = bands.get(question.difficulty);
    if (band) band.push(question);
    else bands.set(question.difficulty, [question]);
  }

  const shuffled: PracticeQuestion[] = [];
  for (const band of bands.values()) {
    for (let i = band.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [band[i], band[j]] = [band[j]!, band[i]!];
    }
    shuffled.push(...band);
  }
  return shuffled;
}

export function PracticeRunner({
  chapterId,
  chapterName,
  questions,
  initialMastery,
  initialAttempts,
  paperDir,
}: {
  chapterId: string;
  chapterName: string;
  questions: PracticeQuestion[];
  initialMastery: number;
  initialAttempts: number;
  /** The subject's own reading direction. See `ExamRunner`. */
  paperDir: 'ltr' | 'rtl';
}) {
  const { t, formatPercent, formatScore, format } = useI18n();
  const router = useRouter();

  /*
   * Never a question this student has already answered — repetition of
   * material already seen is what flashcards are for (see the "Start review"
   * link on the chapter-complete screen below), not fresh practice. Once this
   * runs out, `requestMore` asks the pool for something the student has never
   * attempted, generating one if the pool is empty; it never falls back to a
   * repeat.
   *
   * Difficulty bands stay in order (easiest first), but which question leads
   * within a band is reshuffled each time this list loads, so two sessions in
   * the same chapter do not open on the same question either.
   */
  const ordered = useMemo(
    () => shuffleWithinDifficulty(questions.filter((q) => !q.attemptedByYou)),
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
        // The chapter on screen, which is not always the one the exercise is
        // filed under — a GS student practises LS chemistry questions inside
        // their own GS chapter, and the mark belongs there.
        chapterId,
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
    /*
     * THE LAYOUT CHANGES WHEN COMPARISON BECOMES USEFUL, and not before.
     *
     * While answering, the student is solving: the question takes the width and
     * a narrow rail carries their mastery. Surrounding someone mid-derivation
     * with empty examiner infrastructure would be decoration.
     *
     * Once marked, the second column becomes the result, so the answer they
     * wrote and the criteria it was measured against sit side by side and the
     * eye moves between them without scrolling. `xl` rather than `lg`: at 1024
     * a mathematical question and a barème in two columns are both too narrow,
     * and a cramped comparison is worse than a scrolled one.
     *
     * Below xl everything stacks, which IS the mobile sequence — question,
     * answer, mark, criteria, solution, action — in that order, because that is
     * the order the DOM is written in.
     */
    <div
      className={cn(
        'grid gap-5',
        result
          ? 'xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]'
          : 'lg:grid-cols-[minmax(0,1fr)_260px]',
      )}
    >
      <div className="min-w-0 space-y-5">
        <Sheet>
          <SheetHeader
            title={`${t.practice.question} ${index + 1} ${t.common.of} ${ordered.length}`}
            description={difficultyLabel(question.difficulty, t)}
          />

          {/*
            The canonical question presentation, shared with the mock exam, past
            papers and worksheets rather than drawn again in each. It owns the
            question and its provenance; the answer workspace below stays here,
            because a worksheet has no workspace and a past paper has no submit.
          */}
          <SheetBody>
            <AcademicQuestion
              contentText={question.contentText}
              contentLatex={question.contentLatex}
              images={question.contentImages}
              dir={paperDir}
              meta={{
                chapterName,
                examYear: question.examYear,
                examSession: question.examSession,
                marks: question.marks,
              }}
              labels={{
                officialBac: t.practice.officialBac,
                session: t.evidence.session,
                marks: t.evidence.marks,
                question: t.practice.question,
              }}
            />
          </SheetBody>

          <SheetBody className="border-t border-rule">
            {question.questionType === 'mcq' && question.options ? (
              <fieldset className="space-y-2" disabled={Boolean(result)}>
                <legend className="mb-2 text-meta font-medium text-ink">{t.practice.yourAnswer}</legend>
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
                    <MathText compact dir={paperDir} className="min-w-0 flex-1">
                      {option.text}
                    </MathText>
                  </label>
                ))}
              </fieldset>
            ) : (
              <div className="space-y-2">
                <label htmlFor="working" className="block text-meta font-medium text-ink">
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
                  <p className="text-meta text-ink-muted">
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

          {/*
            Submit only. The post-marking actions used to live here, which put
            them ABOVE the result in the DOM — so on a phone the student was
            offered "next question" before they had seen their mark. They now
            sit after the result, where the sequence ends.
          */}
          {!result && (
            <SheetFooter className="justify-between">
              <FlagButton
                itemType={question.kind === 'generated' ? 'generated_problem' : 'tagged_question'}
                itemId={question.id}
              />
              <Button variant="primary" onClick={submit} loading={submitting}>
                {t.practice.checkAnswer}
              </Button>
            </SheetFooter>
          )}
        </Sheet>
      </div>

      {result ? (
        <div className="min-w-0 space-y-5">
          <ResultSheet result={result} />

          {/*
            ONE PRIMARY ACTION AND ONE SECONDARY, both real.

            `next` advances the index and, past the last question, lands on the
            completion state — so it stays correct on the final question rather
            than needing a disabled button. `explain` opens a conversation
            anchored to THIS ATTEMPT, which is why it is worth its place: the
            student's question after a lost mark is not "what is the method" but
            "why did mine not get the marks", and only the attempt can answer
            that.

            There is no "try again": nothing in the runner or the API supports
            re-marking an attempt, and a button that silently created a second
            one would misrepresent the record.
          */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <FlagButton
              itemType={question.kind === 'generated' ? 'generated_problem' : 'tagged_question'}
              itemId={question.id}
            />
            <div className="flex flex-wrap gap-2">
              <Button onClick={explain} loading={askingExplain}>
                {t.practice.explainThis}
              </Button>
              <Button variant="primary" onClick={next}>
                {isLast ? t.common.next : t.practice.nextQuestion}
              </Button>
            </div>
          </div>

          <MasterySheet
            score={mastery.score}
            attempts={mastery.attempts}
            chapterName={chapterName}
          />
        </div>
      ) : (
        <div className="space-y-5">
          <MasterySheet
            score={mastery.score}
            attempts={mastery.attempts}
            chapterName={chapterName}
          />
        </div>
      )}
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
      // A full-marks answer gets a pulsing ring for a moment. It is the only
      // celebration in the product and it is deliberately small — this is a
      // revision tool, and confetti after every correct answer stops meaning
      // anything by the fourth question.
      <Sheet
        className={cn('animate-fade-in', tone === 'correct' && '')}
      >
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

        {/*
          THE MARK IS NOT FINAL, and the student is told so before they read it.
          
          This was showing `chat.aiNotConfiguredHint` — "an administrator needs
          to set an AI provider key" — to a student who had just written an
          answer. Wrong copy, wrong audience, and it described our deployment
          rather than their work.
          
          It does NOT promise that a teacher will look at it. `needs_human_review`
          means the marker declined, and whether anybody ever reviews it is a
          workflow question this component cannot answer. Saying "a teacher will
          review this shortly" would be an invented promise.
        */}
        {outcome.needsHumanReview && (
          <SheetBody className="pb-0">
            <Alert tone="warning" title={t.practice.notMarkedTitle}>
              {t.practice.notMarkedBody}
            </Alert>
          </SheetBody>
        )}

        {/*
          The barème, criterion by criterion, with the student-facing note set
          apart from the examiner's wording.

          This replaces a list that printed `justification` — the field written
          for a TEACHER arbitrating a contested mark. A student read an argument
          composed for somebody judging against them, and never saw
          `explanation`, which was written for them and stored on the same row.

          `provisional` moves from a banner over the whole result to the
          individual criteria it describes: a paper can mix an exercise whose
          scheme survived extraction with one whose did not, and one notice
          covering both has to lie about one of them.
        */}
        {outcome.baremeResult && outcome.baremeResult.length > 0 && (
          <ExaminerMark
            total={outcome.score ?? 0}
            max={outcome.maxScore ?? 0}
            criteria={outcome.baremeResult}
            repeats={outcome.repeats ? new Map(Object.entries(outcome.repeats)) : undefined}
            labels={{
              title: t.practice.examinerTitle,
              nourNote: t.practice.nourNote,
              provisional: t.practice.criterionProvisional,
              repeated: t.practice.repeatedLoss,
            }}
          />
        )}

        {/*
          THE MODEL ANSWER, LAST AND COLLAPSED.
          
          Deliberately after the marking rather than beside it. Handing a
          student the model answer first teaches less than showing them what
          happened to THEIRS — they read the good version, recognise it, and
          never work out why their own lost the mark. So the sequence is: your
          mark, how the barème awarded it, Nour on the difference, and only
          then this. Available, one tap, not hidden.

          THE LABEL IS TRUE. A past-exam question carries the ministry's
          solution; a generated problem carries one this system wrote, and both
          arrived under the same field and were labelled "Official solution".
          `solutionIsOfficial` now travels with it so the heading can be honest
          — the same rule the evidence work in Nour follows.
        */}
        {outcome.solution && (
          <details className="border-t border-rule">
            <summary className="cursor-pointer list-none px-5 py-3 text-meta font-medium text-ink transition-colors hover:bg-paper-sunken">
              {outcome.solutionIsOfficial
                ? t.practice.officialSolution
                : t.practice.modelSolution}
            </summary>
            <SheetBody className="pt-0">
              <MathText dir={paperDir}>{outcome.solution}</MathText>
            </SheetBody>
          </details>
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
          <p className="figure text-display leading-none">
            {formatPercent(score)}
          </p>
          <Meter value={score} caption={`${attempts} ${t.practice.attempts}`} />
        </SheetBody>
      </Sheet>
    );
  }
}
