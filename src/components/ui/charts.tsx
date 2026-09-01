'use client';

import { useEffect, useId, useRef, useState } from 'react';

import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n/client';

import { CountUp, useReducedMotion } from './motion';

/**
 * Charts, in plain SVG.
 *
 * No charting library: every figure here is one series of a dozen-odd values,
 * and a dependency that ships a layout engine to draw twelve rectangles is a
 * dependency that also ships its own colours, fonts and tooltips to fight with.
 *
 * Rules these follow, which are not negotiable on a product students use to
 * decide what to revise:
 *
 *   * **The number is always on screen.** Bars carry a direct label; the ring
 *     carries its percentage in the middle. Nobody has to hover to read a value,
 *     and nobody has to see colour to read it either.
 *   * **Colour is a status band, never the only signal.** The three mastery
 *     bands are legended in words. Green and amber are the same colour under
 *     protanopia — the label is what makes the band readable.
 *   * **Hover adds detail, never reveals it.** Tooltips carry context, not the
 *     value, because touch users get no hover at all.
 *   * **Axes recede.** Hairline grid, muted ticks, the data is the loud part.
 */

/** Below 0.4 needs work, below 0.7 is developing, above is solid. */
export type MasteryBand = 'low' | 'mid' | 'high';

export function bandFor(value: number): MasteryBand {
  if (value < 0.4) return 'low';
  if (value < 0.7) return 'mid';
  return 'high';
}

const BAND_FILL: Record<MasteryBand, string> = {
  low: 'fill-mark',
  mid: 'fill-partial',
  high: 'fill-correct',
};

const BAND_TEXT: Record<MasteryBand, string> = {
  low: 'text-mark',
  mid: 'text-partial',
  high: 'text-correct',
};

