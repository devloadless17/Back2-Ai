import type { Config } from 'tailwindcss';

/**
 * Every colour resolves to a CSS custom property defined in globals.css.
 *
 * That indirection is the point: the palette is replaced by editing `:root` in
 * one stylesheet, and no component changes. Components must reference semantic
 * names (`bg-paper`, `text-mark`) and never raw Tailwind palette values like
 * `bg-slate-50`.
 *
 * The motion vocabulary is deliberately small — five entrances, three ambient
 * loops, two easings. A larger one produces a page where every element moves
 * differently, which reads as broken rather than lively.
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
        primary: 'hsl(var(--primary) / <alpha-value>)',
        'primary-hover': 'hsl(var(--primary-hover) / <alpha-value>)',
        'primary-soft': 'hsl(var(--primary-soft) / <alpha-value>)',
        'on-primary': 'hsl(var(--on-primary) / <alpha-value>)',
        /** The reward voice: streaks, celebrations, "you did a thing". */
        accent: 'hsl(var(--accent) / <alpha-value>)',
        'accent-hover': 'hsl(var(--accent-hover) / <alpha-value>)',
        'accent-soft': 'hsl(var(--accent-soft) / <alpha-value>)',
        /** The examiner's pen. Marks, deductions, countdown urgency. */
        mark: 'hsl(var(--mark) / <alpha-value>)',
        'mark-soft': 'hsl(var(--mark-soft) / <alpha-value>)',
        correct: 'hsl(var(--correct) / <alpha-value>)',
        'correct-soft': 'hsl(var(--correct-soft) / <alpha-value>)',
        partial: 'hsl(var(--partial) / <alpha-value>)',
        'partial-soft': 'hsl(var(--partial-soft) / <alpha-value>)',
        focus: 'hsl(var(--focus) / <alpha-value>)',
        /** Chart ramp: one hue, light→dark, validated for lightness steps. */
        viz: {
          1: 'hsl(var(--viz-1) / <alpha-value>)',
          2: 'hsl(var(--viz-2) / <alpha-value>)',
          3: 'hsl(var(--viz-3) / <alpha-value>)',
          4: 'hsl(var(--viz-4) / <alpha-value>)',
        },
      },
      fontFamily: {
        // Kept for question and solution bodies, where a textbook voice helps.
        serif: ['var(--font-serif)'],
        // Interface sans — headings, controls, navigation, data.
        sans: ['var(--font-sans)'],
        // Working / answer text — a monospace grid reads like squared paper.
        mono: ['var(--font-mono)'],
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        DEFAULT: 'var(--radius)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
      },
      boxShadow: {
        // Coloured lift rather than grey drop — the shadow is tinted with the
        // brand hue so cards feel like they belong to the canvas behind them.
        pop: '0 1px 2px hsl(262 40% 40% / 0.06), 0 6px 20px hsl(262 45% 45% / 0.09)',
        'pop-lg': '0 2px 6px hsl(262 40% 40% / 0.08), 0 18px 40px hsl(262 50% 45% / 0.16)',
        glow: '0 0 0 1px hsl(var(--primary) / 0.2), 0 8px 30px hsl(var(--primary) / 0.28)',
        'glow-accent': '0 0 0 1px hsl(var(--accent) / 0.2), 0 8px 30px hsl(var(--accent) / 0.3)',
        focus: '0 0 0 3px hsl(var(--focus) / 0.35)',
        // Kept so any component still asking for the old name keeps working.
        sheet: '0 1px 2px hsl(262 40% 40% / 0.06), 0 6px 20px hsl(262 45% 45% / 0.09)',
        'sheet-raised': '0 2px 6px hsl(262 40% 40% / 0.08), 0 18px 40px hsl(262 50% 45% / 0.16)',
      },
      keyframes: {
        // --- Entrances ---
        rise: {
          from: { opacity: '0', transform: 'translateY(14px) scale(0.985)' },
          to: { opacity: '1', transform: 'none' },
        },
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'none' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'pop-in': {
          '0%': { opacity: '0', transform: 'scale(0.86)' },
          '60%': { opacity: '1', transform: 'scale(1.04)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'slide-in': {
          from: { opacity: '0', transform: 'translateX(-12px)' },
          to: { opacity: '1', transform: 'none' },
        },

        // --- Ambient loops ---
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-5px)' },
        },
        wiggle: {
          '0%, 100%': { transform: 'rotate(-2.5deg)' },
          '50%': { transform: 'rotate(2.5deg)' },
        },
        pulse: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.4' },
        },
        'gradient-pan': {
          from: { backgroundPosition: '0% 50%' },
          to: { backgroundPosition: '300% 50%' },
        },
        shimmer: {
          from: { backgroundPosition: '100% 50%' },
          to: { backgroundPosition: '0% 50%' },
        },

        // --- Feedback ---
        'ring-glow': {
          '0%, 100%': { boxShadow: '0 0 0 0 hsl(var(--accent) / 0.45)' },
          '50%': { boxShadow: '0 0 0 10px hsl(var(--accent) / 0)' },
        },
        // The card-flip reveal in the flashcard deck.
        'flip-in': {
          from: { opacity: '0', transform: 'rotateX(-12deg) translateY(8px)' },
          to: { opacity: '1', transform: 'none' },
        },
      },
      animation: {
        rise: 'rise 420ms var(--ease-spring) both',
        'fade-up': 'fade-up 320ms var(--ease-out-soft) both',
        'fade-in': 'fade-in 200ms ease-out both',
        'pop-in': 'pop-in 380ms var(--ease-spring) both',
        'slide-in': 'slide-in 340ms var(--ease-out-soft) both',
        'flip-in': 'flip-in 340ms var(--ease-spring) both',
        float: 'float 4s ease-in-out infinite',
        wiggle: 'wiggle 500ms ease-in-out 2',
        'pulse-slow': 'pulse 2s ease-in-out infinite',
        'gradient-pan': 'gradient-pan 8s linear infinite',
        shimmer: 'shimmer 1.6s ease-in-out infinite',
        'ring-glow': 'ring-glow 1.8s ease-out infinite',
      },
      transitionTimingFunction: {
        // The default for anything that moves under the pointer.
        spring: 'var(--ease-spring)',
        soft: 'var(--ease-out-soft)',
        // Retained so existing `ease-sheet` usages keep working.
        sheet: 'var(--ease-out-soft)',
      },
    },
  },
  plugins: [],
};

export default config;
