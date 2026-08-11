import type { Config } from 'tailwindcss';

/**
 * Every colour resolves to a CSS custom property defined in globals.css, so the
 * palette is replaced by editing `:root` in one stylesheet and no component
 * changes. Components reference semantic names (`bg-paper`, `text-mark`) and
 * never raw Tailwind palette values.
 *
 * The motion vocabulary is deliberately tiny: two entrances that are barely
 * perceptible, and the transitions that let a bar fill and a figure count. That
 * is the whole budget. Anything more reads as decoration on a product whose job
 * is to tell a student the truth about a national exam.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: 'hsl(var(--paper) / <alpha-value>)',
        'paper-raised': 'hsl(var(--paper-raised) / <alpha-value>)',
        'paper-sunken': 'hsl(var(--paper-sunken) / <alpha-value>)',
        ink: 'hsl(var(--ink) / <alpha-value>)',
        'ink-muted': 'hsl(var(--ink-muted) / <alpha-value>)',
        'ink-faint': 'hsl(var(--ink-faint) / <alpha-value>)',
        rule: 'hsl(var(--rule) / <alpha-value>)',
        'rule-strong': 'hsl(var(--rule-strong) / <alpha-value>)',
        /** The single accent: cedar. Current state and the primary action only. */
        primary: 'hsl(var(--primary) / <alpha-value>)',
        'primary-hover': 'hsl(var(--primary-hover) / <alpha-value>)',
        'primary-soft': 'hsl(var(--primary-soft) / <alpha-value>)',
        'on-primary': 'hsl(var(--on-primary) / <alpha-value>)',
        /** Aliased to the accent — this palette has no second decorative colour. */
        accent: 'hsl(var(--accent) / <alpha-value>)',
        'accent-hover': 'hsl(var(--accent-hover) / <alpha-value>)',
        'accent-soft': 'hsl(var(--accent-soft) / <alpha-value>)',
        /** The examiner's pen. Lost marks and an urgent countdown. Nothing else. */
        mark: 'hsl(var(--mark) / <alpha-value>)',
        'mark-soft': 'hsl(var(--mark-soft) / <alpha-value>)',
        correct: 'hsl(var(--correct) / <alpha-value>)',
        'correct-soft': 'hsl(var(--correct-soft) / <alpha-value>)',
        partial: 'hsl(var(--partial) / <alpha-value>)',
        'partial-soft': 'hsl(var(--partial-soft) / <alpha-value>)',
        focus: 'hsl(var(--focus) / <alpha-value>)',
        viz: {
          1: 'hsl(var(--viz-1) / <alpha-value>)',
          2: 'hsl(var(--viz-2) / <alpha-value>)',
          3: 'hsl(var(--viz-3) / <alpha-value>)',
          4: 'hsl(var(--viz-4) / <alpha-value>)',
        },
      },
      fontFamily: {
        serif: ['var(--font-serif)'],
        sans: ['var(--font-sans)'],
        mono: ['var(--font-mono)'],
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        DEFAULT: 'var(--radius)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
      },
      boxShadow: {
        // Flat by design. These resolve to nothing so that any component still
        // asking for a shadow simply gets none, rather than failing to build.
        pop: 'none',
        'pop-lg': 'none',
        glow: 'none',
        'glow-accent': 'none',
        sheet: 'none',
        'sheet-raised': 'none',
        focus: '0 0 0 3px hsl(var(--focus) / 0.25)',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        rise: {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'none' },
        },
      },
      animation: {
        // Everything maps onto the same two entrances. Names that used to mean
        // a bounce or a float now resolve to a quiet fade, so no component is
        // left referencing an animation that no longer exists.
        'fade-in': 'fade-in 160ms ease-out both',
        'fade-up': 'rise 200ms var(--ease-out-soft) both',
        rise: 'rise 200ms var(--ease-out-soft) both',
        'pop-in': 'fade-in 160ms ease-out both',
        'slide-in': 'fade-in 160ms ease-out both',
        'flip-in': 'fade-in 160ms ease-out both',
        float: 'none',
        wiggle: 'none',
        'pulse-slow': 'none',
        'gradient-pan': 'none',
        shimmer: 'none',
        'ring-glow': 'none',
      },
      transitionTimingFunction: {
        spring: 'var(--ease-out-soft)',
        soft: 'var(--ease-out-soft)',
        sheet: 'var(--ease-out-soft)',
      },
    },
  },
  plugins: [],
};

export default config;
