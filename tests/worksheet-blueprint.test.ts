import { describe, expect, it } from 'vitest';

import { followsWorksheetBlueprint, worksheetBlueprint } from '@/lib/worksheet-blueprint';

describe('worksheet subject blueprints', () => {
  const comprehension =
    'Read the following passage carefully, and then answer the questions that follow. Paragraph 1 explains the discovery.';
  const writing =
    'Prompt A: Write a well-organized argumentative essay of 250-300 words about technology.';

  it('builds one complete comprehension section for English', () => {
    expect(worksheetBlueprint('English')).toEqual({ count: 1, acceptedKinds: ['comprehension'] });
    expect(followsWorksheetBlueprint('English', comprehension)).toBe(true);
    expect(followsWorksheetBlueprint('English', writing)).toBe(false);
  });

  it('uses the same passage-based section rule for French and Arabic literature', () => {
    expect(worksheetBlueprint('Francais').count).toBe(1);
    expect(worksheetBlueprint('أدب عربي').count).toBe(1);
    expect(followsWorksheetBlueprint('Francais', 'Production écrite : Rédigez un essai argumentatif.')).toBe(false);
  });

  it('uses the three official alternatives for philosophy', () => {
    expect(worksheetBlueprint('فلسفة عامة')).toEqual({ count: 3, acceptedKinds: ['essay'] });
  });

  it('keeps a fixed general-subject default', () => {
    expect(worksheetBlueprint('Mathematics')).toEqual({ count: 8, acceptedKinds: null });
  });
});
