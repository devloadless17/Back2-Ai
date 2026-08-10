'use client';

import { useEffect, useState } from 'react';

import { cn } from '@/lib/cn';

import { useReducedMotion } from './motion';

/**
 * Balloons.
 *
 * Two jobs, one component. The ambient layer drifts a handful of soft bubbles
 * up the page forever, so a screen that is mostly numbers still has some life
 * in it. The burst layer fires a dense volley on a level-up or a new badge and
 * then clears itself.
 *
 * Why this is safe to leave running:
 *
 *   * **It is behind everything and takes no input.** `pointer-events-none`,
 *     `aria-hidden`, negative z-index. Nothing here can intercept a tap.
 *   * **It is CSS, not a canvas.** A dozen transformed divs are composited on
 *     the GPU and cost effectively nothing; a requestAnimationFrame particle
 *     system on a mid-range Android would cost a frame budget the exam timer
 *     needs.
 *   * **It stops completely under `prefers-reduced-motion`.** Not slowed —
 *     absent. Drifting objects are exactly what that setting exists to remove.
 *   * **Randomness is generated after mount**, so the server and the client
 *     never disagree about where a bubble was.
 */

type Bubble = {
  id: number;
  /** Percent from the inline start edge. */
  left: number;
  size: number;
  delay: number;
  duration: number;
  hue: 'primary' | 'accent' | 'sky';
  drift: number;
};

const HUE_CLASS: Record<Bubble['hue'], string> = {
  primary: 'bg-primary/25',
  accent: 'bg-accent/25',
  sky: 'bg-[hsl(190_90%_60%/0.25)]',
};

const HUES: Bubble['hue'][] = ['primary', 'accent', 'sky'];

function makeBubbles(count: number, options: { fast?: boolean } = {}): Bubble[] {
  return Array.from({ length: count }, (_, id) => ({
    id,
    left: Math.random() * 100,
    size: options.fast ? 10 + Math.random() * 22 : 18 + Math.random() * 46,
    delay: options.fast ? Math.random() * 0.5 : Math.random() * 14,
    duration: options.fast ? 1.8 + Math.random() * 1.4 : 16 + Math.random() * 14,
    hue: HUES[Math.floor(Math.random() * HUES.length)] ?? 'primary',
    drift: Math.random() * 80 - 40,
  }));
}

/**
 * The permanent, very quiet layer. Mounted once in the app shell.
 *
 * Twelve bubbles over a whole viewport is roughly one every other screenful —
 * enough to notice if you look, not enough to read as weather.
 */
export function AmbientBalloons({ count = 12 }: { count?: number }) {
  const reduced = useReducedMotion();
  const [bubbles, setBubbles] = useState<Bubble[]>([]);

  useEffect(() => {
    if (reduced) {
      setBubbles([]);
      return;
    }
    setBubbles(makeBubbles(count));
  }, [count, reduced]);

  if (reduced || bubbles.length === 0) return null;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    >
      {bubbles.map((bubble) => (
        <span
          key={bubble.id}
          className={cn('absolute bottom-0 rounded-full blur-[1px]', HUE_CLASS[bubble.hue])}
          style={{
            insetInlineStart: `${bubble.left}%`,
            width: bubble.size,
            height: bubble.size,
            animation: `balloon-rise ${bubble.duration}s linear ${bubble.delay}s infinite`,
            ['--balloon-drift' as string]: `${bubble.drift}px`,
          }}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Celebration burst
// ---------------------------------------------------------------------------

/**
 * A module-level event, so any component can fire a celebration without the
 * whole tree having to thread a callback down to it.
 *
 * A custom DOM event rather than a store: there is exactly one listener, it
 * lives in the shell, and this keeps the calling side a one-liner with no
 * provider to forget.
 */
const CELEBRATE_EVENT = 'bac2:celebrate';

export type CelebrationKind = 'level' | 'badge' | 'goal';

export function celebrate(kind: CelebrationKind = 'badge'): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(CELEBRATE_EVENT, { detail: kind }));
}

const BURST_COUNT: Record<CelebrationKind, number> = { level: 26, badge: 18, goal: 14 };
const BURST_MS = 3400;

/** Listens for celebrations and paints one volley of balloons. Mounted in the shell. */
export function CelebrationLayer() {
  const reduced = useReducedMotion();
  const [burst, setBurst] = useState<Bubble[] | null>(null);

  useEffect(() => {
    if (reduced) return undefined;

    let timer: ReturnType<typeof setTimeout> | undefined;

    function onCelebrate(event: Event) {
      const kind = ((event as CustomEvent).detail as CelebrationKind) ?? 'badge';
      setBurst(makeBubbles(BURST_COUNT[kind] ?? 18, { fast: true }));

      // Replace rather than accumulate: two level-ups in a row should not leave
      // fifty balloons on screen.
      clearTimeout(timer);
      timer = setTimeout(() => setBurst(null), BURST_MS);
    }

    window.addEventListener(CELEBRATE_EVENT, onCelebrate);
    return () => {
      window.removeEventListener(CELEBRATE_EVENT, onCelebrate);
      clearTimeout(timer);
    };
  }, [reduced]);

  if (reduced || !burst) return null;

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-[55] overflow-hidden">
      {burst.map((bubble) => (
        <span
          key={bubble.id}
          className={cn(
            'absolute bottom-0 rounded-full',
            HUE_CLASS[bubble.hue],
            'shadow-[0_0_12px_currentColor]',
          )}
          style={{
            insetInlineStart: `${bubble.left}%`,
            width: bubble.size,
            height: bubble.size,
            animation: `balloon-burst ${bubble.duration}s cubic-bezier(0.16, 1, 0.3, 1) ${bubble.delay}s both`,
            ['--balloon-drift' as string]: `${bubble.drift}px`,
          }}
        />
      ))}
    </div>
  );
}
