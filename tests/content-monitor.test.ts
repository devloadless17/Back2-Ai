import { describe, expect, it } from 'vitest';

import { inspectContent } from '@/lib/content-monitor';

const subject = (text: string, overrides: Record<string, unknown> = {}) => [{
  name: 'Francais', language: 'fr' as const, track: { code: 'GS' },
  chapters: [{
    id: 'chapter', name: 'La bioéthique', cancelledAt: null as Date | null,
    contentChunks: [{ chunk: { id: 'chunk', contentText: 'Texte propre et lisible.' } }],
    questions: [{
      id: 'question', contentText: text, contentLatex: null, sourcePassage: 'Le passage.',
      officialSolution: 'Réponse.', modelSolution: null, bareme: [], verifiedStatus: 'verified',
      ...overrides,
    }],
  }],
}];

describe('content monitor', () => {
  it('flags a foreign ministry cover in a French item', () => {
    expect(inspectContent(subject('Question. وزارة التربية والتعليم العالي')).map((i) => i.code))
      .toContain('foreign_cover');
  });

  it('flags a text-dependent question whose passage is missing', () => {
    const issues = inspectContent(subject('Selon le texte, justifiez votre réponse.', { sourcePassage: null }));
    expect(issues.map((i) => i.code)).toContain('missing_passage');
  });

  it('reports empty live chapters but ignores cancelled ones', () => {
    const input = subject('Question.');
    input[0]!.chapters[0]!.questions = [];
    input[0]!.chapters[0]!.contentChunks = [];
    expect(inspectContent(input).map((i) => i.code)).toEqual(['no_practice', 'no_textbook_material']);
    input[0]!.chapters[0]!.cancelledAt = new Date();
    expect(inspectContent(input)).toEqual([]);
  });
});
