import { MathText } from '@/components/ui/math';
import { cn } from '@/lib/cn';

/**
 * How the Lebanese Bac gave and took the marks.
 *
 * THE PRODUCT'S SECOND CLAIM, after Nour's. Any tutor can say "incorrect".
 * This one can say which line of the ministry's own marking scheme the mark
 * was attached to, whether it was earned, and — separately — what to do
 * differently. The data for that has been stored since marking was built; the
 * results screen was showing the wrong half of it.
 *
 * TWO VOICES, NEVER BLENDED. The stored result carries both:
 *
 *   `criterion`      the examiner's wording. Ministry authority.
 *   `justification`  faces a TEACHER reviewing a contested mark — why the
 *                    points fell as they did.
 *   `explanation`    faces the STUDENT — what went wrong and how the correct
 *                    reasoning goes.
 *
 * The screen was printing `justification`, so a student read an argument
 * written for somebody arbitrating against them. `explanation` is what was
 * written for them, and it is set apart as Nour's note rather than run
 * together with the criterion — because a generated sentence sitting flush
 * under an official one reads as equally official, and that is the one blur
 * this product cannot afford.
 *
 * `provisional` IS PER CRITERION, not per attempt, and is rendered that way.
 * 868 questions reached the corpus with no scheme at all, and a paper can mix
 * an exercise whose scheme survived extraction with one whose did not — a
 * single banner over the whole result would have to lie about one of them.
 *
 * SEMANTIC COLOURS EARN THEIR KEEP HERE. Teal for marks earned, amber for
 * partial, rose for marks lost. This is the screen those colours were reserved
 * for, and it is the one place rose should be prominent — it means exactly what
 * it means everywhere else in the product.
 */

export type MarkedCriterion = {
  criterion: string;
  points_awarded: number;
  points_possible: number;
  justification: string;
  explanation?: string;
  provisional?: boolean;
};

/** Trailing zeros off a half-mark: "1.5" and "2", never "1.50" and "2.00". */
function formatScore(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function outcomeOf(item: MarkedCriterion): 'earned' | 'partial' | 'lost' {
  if (item.points_awarded >= item.points_possible) return 'earned';
  return item.points_awarded > 0 ? 'partial' : 'lost';
}

export function ExaminerMark({
  total,
  max,
  criteria,
  labels,
  /**
   * How often this student has lost marks on each criterion before, keyed by
   * the criterion text. Absent when it has not been looked up — an empty map
   * and an unknown map must not look the same, so the caller passes undefined
   * rather than {} when it did not ask.
   */
  repeats,
}: {
  total: number;
  max: number;
  criteria: MarkedCriterion[];
  repeats?: Map<string, { times: number; pointsLost: number }>;
  labels: {
    title: string;
    nourNote: string;
    provisional: string;
    /** "You have lost marks on this {times} times — {points} in total." */
    repeated: string;
  };
}) {
  return (
    <section>
      <header className="flex items-baseline justify-between gap-4 border-b border-rule px-5 py-3">
        <h3 className="text-micro font-semibold uppercase tracking-[0.12em] text-ink-faint">
          {labels.title}
        </h3>
        {/*
          The mark, tabular so it does not shift between questions, and sized
          well above the criteria. It is the first thing the student came back
          for; everything under it explains it.
        */}
        <p className="shrink-0 text-xl font-semibold tabular-nums text-ink">
          {formatScore(total)}
          <span className="text-base text-ink-faint"> / {formatScore(max)}</span>
        </p>
      </header>

      <ul className="ruled">
        {criteria.map((item, i) => {
          const outcome = outcomeOf(item);
          const repeat = repeats?.get(item.criterion.trim());

          return (
            <li key={`${item.criterion}-${i}`} className="px-5 py-3.5">
              <div className="flex items-baseline gap-3">
                {/*
                  A glyph, not an icon. It sits on the text baseline with the
                  criterion, survives 360px, and carries the same meaning as the
                  colour beside it — so the row still reads without colour
                  vision.
                */}
                <span
                  aria-hidden
                  className={cn(
                    'shrink-0 text-sm font-semibold',
                    outcome === 'earned'
                      ? 'text-correct'
                      : outcome === 'partial'
                        ? 'text-partial'
                        : 'text-mark',
                  )}
                >
                  {outcome === 'earned' ? '✓' : outcome === 'partial' ? '◐' : '×'}
                </span>

                <div className="min-w-0 flex-1">
                  {/* The examiner's own wording. Never truncated — it is the
                      thing being marked, and Lebanese criteria run long. */}
                  <p className="break-words text-sm font-medium text-ink">{item.criterion}</p>

                  {item.provisional && (
                    <p className="mt-1 text-caption text-partial">{labels.provisional}</p>
                  )}
                </div>

                <p
                  className={cn(
                    'shrink-0 tabular-nums text-meta font-semibold',
                    outcome === 'earned'
                      ? 'text-correct'
                      : outcome === 'partial'
                        ? 'text-partial'
                        : 'text-mark',
                  )}
                >
                  {formatScore(item.points_awarded)} / {formatScore(item.points_possible)}
                </p>
              </div>

              {/*
                NOUR'S NOTE, indented and labelled, only where a mark was lost.
                A criterion that scored full marks has nothing to explain, and
                `explanation` is empty on those by design.
              */}
              {outcome !== 'earned' && item.explanation && (
                <div className="mt-2.5 ms-7 border-s-2 border-rule ps-3">
                  <p className="text-micro font-semibold uppercase tracking-wider text-ink-faint">
                    {labels.nourNote}
                  </p>
                  <div className="mt-1 text-meta leading-relaxed text-ink-muted">
                    {/* Through MathText: an explanation of a lost mark in
                        mathematics is mathematics. */}
                    <MathText compact>{item.explanation}</MathText>
                  </div>
                </div>
              )}

              {/*
                THE SAME MISTAKE, AGAIN. Only from persisted marking — no time
                window, no "recoverable marks", no causal story. It says what
                the record shows and stops.
              */}
              {repeat && repeat.times > 1 && (
                <p className="mt-2 ms-7 text-caption font-medium text-mark">
                  {labels.repeated
                    .replace('{times}', String(repeat.times))
                    .replace('{points}', formatScore(repeat.pointsLost))}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
