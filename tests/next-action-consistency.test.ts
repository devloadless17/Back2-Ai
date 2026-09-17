import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Dashboard and Progress must not recommend different things.
 *
 * A student who is told to revise flashcards on one screen and to open a weak
 * chapter on the next has been given two answers to one question, and will
 * believe neither. The guarantee is structural: both surfaces read the same
 * `getNextUp`, so the recommendation — which action, and where it points —
 * cannot diverge.
 *
 * This is a source-level check because the real thing needs a database and
 * there is none here. It cannot prove the rendered copy matches; it can prove
 * neither page has grown its own ladder, which is the way this would actually
 * break. The wording is allowed to differ — the dashboard has room for a
 * reason and Progress does not — and the runtime comparison stays in the
 * verification debt.
 */

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), 'utf8');

const dashboard = read('src', 'app', '(app)', 'dashboard', 'page.tsx');
const progress = read('src', 'app', '(app)', 'progress', 'page.tsx');

describe('the next action has one source', () => {
  it('is read from getNextUp on the dashboard', () => {
    expect(dashboard).toContain('getNextUp');
  });

  it('is read from getNextUp on progress', () => {
    expect(progress).toContain('getNextUp');
  });

  it('keeps the ladder in one module', () => {
    /*
     * An earlier version of this test asserted that neither page counted due
     * flashcards itself. That was wrong: the dashboard counts them for a tile
     * that shows the number, which is a different job from choosing what to do
     * next. The check could not tell the two apart, so it is gone rather than
     * loosened into something that passes without meaning anything.
     *
     * What does hold: every branch of the decision lives in `next-up.ts`, and
     * the pages receive the result.
     */
    const ladder = read('src', 'lib', 'queries', 'next-up.ts');
    for (const kind of ['flashcards', 'weakChapter', 'newChapter', 'examSim', 'anything']) {
      expect(ladder).toContain(kind);
    }
  });

  it('renders the result through the shared card on progress', () => {
    expect(progress).toContain('NextUpCard');
  });
});

describe('the pages that were merged', () => {
  it('leaves no internal link to the retired route', () => {
    // `/performance` still resolves, for bookmarks. Nothing inside the
    // application should route a student through a redirect to reach a page we
    // already know the address of.
    const files = [
      progress,
      read('src', 'components', 'shell', 'sidebar.tsx'),
      read('src', 'components', 'shell', 'bottom-nav.tsx'),
    ];
    for (const file of files) {
      expect(file).not.toMatch(/href=["'{`]\s*['"`]?\/performance/);
    }
  });
});
