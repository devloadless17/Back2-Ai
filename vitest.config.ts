import path from 'node:path';

import { defineConfig } from 'vitest/config';

/**
 * Unit tests only.
 *
 * The scoring, scheduling and marking rules are written as pure functions
 * precisely so they can be tested without a database or an API key — those are
 * the parts where a quiet arithmetic error becomes a wrong statement about a
 * student's readiness for a national exam.
 *
 * `server-only` is stubbed: the package throws by design when it is imported
 * outside a React Server Component, which is exactly the guarantee we want in
 * the app and exactly the thing that would stop a plain Node test runner from
 * loading these modules at all.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
  },
  resolve: {
    alias: {
      'server-only': path.resolve(__dirname, './tests/stubs/server-only.ts'),
      '@': path.resolve(__dirname, './src'),
    },
  },
});
