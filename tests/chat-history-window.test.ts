import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The tutor must be handed the END of a conversation, not its beginning.
 *
 * The route read `orderBy: asc` with `take: 20` — the first twenty messages —
 * so from the eleventh exchange on the tutor never saw what had just been said.
 * Source-level, like the other route checks here: the real thing needs a
 * database.
 */
const route = readFileSync(join(process.cwd(), 'src', 'app', 'api', 'chat', 'messages', 'route.ts'), 'utf8');

describe('the history a chat turn is given', () => {
  it('takes the newest messages and restores their order', () => {
    const block = route.slice(route.indexOf('messages: {'), route.indexOf('messages: {') + 200);
    expect(block).toContain("orderBy: { createdAt: 'desc' }");
    expect(block).toContain('take:');
    expect(route).toContain('[...session.messages].reverse()');
  });
});
