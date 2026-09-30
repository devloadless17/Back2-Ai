import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { paperScopeFor } from '../src/lib/queries/taxonomy';

describe('official-paper section scope', () => {
  it('keeps every paper under the section printed on it', async () => {
    const gs = 'aaaaaaaa-0000-0000-0000-000000000001';
    const ls = 'bbbbbbbb-0000-0000-0000-000000000002';

    await expect(paperScopeFor([gs, ls])).resolves.toEqual(
      new Map([
        [gs, gs],
        [ls, ls],
      ]),
    );
  });

  it('does not invent another section from a shared textbook', async () => {
    const lhPhysics = 'cccccccc-0000-0000-0000-000000000003';
    await expect(paperScopeFor([lhPhysics])).resolves.toEqual(new Map([[lhPhysics, lhPhysics]]));
  });
});
