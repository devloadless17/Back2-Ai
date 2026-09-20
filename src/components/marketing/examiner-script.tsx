import { NourMark, Seal } from '@/components/marketing/identity';
import { cn } from '@/lib/cn';

/**
 * A Bac answer being marked. The hero object of the Examiner section.
 *
 * The version this replaces was a table on a dark ground: three rows of
 * criteria and a large number above them. It described the feature accurately
 * and showed nothing, because there was no student answer anywhere in it — and
 * "we mark your answer" is not a claim a list of criteria can make.
 *
 * So this is a script. A cream sheet on the dark section, the final mark
 * written at its head, and the marking attached to the sentences it belongs
 * to rather than gathered into a summary underneath. The sentence the barème
 * wanted and the student did not write is shown as an outline, because that
 * is the single most persuasive thing this product does and it cannot be
 * stated in prose.
 *
 * Illustrative marketing content. Not live student data, and nothing here
 * claims Ministry approval.
 */

export type ScriptLabels = {
  subject: string;
  session: string;
  exercise: string;
  total: string;
  question: string;
  answerLabel: string;
  line1: string;
  crit1: string;
  mark1: string;
  line2: string;
  crit2: string;
  mark2: string;
  missingLabel: string;
  missing: string;
  crit3: string;
  mark3: string;
  nourNoteLabel: string;
  nourNote: string;
};

/**
 * One marked passage: the sentence, then the examiner's line under it.
 *
 * The coloured edge is what ties a mark to the words that earned or cost it.
 * It is 2px and low-opacity — enough to bind the two, far short of a callout,
 * and it stacks correctly on a phone because the annotation already sits under
 * the text rather than beside it.
 */
function MarkedPassage({
  children,
  criterion,
  mark,
  outcome,
}: {
  children: React.ReactNode;
  criterion: string;
  mark: string;
  outcome: 'earned' | 'partial' | 'lost';
}) {
  const edge = {
    earned: 'border-correct/45',
    partial: 'border-partial/45',
    lost: 'border-mark/45',
  }[outcome];

  const ink = {
    earned: 'text-correct',
    partial: 'text-partial',
    lost: 'text-mark',
  }[outcome];

  const glyph = { earned: '✓', partial: '◐', lost: '×' }[outcome];

  return (
    <div className={cn('border-s-2 ps-4 sm:ps-5', edge)}>
      {children}
      <p className="mt-2 flex items-baseline gap-2.5 text-micro">
        <span aria-hidden className={cn('text-meta leading-none', ink)}>
          {glyph}
        </span>
        <span className="min-w-0 uppercase tracking-[0.08em] text-ink-faint">{criterion}</span>
        <span aria-hidden className="h-px min-w-3 flex-1 bg-rule-strong" />
        <span className={cn('figure shrink-0 text-meta', ink)}>{mark}</span>
      </p>
    </div>
  );
}

