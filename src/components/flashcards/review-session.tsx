'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { FlipCard } from '@/components/flashcards/flip-card';
import { Button, LinkButton } from '@/components/ui/button';
import { Badge, EmptyState } from '@/components/ui/feedback';
import { MathText } from '@/components/ui/math';
import { IconAgain, IconEasy, IconGood, IconHard } from '@/components/shell/icons';
import { Meter, SessionDots } from '@/components/ui/progress';
import { Sheet, SheetBody, SheetFooter, SheetHeader } from '@/components/ui/sheet';
import { cn } from '@/lib/cn';
import { sendJson } from '@/lib/client/request';
import { useI18n } from '@/lib/i18n/client';
import type { DueCard } from '@/lib/queries/flashcards';
import type { ReviewGrade } from '@/lib/scoring/sm2';

/**
 * The review loop.
 *
 * The card leaves the screen when it is graded — it slides out and the next one
 * arrives — rather than the list silently getting shorter behind a static
 * layout. That movement is the feedback: it is the difference between "I did
 * twenty cards" and "the list went from 20 to 0 while I looked at it".
 *
 * A failed card is put back into the queue for this same sitting, which is what
 * "Again" means to a student. SM-2 has already scheduled it for tomorrow; the
 * in-session repeat is on top of that, not instead of it.
 */

/**
 * Each grade carries its own shape, not a position on a colour ramp.
 *
 * Four buttons shading red-through-green is the classic spaced-repetition
 * layout and it is exactly the pattern the status rules rule out: "a bit more
 * orange than the one beside it" is not a distinction a colourblind student can
 * make, and it is no distinction at all in greyscale. The icon does the work;
 * the colour agrees with it.
 */
const GRADES: { grade: ReviewGrade; tone: string; Icon: typeof IconAgain }[] = [
  { grade: 'again', tone: 'border-mark/40 text-mark hover:bg-mark-soft', Icon: IconAgain },
  { grade: 'hard', tone: 'border-partial/40 text-partial hover:bg-partial-soft', Icon: IconHard },
  { grade: 'good', tone: 'border-rule-strong text-ink hover:bg-paper-sunken', Icon: IconGood },
  { grade: 'easy', tone: 'border-correct/40 text-correct hover:bg-correct-soft', Icon: IconEasy },
];

