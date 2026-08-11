'use client';

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ElementType,
  type ReactNode,
} from 'react';

import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n/client';

/**
 * Motion primitives.
 *
 * Three rules hold everywhere in here, and they are what keep a heavily
 * animated product usable rather than exhausting:
 *
 *   1. **Motion never carries information alone.** Every animated value is also
 *      present as text. If the animation never runs, nothing is lost.
 *   2. **Nothing is invisible until it animates.** Reveals start at opacity 0
 *      only once the observer has confirmed the browser will animate them; with
 *      reduced motion or without IntersectionObserver, content renders plainly.
 *      A student must never end up on a blank page because an effect did not
 *      fire.
 *   3. **The OS setting wins.** `useReducedMotion` short-circuits every
 *      JS-driven animation here, and the global CSS rule collapses the rest.
 */

/** Tracks `prefers-reduced-motion`, including changes made while the app is open. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);

    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

/**
 * Fires once when the element first enters the viewport.
 *
 * `visible` starts true when there is no observer to tell us otherwise, so the
 * failure mode is "content shown without animation" rather than "content never
 * shown".
 */
function useInView<T extends HTMLElement>(enabled: boolean) {
  const ref = useRef<T | null>(null);
  const [visible, setVisible] = useState(!enabled);

  useEffect(() => {
    if (!enabled) {
      setVisible(true);
      return undefined;
    }

    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            observer.disconnect();
          }
        }
      },
      // A small negative bottom margin so a card animates as it arrives rather
      // than after it is already fully read.
      { rootMargin: '0px 0px -8% 0px', threshold: 0.05 },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [enabled]);

  return { ref, visible };
}

export type RevealProps = {
  children: ReactNode;
  /** Milliseconds. Use `index` instead when revealing a list. */
  delay?: number;
  /** Position in a group — multiplied out into a stagger. */
  index?: number;
  variant?: 'rise' | 'pop' | 'slide' | 'fade';
  as?: ElementType;
  className?: string;
  style?: CSSProperties;
};

const VARIANT_CLASS = {
  rise: 'animate-rise',
  pop: 'animate-fade-in',
  slide: 'animate-slide-in',
  fade: 'animate-fade-in',
} as const;

/** Per-item stagger. Capped so a long list does not take a second to appear. */
const STAGGER_STEP_MS = 55;
const MAX_STAGGER_MS = 400;

export function Reveal({
  children,
  delay,
  index = 0,
  variant = 'rise',
  as: Tag = 'div',
  className,
  style,
}: RevealProps) {
  const reduced = useReducedMotion();
  const { ref, visible } = useInView<HTMLDivElement>(!reduced);

  const computedDelay = delay ?? Math.min(index * STAGGER_STEP_MS, MAX_STAGGER_MS);

  return (
    <Tag
      ref={ref}
      className={cn(visible && !reduced && VARIANT_CLASS[variant], className)}
      style={{
        ...style,
        ...(visible || reduced ? {} : { opacity: 0 }),
        animationDelay: visible && !reduced ? `${computedDelay}ms` : undefined,
      }}
    >
      {children}
    </Tag>
  );
}

/**
 * A number that counts up to its value.
 *
 * The final value is rendered immediately for reduced-motion users and is what
 * screen readers announce either way — `aria-live` is deliberately absent, since
 * a counter that announces every intermediate frame is unusable.
 */
export function CountUp({
  value,
  format,
  as = 'number',
  durationMs = 900,
  className,
}: {
  value: number;
  /**
   * Turns the in-flight number into display text.
   *
   * **Client components only.** A function cannot cross the server/client
   * boundary — React has to serialise these props — so a server component that
   * passes one gets "Functions cannot be passed directly to Client Components"
   * at render. Server callers use `as` instead, which is a string and
   * serialises fine.
   */
  format?: (value: number) => string;
  /** Serialisable alternative to `format`, safe to pass from a server component. */
  as?: 'number' | 'percent';
  durationMs?: number;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const { formatPercent } = useI18n();
  const [shown, setShown] = useState(value);
  const previous = useRef(value);

  useEffect(() => {
    if (reduced) {
      setShown(value);
      previous.current = value;
      return undefined;
    }

    const from = previous.current;
    const to = value;
    previous.current = value;

    if (from === to) {
      setShown(to);
      return undefined;
    }

    const start = performance.now();
    let frame = 0;

    const step = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      // Ease-out cubic: decelerates into the final number instead of snapping.
      setShown(from + (to - from) * (1 - Math.pow(1 - t, 3)));
      if (t < 1) frame = requestAnimationFrame(step);
    };

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, durationMs, reduced]);

  // An explicit `format` wins when there is one; otherwise `as` picks a
  // localised formatter, so a percentage reads correctly in Arabic too.
  const render =
    format ?? (as === 'percent' ? formatPercent : (n: number) => String(Math.round(n)));

  return <span className={className}>{render(shown)}</span>;
}

/**
 * Mounts children on the client only, after a frame.
 *
 * For decorative motion that would otherwise cause a hydration mismatch (the
 * server has no idea what `prefers-reduced-motion` is).
 */
export function ClientOnly({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? <>{children}</> : null;
}
