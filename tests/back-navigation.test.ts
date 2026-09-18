import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Where "back" goes, stated rather than remembered.
 *
 * `BackLink` has always taken an explicit `href` — it never called
 * `router.back()`, because history replays redirects (`/chat` forwards to the
 * newest session, so going back to it skips straight on again) and because a
 * student arriving from a notification or a shared link has no history to
 * replay at all.
 *
 * So the thing worth pinning is not the mechanism but the destinations: the
 * parent of a page is a fact about the product, and it must not drift back to
 * whatever the URL happens to nest under.
 */

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), 'utf8');

const page = (...parts: string[]) => read('src', 'app', '(app)', ...parts, 'page.tsx');

/** Source with comments removed, so prose about a thing is not read as the thing. */
const codeOnly = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the back link never uses history', () => {
  it('is a link to a stated parent', () => {
    /*
     * Comments stripped first. The component explains AT LENGTH why it does not
     * call `router.back()`, and a plain substring match reads that explanation
     * as the thing it warns against.
     */
    const code = codeOnly(read('src', 'components', 'ui', 'back-link.tsx'));
    expect(code).not.toContain('router.back');
    expect(code).not.toContain('useRouter');
    expect(code).toContain('href');
  });
});

describe('the parent of each nested page', () => {
  it('sends a subject hub to the dashboard, not to the subject list', () => {
    /*
     * `/practice` is the parent by URL and the wrong answer by use. A student
     * reaches a subject hub from the dashboard, a next-move card, a chapter or
     * a classmate's link; the subject list is a picker they passed through
     * once. This is the case that prompted the change.
     */
    const subjectHub = page('practice', '[subjectId]');
    expect(subjectHub).toContain('<BackLink href="/dashboard"');
    expect(subjectHub).not.toContain('<BackLink href="/practice"');
  });

  it('sends a chapter to its own subject hub', () => {
    expect(page('practice', '[subjectId]', '[chapterId]')).toContain(
      'href={`/practice/${chapter.subject.id}`}',
    );
  });

  it('sends a quiz to its chapter', () => {
    expect(page('practice', '[subjectId]', '[chapterId]', 'quiz')).toContain(
      'href={`/practice/${chapter.subject.id}/${chapter.id}`}',
    );
  });

  it('sends a mock result to the mock index', () => {
    expect(page('exam-sim', '[examSimulationId]', 'results')).toContain(
      '<BackLink href="/exam-sim"',
    );
  });

  it('sends a worksheet to a parent it can actually name', () => {
    /*
     * A worksheet can span several chapters (`?chapters=a,b,c`), so "the
     * chapter page" only exists when exactly one was chosen. The page resolves
     * chapter, then subject, then dashboard — never guessing at one of several.
     */
    const worksheet = page('worksheet');
    expect(worksheet).toContain('parentHref');
    expect(worksheet).toContain('chapterIds.length === 1');
  });
});
