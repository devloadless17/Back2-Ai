import { describe, expect, it } from 'vitest';

import { performanceRedirectTarget } from '@/lib/performance-redirect';

/**
 * `/performance` merged into `/progress`.
 *
 * The route still exists only for links we do not control — a bookmark, a
 * message a student sent themselves, a tab left open since last term. Every
 * link inside the application points at `/progress` directly, so nothing in
 * normal use should ever reach this.
 */
describe('old performance links', () => {
  it('lands on progress', () => {
    expect(performanceRedirectTarget({})).toBe('/progress');
  });

  it('carries query context across rather than dropping it', () => {
    // A bookmark with a subject on it came from a student looking at that
    // subject. Arriving at the top of a page they did not ask for is a small,
    // avoidable loss.
    expect(performanceRedirectTarget({ subject: 'abc' })).toBe('/progress?subject=abc');
  });

  it('keeps a repeated parameter repeated', () => {
    expect(performanceRedirectTarget({ tag: ['a', 'b'] })).toBe('/progress?tag=a&tag=b');
  });

  it('passes unknown parameters through instead of filtering to a fixed list', () => {
    // A filter here is a list that would have to be kept up to date, and the
    // failure mode is silent: a parameter added later would simply vanish.
    const target = performanceRedirectTarget({ anything: 'kept' });
    expect(target).toBe('/progress?anything=kept');
  });

  it('encodes rather than pasting a value straight into the URL', () => {
    expect(performanceRedirectTarget({ q: 'a b&c' })).toBe('/progress?q=a+b%26c');
  });

  it('ignores an absent value', () => {
    expect(performanceRedirectTarget({ subject: undefined })).toBe('/progress');
  });
});
