import { describe, expect, it } from 'vitest';

import { isWholeFrenchPaper } from '@/lib/question-shape';

describe('French practice question shape', () => {
  it('rejects the real full-paper shape currently shown as one exercise', () => {
    const paper = [
      'émergence : apparition 2- duplication : reproduction, copie',
      'I- Questions (13 pts)',
      '1- a. Vous appuyant sur un champ lexical prédominant...',
      'II- Production écrite (7 pts)',
      'Sujet : Commentant le progrès technique...',
      'Consignes de travail',
    ].join('\n');
    expect(isWholeFrenchPaper(paper)).toBe(true);
  });

  it('keeps an individual comprehension question', () => {
    expect(isWholeFrenchPaper('1- Relevez le lexique évaluatif du premier paragraphe. (1 pt)')).toBe(false);
  });

  it('keeps an individual writing exercise', () => {
    expect(isWholeFrenchPaper('Production écrite (7 pts)\nRédigez un texte argumentatif.')).toBe(false);
  });

  it('rejects the same full-paper layout when OCR loses the printed marks', () => {
    expect(isWholeFrenchPaper('I. Questions\n1. Analysez le texte.\nII. Production écrite\nSujet : Rédigez.')).toBe(true);
  });
});
