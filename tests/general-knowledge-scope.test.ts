import { describe, expect, it } from 'vitest';

import { generalKnowledgePrompt } from '../src/lib/chat';
import type { SyllabusScope } from '../src/lib/retrieval';

const HISTORY: SyllabusScope = {
  subject: 'تاريخ',
  chapters: ['الحرب العالمية الأولى', 'الانتداب الفرنسي', 'الاستقلال', 'الحرب اللبنانية'],
  examples: ['حدّد أسباب قيام الحرب اللبنانية سنة 1975 مستنداً إلى المستند رقم 1.'],
};

describe('generalKnowledgePrompt — curriculum constraint', () => {
  it('names the syllabus and lists its chapters', () => {
    const prompt = generalKnowledgePrompt(['تاريخ', 'جغرافيا'], 'ar', HISTORY);
    expect(prompt).toContain('تاريخ');
    for (const chapter of HISTORY.chapters) expect(prompt).toContain(chapter);
  });

  it('tells the model to answer within the list and to name the chapter', () => {
    const prompt = generalKnowledgePrompt(['تاريخ'], 'en', HISTORY);
    expect(prompt).toMatch(/WITHIN the scope of that list/);
    expect(prompt).toMatch(/Name the chapter/);
  });

  it('requires an out-of-scope question to be refused rather than guessed at', () => {
    const prompt = generalKnowledgePrompt(['تاريخ'], 'en', HISTORY);
    expect(prompt).toMatch(/not covered by any chapter above/);
  });

  it('forbids the chapter list being quoted or cited as source material', () => {
    // The whole reason titles are safe to hand over on an unverified path is
    // that they cannot become evidence. If the model may cite them, they can.
    const prompt = generalKnowledgePrompt(['تاريخ'], 'en', HISTORY);
    expect(prompt).toMatch(/Never quote it, cite it/);
    expect(prompt).toMatch(/not source material/);
  });

  it('marks past questions as calibration only, never as material', () => {
    const prompt = generalKnowledgePrompt(['تاريخ'], 'en', HISTORY);
    expect(prompt).toContain(HISTORY.examples[0]!);
    expect(prompt).toMatch(/questions, not answers/);
  });

  it('keeps every existing hard limit when a syllabus is supplied', () => {
    // The syllabus block must ADD a constraint, never relax the ones that stop
    // this path claiming to have seen the student's book.
    const prompt = generalKnowledgePrompt(['تاريخ'], 'en', HISTORY);
    expect(prompt).toMatch(/Never say "your textbook says"/);
    expect(prompt).toMatch(/Never state a bareme/);
  });

  it('still works, unconstrained, when retrieval could not name a syllabus', () => {
    const prompt = generalKnowledgePrompt(['تاريخ'], 'en', null);
    expect(prompt).not.toMatch(/THE SYLLABUS THIS BELONGS TO/);
    expect(prompt).toMatch(/Never say "your textbook says"/);
  });

  it('omits the examples block rather than printing an empty heading', () => {
    const prompt = generalKnowledgePrompt(['تاريخ'], 'en', { ...HISTORY, examples: [] });
    expect(prompt).toMatch(/THE SYLLABUS THIS BELONGS TO/);
    expect(prompt).not.toMatch(/How this syllabus actually examines/);
  });
});
