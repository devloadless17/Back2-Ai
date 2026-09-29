import { describe, expect, it } from 'vitest';

import { systemPrompt } from '@/lib/chat';

/**
 * The three failures a live check of LS biology found (2026-09-29, 16 answers):
 * refusing programme knowledge when the official solution was missing, opening
 * every biology document with a humanities "type / source / issue" block, and
 * long tutoring prose instead of the exam answer.
 */
const concept = { kind: 'concept', confidence: 'high', signal: 'test' } as const;
const bioQuestion = 'Referring to document 2, analyze the variation of the antibody concentration. Name the cell that secretes it.';

describe('a recognised exam question whose official solution may be missing', () => {
  const prompt = systemPrompt('exact_match', concept, 'en', 'en', bioQuestion, 'Life Sciences');

  it('lets the tutor supply programme knowledge instead of refusing it', () => {
    expect(prompt).toContain('answer each part yourself from');
    expect(prompt).toContain('the standard content of the Lebanese programme');
    expect(prompt).not.toContain('Do not fill\n  the gap from general knowledge');
  });

  it('still forbids invented data and invented marking', () => {
    expect(prompt).toContain('Do not invent DATA');
    expect(prompt).toContain('Do not invent a barème');
  });

  it('keeps following the official solution when there is one', () => {
    expect(prompt).toContain('official question and its official solution');
  });
});

describe('document presentation stays in the humanities', () => {
  const has = (p: string) => p.includes('scores the PRESENTATION of each document');

  it('is not added to a biology question that mentions a document', () => {
    expect(has(systemPrompt('exact_match', concept, 'en', 'en', bioQuestion, 'Life Sciences'))).toBe(false);
    expect(has(systemPrompt('concept_level', concept, 'fr', 'fr', 'Analysez le document 1.', 'Sciences de la vie'))).toBe(false);
  });

  it('is still added to civics and geography', () => {
    expect(has(systemPrompt('concept_level', concept, 'ar', 'ar', 'حلّل المستند الأوّل', 'تربية وطنية'))).toBe(true);
    expect(has(systemPrompt('concept_level', concept, 'ar', 'ar', 'حلّل المستند الأوّل', 'جغرافيا'))).toBe(true);
  });
});

describe('science answers are written the way the paper is marked', () => {
  const style = (p: string) => p.includes('Write the answer the way it is written on the exam paper');

  it('is added to a recognised science exam question', () => {
    expect(style(systemPrompt('exact_match', concept, 'en', 'en', bioQuestion, 'Life Sciences'))).toBe(true);
    expect(style(systemPrompt('exact_match', concept, 'fr', 'fr', 'Calculer la vitesse.', 'Physique'))).toBe(true);
  });

  it('is not added to a plain concept question or to a humanities subject', () => {
    expect(style(systemPrompt('concept_level', concept, 'en', 'en', 'What is a plasmocyte?', 'Life Sciences'))).toBe(false);
    expect(style(systemPrompt('exact_match', concept, 'ar', 'ar', 'حلّل المستند الأوّل', 'تاريخ'))).toBe(false);
  });
});

describe('everything else is unchanged', () => {
  it('a concept question keeps the answer-only-from-the-material rule', () => {
    expect(systemPrompt('concept_level', concept, 'en', 'en', 'What is a plasmocyte?', 'Life Sciences')).toContain(
      'Answer ONLY from the material given below',
    );
  });
});
