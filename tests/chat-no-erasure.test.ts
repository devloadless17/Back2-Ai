import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const chat = readFileSync(join(process.cwd(), 'src', 'lib', 'chat.ts'), 'utf8');

describe('verification disagreement', () => {
  it('keeps the streamed answer and flags it instead of replacing it', () => {
    expect(chat).toContain('Verification disputed the shown answer');
    expect(chat).toContain("yield { type: 'done', messageId: message.id, verified: false }");
    expect(chat).not.toContain("content: RETRACTION_TEXT[input.locale]");
    expect(chat).not.toContain("yield { type: 'retracted', messageId: message.id");
  });
});