export function ReviewSession({ cards }: { cards: DueCard[] }) {
  const { t, format } = useI18n();
  const router = useRouter();

  const [queue, setQueue] = useState(cards);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [reviewed, setReviewed] = useState(0);
  const [lapses, setLapses] = useState(0);

  const card = queue[index];
  const total = cards.length;

  /*
   * Keyboard review.
   *
   * A forty-card session is forty clicks on a small target, twice each. Every
   * spaced-repetition tool people already use is driven from the keyboard —
   * space to flip, 1–4 to grade — and matching that turns a session from a
   * chore into something that takes two minutes.
   *
   * Guarded on the flip state so a stray "3" before the answer is shown cannot
   * grade a card the student has not looked at.
   */
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      // Never steal keys from a text field.
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (!card || leaving) return;

      if (!flipped) {
        if (event.key === ' ' || event.key === 'Enter') {
          event.preventDefault();
          setFlipped(true);
        }
        return;
      }

      const byNumber: Record<string, ReviewGrade> = {
        '1': 'again',
        '2': 'hard',
        '3': 'good',
        '4': 'easy',
      };

      const grade = byNumber[event.key] ?? (event.key === ' ' ? 'good' : undefined);
      if (grade) {
        event.preventDefault();
        void gradeCard(grade);
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  });

  async function gradeCard(value: ReviewGrade) {
    if (!card || leaving) return;

    setLeaving(true);
    setReviewed((count) => count + 1);
    if (value === 'again') setLapses((count) => count + 1);

    // Post in the background — the student should not wait on the network
    // between two cards.
    void sendJson('/api/flashcards/review', 'POST', {
      source: card.source,
      cardId: card.cardId,
      grade: value,
    }).catch(() => undefined);

    const shouldRepeat = value === 'again';

    // Let the exit animation play before swapping the content.
    window.setTimeout(() => {
      setQueue((current) => (shouldRepeat ? [...current, card] : current));
      setIndex((current) => current + 1);
      setFlipped(false);
      setLeaving(false);
    }, 180);
  }

  if (!card) {
    const isCaughtUp = total === 0;

    return (
      <div className="space-y-5">
        <EmptyState
          tone="positive"
          title={isCaughtUp ? t.flashcards.noneDue : t.flashcards.sessionComplete}
          body={
            isCaughtUp
              ? t.flashcards.noneDueHint
              : format(t.flashcards.sessionCompleteBody, { count: reviewed, again: lapses })
          }
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <LinkButton href="/dashboard" variant="primary">
                {t.errors.goHome}
              </LinkButton>
              <LinkButton href="/practice">{t.nav.practice}</LinkButton>
            </div>
          }
        />
        {reviewed > 0 && (
          <div className="mx-auto max-w-md">
            <Meter value={1} label={t.flashcards.title} caption={`${reviewed}`} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SessionDots
          total={total}
          done={reviewed}
          label={`${Math.min(reviewed + 1, total)} ${t.common.of} ${total}`}
        />
        <p className="numeric text-caption text-ink-muted">
          {format(t.flashcards.dueCount, { count: queue.length - index })}
        </p>
      </div>

      {/*
        The card turns to reveal the answer.
        
        The turn is the interaction, not decoration — it is what makes "did I
        actually know that?" a moment rather than a scroll past the answer. Both
        faces are in the DOM from the start so the answer exists for a screen
        reader before the flip; `backface-visibility` is what hides it visually.
      */}
      <FlipCard
        className={cn('transition-opacity duration-150', leaving ? 'opacity-0' : 'animate-fade-in')}
        flipped={flipped}
        onFlip={() => setFlipped(true)}
        label={flipped ? t.flashcards.answer : t.flashcards.tapToReveal}
        front={
          <>
            <SheetHeader
              title={card.chapterName}
              description={
                card.source === 'generated'
                  ? t.flashcards.fromTextbookHint
                  : card.aheadOfSchedule
                    ? t.flashcards.aheadOfScheduleHint
                    : card.subjectName
              }
              actions={
                <div className="flex items-center gap-1.5">
                  {/* A student is owed the knowledge that this one was written
                      from their textbook rather than set by an examiner — the
                      two are worth different amounts when revising, and the
                      product says so everywhere else it matters. */}
                  {card.source === 'generated' && (
                    <Badge tone="accent">{t.flashcards.fromTextbook}</Badge>
                  )}
                  {card.aheadOfSchedule && (
                    <Badge tone="partial">{t.flashcards.aheadOfSchedule}</Badge>
                  )}
                  <Badge tone="neutral">
                    {card.repetitions === 0 ? '1' : `${card.repetitions + 1}`}
                  </Badge>
                </div>
              }
            />
            <SheetBody className="flex flex-1 items-center justify-center text-center">
              <MathText>{card.contentLatex || card.contentText}</MathText>
            </SheetBody>
            {!flipped && (
              <p className="pb-3 text-center text-caption text-ink-faint">
                {t.flashcards.tapToReveal}
              </p>
            )}
          </>
        }
        back={
          <>
            <SheetHeader title={t.flashcards.answer} description={card.chapterName} />
            <SheetBody className="flex flex-1 items-center justify-center text-center">
              {card.officialSolutionLatex || card.officialSolution ? (
                <MathText>{card.officialSolutionLatex ?? card.officialSolution ?? ''}</MathText>
              ) : (
                <p className="text-sm text-ink-muted">{t.flashcards.noSolution}</p>
              )}
            </SheetBody>
          </>
        }
      />

      <Sheet>
        <SheetFooter className={flipped ? 'flex-col items-stretch gap-3' : ''}>
          {flipped ? (
            <>
              <p className="text-meta font-medium text-ink">{t.flashcards.howWasIt}</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {GRADES.map(({ grade: value, tone, Icon }, position) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => gradeCard(value)}
                    className={cn(
                      'flex flex-col items-center gap-0.5 rounded-lg border-2 bg-paper-raised px-3 py-2.5 font-semibold',
                      'transition-[transform,background-color,border-color] duration-200 ease-soft',
                      '',
                      'motion-reduce:transform-none motion-reduce:hover:transform-none',
                      tone,
                    )}
                  >
                    <Icon width={17} height={17} className="mb-0.5" />
                    <span className="text-sm font-medium">
                      {t.flashcards[value]}
                      <kbd className="ms-1.5 hidden font-mono text-micro font-normal text-ink-faint sm:inline">
                        {position + 1}
                      </kbd>
                    </span>
                    <span className="text-caption text-ink-faint">
                      {t.flashcards[`${value}Hint` as const]}
                    </span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <Button variant="primary" fullWidth onClick={() => setFlipped(true)}>
              {t.flashcards.showAnswer}
              <kbd className="ms-1.5 hidden font-mono text-micro font-normal opacity-70 sm:inline">
                space
              </kbd>
            </Button>
          )}
        </SheetFooter>
      </Sheet>

      <div className="text-center">
        <button
          type="button"
          onClick={() => router.push('/flashcards')}
          className="text-meta text-ink-faint underline-offset-2 hover:text-ink hover:underline"
        >
          {t.common.close}
        </button>
      </div>
    </div>
  );
}
