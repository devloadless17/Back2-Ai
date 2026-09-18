import { cn } from '@/lib/cn';

/**
 * Where the student stands, or an honest account of why it cannot say yet.
 *
 * THE EMPTY STATE IS THE DESIGNED STATE, not a fallback. Most students opening
 * this for the first time have answered nothing, and a readiness panel that
 * degrades to a grey box teaches them the product is broken at the exact moment
 * it is trying to earn their attention. The rule taken from the brief: the
 * absence of data is itself designed, and it shows real progress toward having
 * enough — `2 of 10 answers marked` is a true sentence and a usable target.
 *
 * NO MANUFACTURED PRECISION. `markOutOf20` is only shown when readiness reports
 * itself reportable, which needs ten marked answers. Below that the product
 * says so in words rather than printing a number nobody should act on. A figure
 * on a dashboard is quoted to a parent; a caveat beside it is not.
 *
 * THE FIGURE IS THE LARGEST THING ON THE PAGE. It is the question the student
 * came to have answered, and the brief is explicit that a readiness score must
 * not look like enlarged body copy. Tabular numerals so it does not shift as it
 * moves between 9.8 and 14.2.
 */
export function ReadinessPanel({
  mark,
  trend,
  evidenceCount,
  evidenceNeeded,
  labels,
}: {
  /** Out of 20, or null when there is not enough marked work to say. */
  mark: number | null;
  trend: 'up' | 'flat' | 'down' | null;
  /** Marked answers so far. Real count, never rounded up. */
  evidenceCount: number;
  /** How many are needed before a mark is reported. */
  evidenceNeeded: number;
  labels: {
    title: string;
    outOf: string;
    /** "Based on {count} marked answers" */
    basis: string;
    emptyTitle: string;
    emptyBody: string;
    /** "{count} of {needed} marked" */
    emptyProgress: string;
    trendUp: string;
    trendFlat: string;
    trendDown: string;
  };
}) {
  if (mark === null) {
    const pct = Math.min(100, Math.round((evidenceCount / Math.max(evidenceNeeded, 1)) * 100));

    return (
      <section className="rounded-2xl border border-rule bg-paper-raised p-5 sm:p-6">
        <p className="text-micro font-semibold uppercase tracking-[0.12em] text-ink-faint">
          {labels.title}
        </p>

        <p className="mt-2.5 text-base font-semibold leading-snug text-ink">
          {labels.emptyTitle}
        </p>
        <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-ink-muted">
          {labels.emptyBody}
        </p>

        {/*
          A real bar toward a real threshold. The point is that this state ends
          — the student can see how far off it is and that answering questions
          is what moves it, which is the behaviour the whole product wants.
        */}
        <div className="mt-4">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-paper-sunken">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="mt-2 text-caption tabular-nums text-ink-faint">
            {labels.emptyProgress
              .replace('{count}', String(evidenceCount))
              .replace('{needed}', String(evidenceNeeded))}
          </p>
        </div>
      </section>
    );
  }

  const trendLabel =
    trend === 'up' ? labels.trendUp : trend === 'down' ? labels.trendDown : labels.trendFlat;

  return (
    <section className="rounded-2xl border border-rule bg-paper-raised p-5 sm:p-6">
      <p className="text-micro font-semibold uppercase tracking-[0.12em] text-ink-faint">
        {labels.title}
      </p>

      <div className="mt-2 flex items-baseline gap-2">
        {/*
          `tabular-nums` so the figure does not reflow as it changes, and the
          "/ 20" is deliberately quiet — the mark is the fact, the denominator
          is the unit, and printing both at the same weight makes neither read.
        */}
        <span className="figure text-display leading-none sm:text-hero text-ink">
          {mark.toFixed(1)}
        </span>
        <span className="text-base text-ink-faint">{labels.outOf}</span>
      </div>

      {trend && (
        <p
          className={cn(
            'mt-2 text-caption font-medium',
            trend === 'up' ? 'text-correct' : trend === 'down' ? 'text-mark' : 'text-ink-faint',
          )}
        >
          {/* The arrow is a glyph rather than an icon: it sits inline with the
              words at caption size, where an SVG would need its own alignment. */}
          {trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→'} {trendLabel}
        </p>
      )}

      <p className="mt-4 text-caption tabular-nums text-ink-faint">
        {labels.basis.replace('{count}', String(evidenceCount))}
      </p>
    </section>
  );
}
