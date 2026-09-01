import { describe, expect, it } from 'vitest';

import { classifyQuestionKind } from '../src/lib/question-kind';

/*
 * The classifier decides which of three paths a question takes through
 * retrieval, and one of those paths — chapter search — is the one that answers
 * confidently from material that cannot contain the answer. So the cases that
 * matter most here are not the clean ones. They are the ones where a rule
 * nearly fired and should not have, because every false concept is an invisible
 * wrong answer and every false comprehension is a refusal a student did not
 * deserve.
 *
 * Every example below is text from the corpus or a question a student would
 * type, not an invention.
 */

const kind = (text: string) => classifyQuestionKind(text).kind;

describe('essay prompts', () => {
  it('reads the header the paper prints over the prompt', () => {
    expect(kind('Sujet : Partagez-vous le point de vue de Dominique Meda ?')).toBe('essay');
    expect(kind('Deuxième sujet : La liberté est-elle une illusion ?')).toBe('essay');
    expect(kind('الموضوع الأول: هل الحرية شعور طبيعي ذاتي؟')).toBe('essay');
  });

  it('reads an Arabic instruction to argue', () => {
    expect(kind('اشرح هذا القول مبيّناً الإشكاليّة التي يطرحها')).toBe('essay');
    expect(kind('ناقش هذا الحكم في ضوء نظرية أخرى')).toBe('essay');
  });

  it('survives the letter-spacing a shaping font leaves behind', () => {
    // Verbatim from a philosophy paper in the corpus: one verb, three spaces.
    expect(kind('أ- اش ر ح هذا الحكم لـ "سبينوزا" مبيّـنــًا الإشكاليّة التي يطرحها.')).toBe('essay');
  });

  it('normalises the alef a student types differently from the paper', () => {
    expect(kind('الموضوع الاول')).toBe('essay');
    expect(kind('الموضوع الأول')).toBe('essay');
  });

  it('keeps the commentaire de texte with the essays', () => {
    /*
     * The passage is quoted inside the prompt, so naming a text here is not the
     * paper pointing off its own page — and what is wanted is still an argued
     * essay marked against the philosophy barème.
     */
    expect(
      kind(
        'Texte : L’homme est un être doué de conscience et qui pense. ' +
          'Expliquez ce texte en en dégageant la problématique.',
      ),
    ).toBe('essay');
    expect(kind('Explain this judgment of Smith and state the problematic it raises.')).toBe('essay');
  });
});

describe('comprehension questions', () => {
  it('catches a reference to the text on the paper', () => {
    expect(
      kind('Identifiez le référent du pronom « on » dans les deux premiers paragraphes du texte de Lamennais.'),
    ).toBe('comprehension');
    expect(kind('Quel est le mot qui, par ses répétitions, souligne le thème du texte ?')).toBe(
      'comprehension',
    );
  });

  it('catches a line reference', () => {
    expect(kind('Dans les lignes 12 à 17, délimitez les passages au style direct.')).toBe(
      'comprehension',
    );
    expect(kind('Relevez deux procédés (l. 5).')).toBe('comprehension');
  });

  it('catches the Arabic document papers', () => {
    expect(kind('بالعودة الى المستند رقم (1) استخرج ثلاثة أسباب')).toBe('comprehension');
    expect(kind('حدّد فكرة الفقرة الثانية')).toBe('comprehension');
  });

  it('catches an English comprehension prompt', () => {
    expect(kind('According to the text, why did the narrator leave?')).toBe('comprehension');
    expect(kind('What does the author mean in line 4?')).toBe('comprehension');
  });
});

describe('concept questions', () => {
  it('leaves ordinary bookwork on the chapter path', () => {
    expect(kind('ما هي البطالة؟')).toBe('concept');
    expect(kind("Qu'est-ce qu'une suite géométrique ?")).toBe('concept');
    expect(kind('Explain the photoelectric effect.')).toBe('concept');
    expect(kind('Comment calculer la concentration molaire ?')).toBe('concept');
  });

  it('does not read a maths MCQ as comprehension', () => {
    /*
     * Every Lebanese maths paper opens this way. `tableau` is deliberately not
     * a document noun: reading this as comprehension would refuse a question
     * its own chapter answers.
     */
    expect(
      kind('Dans le tableau suivant, une seule des réponses proposées est correcte. Justifier.'),
    ).toBe('concept');
  });

  it('does not read chemistry vocabulary as an essay instruction', () => {
    // `composition` matched "Décomposition" on 36 chemistry papers before the
    // word was taken out of the instruction list.
    expect(kind("Décomposition de l’eau oxygénée : calculer la concentration initiale.")).toBe(
      'concept',
    );
    // ...and `write a` matched this on 89 maths ones.
    expect(kind('Write an equation of the plane (P) through A and B.')).toBe('concept');
  });

  it('does not read "النصف" as "النص"', () => {
    // Half, not the text. The Arabic document nouns are matched with
    // boundaries for exactly this.
    expect(kind('احسب النصف الأول من المسافة')).toBe('concept');
  });
});

describe('confidence', () => {
  it('flags a question that points at something it does not carry', () => {
    const result = classifyQuestionKind('Explain the following diagram.');
    expect(result.kind).toBe('concept');
    expect(result.confidence).toBe('low');
  });

  it('is confident about bookwork', () => {
    expect(classifyQuestionKind('ما هي البطالة؟').confidence).toBe('high');
  });

  it('reports the marker that decided it', () => {
    expect(classifyQuestionKind('Sujet : la liberté').signal).toBe('sujet :');
  });
});
