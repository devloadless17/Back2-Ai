'use client';

import { useState } from 'react';

import { MasteryRing } from '@/components/dashboard/mastery-ring';
import { FlipCard } from '@/components/flashcards/flip-card';
import { ChoiceList, type ChoiceVerdict } from '@/components/practice/choice-list';
import { BandIcon, bandForMastery, bandStyle } from '@/components/ui/band';
import { MathText } from '@/components/ui/math';
import { Sheet, SheetBody, SheetHeader } from '@/components/ui/sheet';
import { useI18n } from '@/lib/i18n/client';

/**
 * The marketing page's three demonstrations.
 *
 * Every one of these is the product's own component — `FlipCard` from the
 * review session, `ChoiceList` from the quiz runner, `MasteryRing` and the band
 * system from the dashboard — rendered with local state and nothing else. That
 * is deliberate, and it is the only reason this page is allowed to claim that
 * what a visitor is touching is the real thing.
 *
 * The alternative, three simplified lookalikes written for the landing page, is
 * a promise the product then has to keep by hand forever: the first time the
 * review card changes shape, the marketing page starts advertising a card that
 * no longer exists, and nobody finds out, because nothing is broken.
 *
 * What is capped is the machinery around them, not the components themselves.
 * No auth, no fetch, no attempt row, no SM-2 grade, nothing written anywhere. A
 * visitor turns one card and answers one question, and the page forgets both on
 * reload.
 */
export function LivePreviews() {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <FlipPreview />
      <QuizPreview />
      <MasteryPreview />
    </div>
  );
}

function FlipPreview() {
  const { t } = useI18n();
  const [flipped, setFlipped] = useState(false);

  return (
    <Sheet>
      <SheetHeader title={t.marketing.flipTitle} description={t.marketing.flipHint} />
      <SheetBody>
        <FlipCard
          flipped={flipped}
          onFlip={() => setFlipped(true)}
          label={flipped ? t.marketing.flipBack : t.marketing.flipHint}
          minHeight="8rem"
          front={
            <div className="flex flex-1 flex-col items-center justify-center gap-1 p-4 text-center">
              <span className="label">{t.marketing.flipFront}</span>
              <MathText compact>{t.marketing.flipQuestion}</MathText>
            </div>
          }
          back={
            <div className="flex flex-1 flex-col items-center justify-center gap-1 p-4 text-center">
              <span className="label">{t.marketing.flipBack}</span>
              <MathText compact>{t.marketing.flipAnswer}</MathText>
            </div>
          }
        />

        {/* The real card never turns back — in a review sitting the next step is
            to grade it, not to hide the answer again. There is no next step
            here, so the preview offers its own way to replay rather than
            teaching `FlipCard` a gesture the product does not have. */}
        {flipped && (
          <button
            type="button"
            onClick={() => setFlipped(false)}
            className="mt-2 text-caption font-semibold text-primary underline-offset-2 hover:underline"
          >
            {t.marketing.flipHint}
          </button>
        )}
      </SheetBody>
    </Sheet>
  );
}

const QUIZ_OPTIONS = [
  { id: 'a', text: '−sin(x)' },
  { id: 'b', text: 'cos(x)' },
  { id: 'c', text: 'tan(x)' },
];
const QUIZ_CORRECT_ID = 'b';

function QuizPreview() {
  const { t } = useI18n();
  const [picked, setPicked] = useState<string | null>(null);

  // Only the chosen row is marked. Lighting all three up would hand the answer
  // to anyone who clicks once, and the real runner never does that either.
  const verdicts: Record<string, ChoiceVerdict | undefined> = picked
    ? {
        [picked]:
          picked === QUIZ_CORRECT_ID
            ? { tone: 'correct', label: t.marketing.quizCorrect }
            : { tone: 'mark', label: t.marketing.quizIncorrect },
      }
    : {};

  return (
    <Sheet>
      <SheetHeader title={t.marketing.quizTitle} description={t.marketing.quizHint} />
      <SheetBody className="space-y-3">
        <MathText compact>{t.marketing.quizQuestion}</MathText>
        <ChoiceList
          name="preview-quiz"
          legend={t.marketing.quizHint}
          options={QUIZ_OPTIONS}
          value={picked ?? undefined}
          onChange={setPicked}
          verdicts={verdicts}
        />
      </SheetBody>
    </Sheet>
  );
}

function MasteryPreview() {
  const { t } = useI18n();

  // A mid-band figure on purpose. A ring at 95% is a screenshot; a ring at 62%
  // is what this product actually says to most people most of the time.
  const mastery = 0.62;
  const band = bandForMastery(mastery, 12);
  const style = bandStyle(band);

  return (
    <Sheet>
      <SheetHeader title={t.marketing.masteryTitle} description={t.marketing.masteryHint} />
      <SheetBody>
        <div className="flex items-center gap-4">
          <MasteryRing
            value={mastery}
            size={72}
            radius={30}
            stroke={7}
            className={style.ink.replace('text-', 'stroke-')}
          >
            <span className="numeric font-display text-meta font-extrabold">
              {Math.round(mastery * 100)}%
            </span>
          </MasteryRing>

          <div className="min-w-0">
            <p className="text-sm font-bold text-ink">{t.marketing.masterySubject}</p>
            {/* Band, never by colour alone: icon and word travel with the tint,
                the same triple the dashboard uses. */}
            <p className={`mt-1 inline-flex items-center gap-1 text-micro font-semibold ${style.ink}`}>
              <BandIcon band={band} width={11} height={11} />
              {t.dashboard.bandDeveloping}
            </p>
          </div>
        </div>
      </SheetBody>
    </Sheet>
  );
}