export function ExaminerScript({ labels, className }: { labels: ScriptLabels; className?: string }) {
  return (
    <div className={cn('relative', className)}>
      {/*
        A second sheet under the first. One edge, offset, at very low opacity —
        it gives the script somewhere to sit without becoming a stack of cards,
        and it is the only depth device here besides the shadow.
      */}
      <div
        aria-hidden
        className="absolute inset-x-4 -bottom-2.5 top-4 rounded-sm bg-paper/[0.08] sm:inset-x-6"
      />

      <article className="relative rounded-sm bg-paper text-ink shadow-[0_24px_50px_-18px_rgb(0_0_0_/_0.65)]">
        {/* ---- The head of the script ---- */}
        <header className="border-b border-rule-strong px-5 pb-4 pt-5 sm:px-7 sm:pt-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="font-display text-lead font-semibold leading-none tracking-tight text-ink">
                {labels.subject}
              </p>
              <p className="mt-1.5 text-micro uppercase tracking-[0.12em] text-ink-faint">
                {labels.session}
              </p>
            </div>
            <Seal className="size-7 [clip-path:polygon(0_0,calc(100%-5px)_0,100%_5px,100%_100%,0_100%)]" />
          </div>

          <div className="mt-4 flex items-baseline justify-between gap-4 border-t border-rule pt-3">
            <p className="text-micro font-semibold uppercase tracking-[0.12em] text-ink">
              {labels.exercise}
            </p>
            <p className="figure text-micro uppercase tracking-[0.1em] text-ink-faint">
              {labels.total}
            </p>
          </div>
        </header>

        {/* ---- The question, then the answer ---- */}
        <div className="px-5 py-5 sm:px-7 sm:py-6">
          <p className="text-meta font-medium text-ink">{labels.question}</p>

          <p className="mt-5 text-micro font-semibold uppercase tracking-[0.12em] text-ink-faint">
            {labels.answerLabel}
          </p>

          <div className="mt-3 space-y-5">
            <MarkedPassage criterion={labels.crit1} mark={labels.mark1} outcome="earned">
              {/*
                The words that earned the mark, underlined the way an examiner
                underlines them. `decoration-*` rather than a background, so the
                sentence stays a sentence.
              */}
              <p className="text-meta leading-relaxed text-ink underline decoration-correct/50 decoration-2 underline-offset-4">
                {labels.line1}
              </p>
            </MarkedPassage>

            <MarkedPassage criterion={labels.crit2} mark={labels.mark2} outcome="partial">
              <p className="text-meta leading-relaxed text-ink">{labels.line2}</p>
            </MarkedPassage>

            {/*
              THE SENTENCE THAT WAS NOT WRITTEN.

              The most persuasive thing on the page. A dashed outline where the
              missing justification should have been, with what the barème
              wanted inside it — a student reads this and understands
              immediately that the marking is against the scheme rather than
              against a general impression of the answer.
            */}
            <MarkedPassage criterion={labels.crit3} mark={labels.mark3} outcome="lost">
              <div className="rounded-sm border border-dashed border-mark/45 bg-mark-soft/40 px-3.5 py-3">
                <p className="text-micro font-semibold uppercase tracking-[0.1em] text-mark">
                  {labels.missingLabel}
                </p>
                <p className="mt-1.5 text-meta italic leading-relaxed text-ink-muted">
                  {labels.missing}
                </p>
              </div>
            </MarkedPassage>
          </div>
        </div>

        {/*
          Nour, attached to the loss rather than filed underneath it.

          Indented to sit under the lost-mark passage and joined to it by a
          short rule, so she reads as a second hand annotating the same place
          on the paper — which is exactly what she is.
        */}
        <div className="border-t border-rule bg-primary-soft/50 px-5 py-4 sm:px-7 sm:py-5">
          <div className="flex gap-3.5">
            <NourMark className="mt-0.5 size-8" />
            <div className="min-w-0">
              <p className="text-micro font-semibold uppercase tracking-[0.12em] text-primary">
                {labels.nourNoteLabel}
              </p>
              <p className="mt-1.5 max-w-prose text-meta leading-relaxed text-ink">
                {labels.nourNote}
              </p>
            </div>
          </div>
        </div>
      </article>

      {/*
        THE FINAL MARK, WRITTEN AT THE HEAD OF THE SCRIPT.

        Overlapping the top edge so it belongs to the paper and to the dark
        ground at once, the way a mark written in the corner of a booklet sits
        half on the margin. Its own small cream plane, because a figure this
        size straddling two backgrounds is otherwise unreadable on one of them.
        No glow, no ring, no gauge — an examiner writes a number.
      */}
      <div className="absolute -top-5 end-4 z-20 flex items-end gap-1.5 rounded-sm bg-paper px-4 py-2.5 shadow-[0_10px_24px_-10px_rgb(0_0_0_/_0.6)] sm:-top-6 sm:end-7 sm:px-5 sm:py-3">
        <span className="figure text-[2.75rem] leading-[0.82] text-ink sm:text-[3.4rem]">14</span>
        <span className="figure pb-1 text-lead text-ink-faint sm:text-title">/ 20</span>
      </div>
    </div>
  );
}
