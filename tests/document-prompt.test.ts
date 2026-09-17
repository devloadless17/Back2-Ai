import { describe, expect, it } from 'vitest';

import { systemPrompt } from '@/lib/chat';

/**
 * When the tutor is told how a Lebanese document question is marked.
 *
 * The instruction is worth marks where it belongs and actively wrong where it
 * does not — a tutor that opens by announcing the type and source of a document
 * that was never supplied is inventing one. So both directions are pinned.
 */

// `signal` records what the classifier matched on. Irrelevant here — this is
// about the question text, not about how it was classified — but required.
const concept = { kind: 'concept', confidence: 'high', signal: 'test' } as const;
const comprehension = { kind: 'comprehension', confidence: 'high', signal: 'test' } as const;

const has = (prompt: string) => prompt.includes('scores the PRESENTATION of each document');

describe('questions that hand the candidate documents', () => {
  it('fires on the Arabic civics wording the barème itself uses', () => {
    const q = 'قدّم كلاً من المستندات: نوعه، مصدره وحدّد المسألة التي يتناولها.';
    expect(has(systemPrompt('concept_level', concept, 'ar', null, q))).toBe(true);
  });

  it('fires on the dual and plural forms, which the papers use constantly', () => {
    expect(has(systemPrompt('concept_level', concept, 'ar', null, 'استخرج من المستندين'))).toBe(true);
    expect(has(systemPrompt('concept_level', concept, 'ar', null, 'حلّل الوثائق الآتية'))).toBe(true);
    expect(has(systemPrompt('concept_level', concept, 'ar', null, 'اعتماداً على الوثيقة'))).toBe(true);
  });

  it('fires on the translated editions of the same exercise', () => {
    expect(has(systemPrompt('concept_level', concept, 'fr', null, 'Présentez le document 1.'))).toBe(true);
    expect(has(systemPrompt('concept_level', concept, 'en', null, 'Using the documents below…'))).toBe(true);
  });

  it('fires whatever the question was classified as', () => {
    // A document exercise reads as comprehension or as concept depending on
    // phrasing, and is marked the same way either way.
    const q = 'اعتماداً على المستندات، استخرج مقوّمات الوحدة الوطنيّة.';
    expect(has(systemPrompt('concept_level', concept, 'ar', null, q))).toBe(true);
    expect(has(systemPrompt('concept_level', comprehension, 'ar', null, q))).toBe(true);
  });
});

describe('questions that do not', () => {
  it('stays out of an ordinary concept question', () => {
    expect(has(systemPrompt('concept_level', concept, 'ar', null, 'ما معنى الاستعارة؟'))).toBe(false);
    expect(has(systemPrompt('concept_level', concept, 'fr', null, 'Quest-ce quune suite ?'))).toBe(false);
  });

  it('stays out when no question text is supplied at all', () => {
    // Rather than asserting an instruction about a document nobody has seen.
    expect(has(systemPrompt('concept_level', concept, 'ar'))).toBe(false);
  });

  it('does not fire on "documentation" or similar longer words', () => {
    // \\b…\\b on the Latin side: a word boundary, not a substring match.
    expect(has(systemPrompt('concept_level', concept, 'en', null, 'Read the documentation.'))).toBe(false);
  });
});

describe('it is added, never substituted', () => {
  it('keeps the hard rules that make every answer grounded', () => {
    const prompt = systemPrompt('concept_level', concept, 'ar', null, 'حلّل المستند الأوّل');
    expect(prompt).toContain('Answer ONLY from the material given below');
    expect(prompt).toContain('Do not invent formulas');
  });

  it('keeps the tier instruction alongside it', () => {
    const prompt = systemPrompt('exact_match', concept, 'ar', null, 'حلّل المستند الأوّل');
    expect(prompt).toContain('official question and its official solution');
    expect(has(prompt)).toBe(true);
  });
});

/**
 * Which language the tutor answers in.
 *
 * Reported from the live site: a student asked about an Arabic subject and was
 * answered in English. The old rule read the language off the student's MESSAGE,
 * which is right for "quels sont les mécanismes de l'évolution ?" and wrong for
 * "shu ya3ne el isti3ara" — Latin letters, Arabic subject, and an English answer
 * made of words the student cannot use in the paper they will sit.
 */
describe('the language an answer comes back in', () => {
  const says = (prompt: string, language: string) =>
    prompt.includes(`Reply in ${language}.`);

  it('answers in the subject language when a subject has been named', () => {
    const prompt = systemPrompt('concept_level', concept, 'en', 'ar', 'shu ya3ne el isti3ara');
    expect(says(prompt, 'Arabic')).toBe(true);
  });

  it('ignores the account language, which is chosen once and describes nothing', () => {
    // Account in English, revising a French-medium subject.
    const prompt = systemPrompt('concept_level', concept, 'en', 'fr', 'what is a limit');
    expect(says(prompt, 'French')).toBe(true);
    expect(says(prompt, 'English')).toBe(false);
  });

  it('says so explicitly, so Latin letters do not override it', () => {
    const prompt = systemPrompt('concept_level', concept, 'en', 'ar', 'kif be7seb el masaha');
    expect(prompt).toContain('even when they write to you in another language or in Latin letters');
  });

  it('falls back to the message language when no subject has been named', () => {
    // General help, and every conversation older than the subject picker.
    const prompt = systemPrompt('concept_level', concept, 'fr', null, 'hello');
    expect(prompt).toContain('Reply in the language the student wrote their message in');
  });
});
