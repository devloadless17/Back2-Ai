import { FlatCompat } from '@eslint/eslintrc';

/**
 * Flat config, because `next lint` is gone in Next 16 and was never usable here
 * anyway: with no ESLint installed it dropped into an interactive setup prompt,
 * so `npm run lint` could not run in CI or in a script and never had.
 *
 * `eslint-config-next` still ships as eslintrc, so FlatCompat translates it
 * rather than the rules being restated here — a hand-copied rule set is one
 * that drifts from the framework's the first time it changes.
 */
const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

export default [
  {
    /*
     * `corpus/` is gitignored data, `uploads/` is written at runtime, and
     * `scripts/corpus/` is Python. Linting any of them reports on files nobody
     * can act on and buries the ones they can.
     */
    ignores: [
      '.next/**',
      'node_modules/**',
      'corpus/**',
      'uploads/**',
      'next-env.d.ts',
      'src/generated/**',
    ],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    /*
     * The offline corpus tools, which read JSON nobody here defines.
     *
     * `docai.ts`, `mathpix.ts` and `gates.ts` walk responses from Document AI
     * and Mathpix — deeply nested, provider-versioned, and documented only by
     * what arrives. Writing an interface for those shapes would assert a
     * contract we do not have and would be believed by the next reader; `any`
     * at the boundary says plainly that the shape is unknown and checked by
     * hand.
     *
     * Scoped to `scripts/`, which never ships: nothing under `src/` gets this.
     */
    files: ['scripts/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  {
    /*
     * A leading underscore already means "deliberately unused" in this codebase
     * — `const { lexical: _lexical, ...hit } = row` discards a field on
     * purpose, and warning about it asks for the line to be made worse. The
     * convention is honoured; anything else unused is still reported.
     */
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
    },
  },
];
