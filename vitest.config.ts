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
    /*
     * Not every test here is pure, and the default five seconds is what that
     * costs.
     *
     * `exercise-marks` and `taxonomy-heading` pin regexes that live in
     * `extract_exams.py`, and they check them by running the real module rather
     * than a copy — which is the point, because a copy drifts. Each case spawns
     * a Python that imports eighteen hundred lines and pypdf, about 1.4s on its
     * own. Run alongside seventy other files they miss five seconds and fail.
     *
     * The failures that produced were WORSE THAN USELESS: a different two or
     * three tests failed on each run, in files that pass 6/6 and 30/30 on their
     * own, so the suite reported red without ever naming a real defect and hid
     * whatever else might have been wrong. A timeout that fires on contention
     * is not a test.
     *
     * Thirty seconds is chosen against the slowest case measured (2.4s) with
     * room for a loaded machine. A genuinely hung test still fails, just later,
     * and later is the right trade against a suite nobody can read.
     */
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      'server-only': path.resolve(__dirname, './tests/stubs/server-only.ts'),
      '@': path.resolve(__dirname, './src'),
    },
  },
});
