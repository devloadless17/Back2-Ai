import type { Config } from 'tailwindcss';

/**
 * Every colour resolves to a CSS custom property defined in globals.css.
 *
 * That indirection is the point: when the design files land, the palette is
 * replaced by editing `:root` in one stylesheet, and no component changes.
 * Components must reference semantic names (`bg-paper`, `text-mark`) and never
 * raw Tailwind palette values like `bg-slate-50`.
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
        /** The examiner's pen. Marks, deductions, countdown urgency. Used sparingly. */
        mark: 'hsl(var(--mark) / <alpha-value>)',
        'mark-soft': 'hsl(var(--mark-soft) / <alpha-value>)',
        correct: 'hsl(var(--correct) / <alpha-value>)',
        'correct-soft': 'hsl(var(--correct-soft) / <alpha-value>)',
        partial: 'hsl(var(--partial) / <alpha-value>)',
        'partial-soft': 'hsl(var(--partial-soft) / <alpha-value>)',
        focus: 'hsl(var(--focus) / <alpha-value>)',
      },
      fontFamily: {
        // Official-document serif for headings and question text.
        serif: ['var(--font-serif)'],
        // Interface sans for controls, navigation, and data.
        sans: ['var(--font-sans)'],
        // Working / answer text — a monospace grid reads like squared paper.
        mono: ['var(--font-mono)'],
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        DEFAULT: 'var(--radius)',
        lg: 'var(--radius-lg)',
      },
      boxShadow: {
        // Paper lifting off paper, not a floating card in space.
        sheet: '0 1px 2px hsl(var(--ink) / 0.04), 0 2px 8px hsl(var(--ink) / 0.04)',
        'sheet-raised': '0 2px 4px hsl(var(--ink) / 0.05), 0 8px 24px hsl(var(--ink) / 0.07)',
        focus: '0 0 0 3px hsl(var(--focus) / 0.35)',
      },
      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'none' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'card-flip': {
          from: { transform: 'rotateX(0deg)' },
          to: { transform: 'rotateX(180deg)' },
        },
        pulse: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.4' },
        },
      },
      animation: {
        'fade-up': 'fade-up 260ms cubic-bezier(0.2, 0.8, 0.2, 1) both',
        'fade-in': 'fade-in 180ms ease-out both',
        'pulse-slow': 'pulse 2s ease-in-out infinite',
      },
      transitionTimingFunction: {
        // Everything that moves uses this unless there is a reason not to.
        sheet: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
      },
    },
  },
  plugins: [],
};

export default config;
