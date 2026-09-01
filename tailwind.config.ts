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
        /** The spine: indigo. Current state and the primary action only. */
        primary: 'hsl(var(--primary) / <alpha-value>)',
        'primary-hover': 'hsl(var(--primary-hover) / <alpha-value>)',
        'primary-soft': 'hsl(var(--primary-soft) / <alpha-value>)',
        'on-primary': 'hsl(var(--on-primary) / <alpha-value>)',
        /** Violet: the lighter half of the brand, for gradients and secondary emphasis. */
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
        'mark-bright': 'hsl(var(--mark-bright) / <alpha-value>)',
        'correct-bright': 'hsl(var(--correct-bright) / <alpha-value>)',
        'partial-bright': 'hsl(var(--partial-bright) / <alpha-value>)',
        viz: {
          1: 'hsl(var(--viz-1) / <alpha-value>)',
          2: 'hsl(var(--viz-2) / <alpha-value>)',
          3: 'hsl(var(--viz-3) / <alpha-value>)',
          4: 'hsl(var(--viz-4) / <alpha-value>)',
        },
      },
      fontFamily: {
        display: ['var(--font-display)'],
        serif: ['var(--font-serif)'],
        sans: ['var(--font-sans)'],
        mono: ['var(--font-mono)'],
      },
      /**
       * The type scale.
       *
       * Written because there wasn't one. Every size in the app was an ad-hoc
       * `text-[Npx]`, and counting them found 176 of about 210 uses inside a
       * 2.5px band — 12.5px (49), 13px (47), 12px (44), 11.5px (25) — and then
       * a cliff straight to 26px. There was no middle. The page read as
       * caption, caption, caption, headline, which is most of why a carefully
       * built palette still looked inexpensive.
       *
       * Half-pixel steps were the other symptom: 8.5, 10.5, 11.5, 12.5, 13.5.
       * Fourteen distinct values is not a scale, it is nudging until it fits.
       *
       * Seven steps on a ~1.22 ratio, all integers. Named for the job rather
       * than the size, so a component asks for `text-title` and inherits any
       * later change to what a title is worth.
       *
       * `micro` is a floor, not a step to design with: 8.5px and 10px were both
       * in use, and this product is open at one in the morning by someone who
       * has been reading all day.
       */
      fontSize: {
        micro: ['11px', { lineHeight: '1.45' }],
        caption: ['12px', { lineHeight: '1.45' }],
        meta: ['13px', { lineHeight: '1.5' }],
        body: ['15px', { lineHeight: '1.6' }],
        lead: ['17px', { lineHeight: '1.55' }],
        title: ['21px', { lineHeight: '1.3', letterSpacing: '-0.01em' }],
        heading: ['26px', { lineHeight: '1.2', letterSpacing: '-0.015em' }],
        display: ['32px', { lineHeight: '1.12', letterSpacing: '-0.02em' }],
        hero: ['40px', { lineHeight: '1.06', letterSpacing: '-0.025em' }],
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        DEFAULT: 'var(--radius)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
      },
      boxShadow: {
        // Tinted with the brand hue, never black: a neutral shadow over a
        // lavender ground reads as smudge rather than as lift.
        sheet: '0 10px 30px hsl(var(--primary) / 0.08)',
        'sheet-raised': '0 14px 34px hsl(var(--primary) / 0.14)',
        pop: '0 8px 18px hsl(var(--partial-bright) / 0.35)',
        'pop-lg': '0 16px 38px hsl(var(--primary) / 0.22)',
        glow: '0 0 0 4px hsl(var(--primary) / 0.12)',
        'glow-accent': '0 0 0 4px hsl(var(--accent) / 0.18)',
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
