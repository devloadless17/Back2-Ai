import { describe, expect, it } from 'vitest';

/**
 * A blank variable is an unset one.
 *
 * A hosting dashboard cannot express "absent" — you delete the row or you leave
 * the box empty, and people leave it empty. Zod reads that empty string as a
 * value, so a variable carrying a perfectly good `.default()` fails validation
 * instead of using it. This failed a production build on `OCR_PROVIDER=""`.
 */
describe('empty environment variables', () => {
  it('are dropped before validation, so defaults apply', async () => {
    const before = { ...process.env };
    process.env.OCR_PROVIDER = '';
    process.env.DEFAULT_LOCALE = '';
    process.env.DATABASE_URL = 'postgresql://u:p@localhost:5432/db';
    process.env.SESSION_SECRET = 'x'.repeat(32);

    // Imported fresh so the module-level cache does not hide the result.
    const { env } = await import(`@/lib/env?t=${Date.now()}`);
    const parsed = env();

    expect(parsed.OCR_PROVIDER).toBe('vision');
    expect(parsed.DEFAULT_LOCALE).toBe('en');

    process.env = before;
  });

  it('treats a variable that is only whitespace as unset too', async () => {
    const before = { ...process.env };
    process.env.DEFAULT_LOCALE = '   ';
    process.env.DATABASE_URL = 'postgresql://u:p@localhost:5432/db';
    process.env.SESSION_SECRET = 'x'.repeat(32);

    const { env } = await import(`@/lib/env?t=${Date.now()}b`);
    expect(env().DEFAULT_LOCALE).toBe('en');

    process.env = before;
  });
});