const BAND_DOT: Record<MasteryBand, string> = {
  low: 'bg-mark',
  mid: 'bg-partial',
  high: 'bg-correct',
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** The words that go with the colours. Passed in so they stay translatable. */
export type BandLabels = Record<MasteryBand, string>;

/**
 * A legend for the three bands.
 *
 * Present whenever band colour is used, because colour alone does not survive
 * colour-blindness, greyscale printing or a bad phone screen in daylight.
 */
export function BandLegend({ labels, className }: { labels: BandLabels; className?: string }) {
  return (
    <ul className={cn('flex flex-wrap items-center gap-x-4 gap-y-1', className)}>
      {(['high', 'mid', 'low'] as const).map((band) => (
        <li key={band} className="flex items-center gap-1.5 text-caption text-ink-muted">
          <span className={cn('h-2 w-2 rounded-full', BAND_DOT[band])} aria-hidden="true" />
          {labels[band]}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Ring gauge
// ---------------------------------------------------------------------------

/**
 * One value, 0..1, as a ring with the figure in the middle.
 *
 * The arc is drawn by animating `stroke-dashoffset`, which the compositor can
 * handle on its own; animating a path's geometry per frame would not survive a
 * mid-range phone.
 */
export function RingGauge({
  value,
  label,
  caption,
  size = 168,
  tone = 'band',
  className,
}: {
  value: number;
  label: string;
  caption?: string;
  size?: number;
  /** `band` colours by mastery band; `brand` always uses the primary hue. */
  tone?: 'band' | 'brand';
  className?: string;
}) {
  const { formatPercent } = useI18n();
  const reduced = useReducedMotion();
  const target = clamp01(value);

  const stroke = Math.max(10, Math.round(size * 0.085));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;

  const [drawn, setDrawn] = useState(reduced ? target : 0);

  useEffect(() => {
    if (reduced) {
      setDrawn(target);
      return undefined;
    }
    // One frame's delay so the transition has a "from" state to animate out of.
    const frame = requestAnimationFrame(() => setDrawn(target));
    return () => cancelAnimationFrame(frame);
  }, [target, reduced]);

  const band = bandFor(target);
  const strokeClass =
    tone === 'brand'
      ? 'stroke-primary'
      : band === 'low'
        ? 'stroke-mark'
        : band === 'mid'
          ? 'stroke-partial'
          : 'stroke-correct';

  return (
    <figure className={cn('flex flex-col items-center gap-2', className)}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          role="img"
          aria-label={`${label}: ${formatPercent(target)}`}
          className="-rotate-90"
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            className="stroke-paper-sunken"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - drawn)}
            className={cn(strokeClass, 'transition-[stroke-dashoffset] duration-[1100ms] ease-soft')}
          />
        </svg>

        {/* The figure sits in the hole rather than under the ring: the ring is
            the decoration, the number is the message. */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            className={cn(
              'font-semibold tabular-nums leading-none tracking-tight',
              tone === 'brand' ? 'text-ink' : BAND_TEXT[band],
            )}
            style={{ fontSize: size * 0.24 }}
          >
            <CountUp value={target} format={(v) => formatPercent(v)} />
          </span>
        </div>
      </div>

      <figcaption className="space-y-0.5 text-center">
        <p className="text-meta font-semibold text-ink">{label}</p>
        {caption && <p className="text-caption leading-snug text-ink-muted">{caption}</p>}
      </figcaption>
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Horizontal bars
// ---------------------------------------------------------------------------

export type BarDatum = {
  id: string;
  label: string;
  /** 0..1 */
  value: number;
  /** Extra context for the tooltip — never the value itself. */
  detail?: string;
  href?: string;
};

/**
 * Ranked horizontal bars — chapter and subject mastery.
 *
 * Horizontal because the labels are chapter names, and vertical bars would
 * either truncate them or turn them 45°. Each bar carries its own percentage at
 * the end, so the axis can stay a single hairline at 100%.
 */
export function BarRows({
  data,
  bandLabels,
  emptyLabel,
  className,
}: {
  data: BarDatum[];
  bandLabels: BandLabels;
  emptyLabel: string;
  className?: string;
}) {
  const { formatPercent } = useI18n();
  const reduced = useReducedMotion();
  const [grown, setGrown] = useState(reduced);

  useEffect(() => {
    if (reduced) {
      setGrown(true);
      return undefined;
    }
    const frame = requestAnimationFrame(() => setGrown(true));
    return () => cancelAnimationFrame(frame);
  }, [reduced]);

  if (data.length === 0) {
    return <p className={cn('text-sm text-ink-muted', className)}>{emptyLabel}</p>;
  }

  return (
    <div className={cn('space-y-3', className)}>
      <BandLegend labels={bandLabels} />

      <ul className="space-y-2.5">
        {data.map((datum, index) => {
          const value = clamp01(datum.value);
          const band = bandFor(value);
          const row = (
            <>
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-meta font-medium text-ink">
                  {datum.label}
                </span>
                <span
                  className={cn('shrink-0 text-meta font-bold tabular-nums', BAND_TEXT[band])}
                >
                  {formatPercent(value)}
                </span>
              </div>

              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-sm bg-paper-sunken">
                <div
                  className={cn(
                    'h-full transition-[width] duration-500 ease-soft',
                    band === 'low' ? 'bg-mark' : band === 'mid' ? 'bg-partial' : 'bg-correct',
                  )}
                  style={{
                    width: `${(grown ? value : 0) * 100}%`,
                    transitionDelay: `${Math.min(index * 60, 420)}ms`,
                  }}
                />
              </div>

              {datum.detail && (
                <p className="mt-1 text-caption text-ink-faint">{datum.detail}</p>
              )}
            </>
          );

          return (
            <li key={datum.id}>
              {datum.href ? (
                <a
                  href={datum.href}
                  className="block rounded px-2 py-1.5 -mx-2 transition-colors duration-150 hover:bg-primary-soft/60"
                >
                  {row}
                </a>
              ) : (
                <div className="px-2 py-1.5 -mx-2">{row}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Activity columns
// ---------------------------------------------------------------------------

export type ColumnDatum = { id: string; label: string; value: number; caption?: string };

/**
 * A short run of counts — attempts per day over the last fortnight.
 *
 * One series, one colour: the height already encodes the magnitude, and
 * colouring by height as well would say the same thing twice while implying the
 * bars belong to different categories.
 */
export function ActivityColumns({
  data,
  emptyLabel,
  className,
}: {
  data: ColumnDatum[];
  emptyLabel: string;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const [grown, setGrown] = useState(reduced);
  const [hovered, setHovered] = useState<string | null>(null);

  useEffect(() => {
    if (reduced) {
      setGrown(true);
      return undefined;
    }
    const frame = requestAnimationFrame(() => setGrown(true));
    return () => cancelAnimationFrame(frame);
  }, [reduced]);

  const peak = Math.max(1, ...data.map((d) => d.value));

  if (data.length === 0) {
    return <p className={cn('text-sm text-ink-muted', className)}>{emptyLabel}</p>;
  }

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex h-28 items-end gap-1.5">
        {data.map((datum, index) => {
          const ratio = datum.value / peak;
          const active = hovered === datum.id;

          return (
            <div
              key={datum.id}
              className="group relative flex h-full flex-1 flex-col justify-end"
              onMouseEnter={() => setHovered(datum.id)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(datum.id)}
              onBlur={() => setHovered(null)}
              tabIndex={0}
              // The bar is decorative; the accessible value lives in the label.
              aria-label={`${datum.label}: ${datum.value}`}
            >
              {active && (
                <div className="pointer-events-none absolute -top-1 left-1/2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded bg-ink px-2 py-1 text-micro font-medium text-on-primary animate-fade-in">
                  {datum.caption ?? datum.label}
                  <span className="ms-1.5 tabular-nums opacity-80">{datum.value}</span>
                </div>
              )}

              <div
                className={cn(
                  'w-full rounded-t-sm transition-[height,background-color] duration-700 ease-soft',
                  // Zero is drawn as a hairline rather than nothing, so an empty
                  // day is visibly an empty day and not a missing one.
                  datum.value === 0 ? 'bg-rule' : active ? 'bg-accent' : 'bg-viz-3',
                )}
                style={{
                  height: grown ? `${Math.max(datum.value === 0 ? 2 : 6, ratio * 100)}%` : '0%',
                  transitionDelay: `${Math.min(index * 40, 400)}ms`,
                }}
              />
            </div>
          );
        })}
      </div>

      <div className="flex justify-between text-micro text-ink-faint">
        <span>{data[0]?.label}</span>
        <span>{data[data.length - 1]?.label}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sparkline
// ---------------------------------------------------------------------------

/**
 * A trend line that draws itself in.
 *
 * Deliberately unlabelled on the axes: it sits inside a tile that already names
 * the measure and shows the current figure. A sparkline with a full axis
 * apparatus is just a small chart with no room.
 */
export function Sparkline({
  points,
  className,
  tone = 'brand',
}: {
  /** Raw values, oldest first. */
  points: number[];
  className?: string;
  tone?: 'brand' | 'accent';
}) {
  const reduced = useReducedMotion();
  const pathRef = useRef<SVGPathElement | null>(null);
  const gradientId = useId();
  const [length, setLength] = useState(0);
  const [drawn, setDrawn] = useState(reduced);

  useEffect(() => {
    if (pathRef.current) setLength(pathRef.current.getTotalLength());
  }, [points]);

  useEffect(() => {
    if (reduced) {
      setDrawn(true);
      return undefined;
    }
    const frame = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(frame);
  }, [reduced, length]);

  if (points.length < 2) return null;

  const width = 100;
  const height = 32;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;

  const coords = points.map((value, index) => {
    const x = (index / (points.length - 1)) * width;
    // 2px of padding top and bottom so the stroke is never clipped.
    const y = height - 2 - ((value - min) / span) * (height - 4);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  const line = `M${coords.join('L')}`;
  const area = `${line}L${width},${height}L0,${height}Z`;
  const strokeClass = tone === 'accent' ? 'stroke-accent' : 'stroke-viz-3';

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={cn('h-8 w-full', className)}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop
            offset="0%"
            stopColor={tone === 'accent' ? 'hsl(var(--accent))' : 'hsl(var(--viz-3))'}
            stopOpacity="0.28"
          />
          <stop
            offset="100%"
            stopColor={tone === 'accent' ? 'hsl(var(--accent))' : 'hsl(var(--viz-3))'}
            stopOpacity="0"
          />
        </linearGradient>
      </defs>

      <path d={area} fill={`url(#${gradientId})`} className="transition-opacity duration-700" style={{ opacity: drawn ? 1 : 0 }} />
      <path
        ref={pathRef}
        d={line}
        fill="none"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={cn(strokeClass, 'transition-[stroke-dashoffset] duration-[1200ms] ease-soft')}
        style={
          length > 0
            ? { strokeDasharray: length, strokeDashoffset: drawn ? 0 : length }
            : undefined
        }
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
