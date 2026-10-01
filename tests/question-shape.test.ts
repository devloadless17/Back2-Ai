import { describe, expect, it } from 'vitest';

import { isForeignToFrenchCourse, isFrenchAnswerKeyFragment, isMissingRequiredPassage, isWholeFrenchPaper, isUnusableFrenchExercise } from '@/lib/question-shape';

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

  it('rejects a long comprehension section even when OCR loses its headings', () => {
    const section = Array.from(
      { length: 5 },
      (_, index) => `${index + 1}- Analysez le passage et justifiez votre réponse avec deux indices. ${'détail '.repeat(25)}`,
    ).join('\n');
    expect(isWholeFrenchPaper(section)).toBe(true);
  });

  it('rejects philosophy papers imported into French cycles', () => {
    const text = '1- Expliquez ce jugement de Kant en dégageant la problématique qu’il soulève. (9 points) 2- Discutez ce jugement.';
    expect(isForeignToFrenchCourse(text)).toBe(true);
    expect(isUnusableFrenchExercise(text)).toBe(true);
  });

  it('rejects economics pages imported into French cycles', () => {
    expect(isForeignToFrenchCourse('Calculez la balance commerciale puis son effet sur le PIB et le pouvoir d’achat.')).toBe(true);
  });

  it('rejects correction tables stored as questions', () => {
    expect(isFrenchAnswerKeyFragment('Questions Réponses Critères d’évaluation Note')).toBe(true);
  });

  it('keeps a real French essay about economic life', () => {
    expect(isUnusableFrenchExercise('Sujet : Pensez-vous que le travail permet à l’individu de s’épanouir ?')).toBe(false);
  });

  it('withholds a comprehension prompt when its source text is absent', () => {
    expect(isMissingRequiredPassage('En vous appuyant sur le texte, justifiez.', null)).toBe(true);
    expect(isMissingRequiredPassage('En vous appuyant sur le texte, justifiez.', 'Texte source')).toBe(false);
    expect(isMissingRequiredPassage('Rédigez un texte argumentatif.', null)).toBe(false);
  });
});
