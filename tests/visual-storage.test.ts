import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { visualStorageKey } from '@/lib/visual-selection';

/**
 * Content-addressed visual storage, through the real local driver.
 *
 * The backfill must be able to run twice and write nothing the second time,
 * and must never overwrite a stored visual with different bytes — the key
 * names the bytes, so a mismatch is a corruption to stop on, not an update.
 */
const ROOT = mkdtempSync(path.join(tmpdir(), 'bac2-visual-storage-'));
const ORIGINAL_CWD = process.cwd();
let storage: typeof import('@/lib/storage');

beforeAll(async () => {
  process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
  process.env.SESSION_SECRET ??= 'test-secret-at-least-sixteen';
  delete process.env.STORAGE_DRIVER;
  process.chdir(ROOT);
  storage = await import('@/lib/storage');
});

afterAll(() => {
  process.chdir(ORIGINAL_CWD);
  rmSync(ROOT, { recursive: true, force: true });
});

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

describe('putContentAddressed', () => {
  const bytes = Buffer.from('a crop of document 2');
  const key = visualStorageKey('question', sha(bytes), 'image/jpeg');

  it('writes once, then reports unchanged — idempotent', async () => {
    expect(await storage.putContentAddressed(key, bytes, 'image/jpeg')).toBe('written');
    expect(await storage.putContentAddressed(key, bytes, 'image/jpeg')).toBe('unchanged');
    expect((await storage.getObject(key)).equals(bytes)).toBe(true);
  });

  it('refuses bytes that do not hash to the key they would be written under', async () => {
    await expect(storage.putContentAddressed(key, Buffer.from('different'), 'image/jpeg')).rejects.toThrow(
      storage.ContentConflictError,
    );
    expect((await storage.getObject(key)).equals(bytes)).toBe(true);
  });

  it('refuses a key with no content hash in it', async () => {
    await expect(storage.putContentAddressed('question-images/crop.jpg', bytes, 'image/jpeg')).rejects.toThrow();
  });

  it('question and solution copies of identical bytes are separate objects', async () => {
    const shared = Buffer.from('printed in a statement and in a scheme');
    const q = visualStorageKey('question', sha(shared), 'image/png');
    const s = visualStorageKey('solution', sha(shared), 'image/png');
    await storage.putContentAddressed(q, shared, 'image/png');
    await storage.putContentAddressed(s, shared, 'image/png');
    expect(q.startsWith('question-images/')).toBe(true);
    expect(s.startsWith('solution-images/')).toBe(true);
    expect(storage.ownerFromKey(s)).toBeNull();
  });
});
