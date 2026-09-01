'use client';

import { useEffect, useState } from 'react';

import { useReducedMotion } from '@/components/ui/motion';

/**
 * The ring, drawn filling.
 *
 * The one animation in this product that carries meaning rather than polish: a
 * ring sweeping to 55% *shows* partial mastery in a way a static arc does not.
 * It is the difference between reading a number and watching a measurement.
 *
 * It still obeys the rule the rest of the motion layer obeys — the mark is
 * printed in the middle as plain text, so if this never animates, nothing is
 * lost. That matters more than usual here, because the first paint is
 * server-rendered and the fill only starts once the client takes over.
 *
 * Starts empty and sweeps to the real value on mount. With reduced motion it is
 * simply drawn at its final value, with no transition at all — a student who has
 * asked the OS for stillness should not get a one-second sweep on every
 * dashboard visit.
 */
export function MasteryRing({
  value,
  size,
  radius,
  stroke,
  className,
  children,
}: {
  /** 0–1. */
  value: number;
  size: number;
  radius: number;
  stroke: number;
  /** Tailwind stroke class for the filled arc. */
  className: string;
  children: React.ReactNode;
}) {
  const reduced = useReducedMotion();
  const circumference = 2 * Math.PI * radius;

  // Empty until mounted, then the real value — which is what produces the sweep.
  const [drawn, setDrawn] = useState(0);

  useEffect(() => {
    if (reduced) {
      setDrawn(value);
      return undefined;
    }
    // One frame of empty first, or the browser has nothing to transition from.
    const frame = requestAnimationFrame(() => setDrawn(value));
    return () => cancelAnimationFrame(frame);
  }, [value, reduced]);

  const offset = circumference - drawn * circumference;

  return (
    <span className="relative block" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
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
          strokeDashoffset={offset}
          className={className}
          style={
            reduced
              ? undefined
              : {
                  // Long for a micro-interaction, deliberately: this is a value
                  // being measured, not a control acknowledging a tap. The ease
                  // settles rather than overshooting — a mastery figure that
                  // bounced past its own number would be lying for a moment.
                  transition: 'stroke-dashoffset 900ms cubic-bezier(0.22, 1, 0.36, 1)',
                }
          }
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center">{children}</span>
    </span>
  );
}
