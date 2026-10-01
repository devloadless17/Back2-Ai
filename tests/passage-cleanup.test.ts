import { describe, expect, it } from 'vitest';

import {
  arabicFurnitureLines,
  arabicHeaderLines,
  cleanPassage,
  cleanQuestionText,
  stripTrailingMinistryText,
  collapseBlankRuns,
  gutterLines,
} from '../scripts/corpus/passage-cleanup';

/*
 * These passages are what a student reads before answering. Removing something
 * the author wrote is worse than leaving the paper's furniture in, so every rule
 * here is written to refuse when it is not sure, and the cases it must refuse
 * are pinned alongside the ones it must clean.
 */

const REAL_FRENCH_PASSAGE = [
  'المدّة : ساعتان ',
  '',
  'Une génération sans père',
  '         Jacques Duquesne, journaliste et auteur de nombreux essais, préside',
  "qui dirige l'ensemble du groupe de presse « Ouest-France ».",
  '',
  '',
  '',
  '5',
  '',
  '',
  '',
  '10',
  '',
  '',
  '15',
  "       Quand on a connu tout et le contraire de tout, on est tenté de ne rien lui dire.",
].join('\n');

describe('the line-number gutter the paper prints down the margin', () => {
  it('takes a rising run of bare numbers', () => {
    const marks = gutterLines(REAL_FRENCH_PASSAGE);
    expect(marks.size).toBe(3);
  });

  it('leaves a lone number alone, because it may be the passage', () => {
    // A passage that prints a number on its own line — a date, a count, a verse
    // number — has no gutter, and taking it would delete the author's text.
    expect(gutterLines('Il partit.\n\n1962\n\nIl ne revint jamais.').size).toBe(0);
  });

  it('leaves two numbers alone', () => {
    expect(gutterLines('a\n5\nb\n10\nc').size).toBe(0);
  });

  it('does not join two separate runs across a reset', () => {
    // The gutter only ever counts upward. A drop means a new run began, and
    // neither half reaches three on its own.
    expect(gutterLines('5\n10\n1\n5').size).toBe(0);
  });
});

describe('the ministry cover line at the top of a French passage', () => {
  it('removes the Arabic duration from a Latin passage', () => {
    expect(arabicHeaderLines(REAL_FRENCH_PASSAGE)).toBe(1);
  });

  it('never touches an Arabic passage', () => {
    // THE RULE THAT PROTECTS THE ARABIC SUBJECTS. Stripping leading Arabic from
    // a passage that IS Arabic would delete its opening paragraph.
    const arabic = 'المدّة : ساعتان\n\nقال الكاتب إن الحياة رحلة طويلة.\nوفي ذلك عبرة.';
    expect(arabicHeaderLines(arabic)).toBe(0);
    expect(cleanPassage(arabic)).toBe(arabic.trim());
  });

  it('stops at the first line of the passage itself', () => {
    const text = 'المدّة : ساعتان\nUne génération sans père\nالمدّة : ساعتان';
    expect(arabicHeaderLines(text)).toBe(1);
  });
});

describe('the cover page sitting in the middle of a question', () => {
  // Taken from a French paper as it is stored: the passage's footnote glossary,
  // then the ministry cover lines the reader met partway through, then the
  // questions themselves.
  const QUESTION = [
    'émergence : apparition 2– duplication : reproduction, copie',
    '4– virulent : violent 5– abus : usage mauvais, excessif ou injuste.',
    'اللغة الفرنسية',
    'المدة: ساعتان ونصف',
    'الرقم:',
    '',
    'I- Questions (13 pts)',
    '1– a. Vous appuyant sur un champ lexical prédominant...',
  ].join('\n');

  it('takes the cover lines out from wherever they sit', () => {
    const cleaned = cleanQuestionText(QUESTION);
    expect(cleaned).not.toContain('اللغة الفرنسية');
    expect(cleaned).not.toContain('الرقم:');
    expect(cleaned).toContain('I- Questions (13 pts)');
    expect(cleaned).toContain('émergence : apparition');
    expect(cleaned).toContain('Vous appuyant sur un champ lexical');
  });

  it('leaves an Arabic question completely alone', () => {
    // THE GUARD THAT MATTERS MOST. Every line of an Arabic paper is Arabic, so a
    // rule that strips Arabic lines would delete the whole question.
    const arabic = 'المدة: ساعتان\nالرقم:\n\nأولاً: أجب عن الأسئلة الآتية.\n١- ما هو تعريف الدولة؟';
    expect(arabicFurnitureLines(arabic).size).toBe(0);
    expect(cleanQuestionText(arabic)).toBe(arabic);
  });

  it('does not touch a question that has no Arabic in it', () => {
    const clean = 'I- Questions (13 pts)\n1– a. Precisez le theme du texte.';
    expect(cleanQuestionText(clean)).toBe(clean);
  });

  it('keeps a bare number in a question, unlike in a passage', () => {
    // A lone number inside a question is a mark, an answer or a table row. Only a
    // printed passage has a margin gutter.
    const withNumbers = 'Compute the following.\n\n5\n\n10\n\n15\n\nGive the result.';
    expect(cleanQuestionText(withNumbers)).toBe(withNumbers);
  });
});

describe('cleaning a passage end to end', () => {
  it('leaves the author’s words exactly as they were', () => {
    const cleaned = cleanPassage(REAL_FRENCH_PASSAGE);
    expect(cleaned).toContain('Une génération sans père');
    expect(cleaned).toContain('Quand on a connu tout et le contraire de tout');
    expect(cleaned).not.toContain('المدّة');
    expect(cleaned).not.toMatch(/^\s*\d+\s*$/m);
  });

  it('collapses the blank space the layout left behind', () => {
    expect(collapseBlankRuns('a\n\n\n\n\nb')).toBe('a\n\nb');
    expect(collapseBlankRuns('a   \nb\t\n')).toBe('a\nb');
  });

  it('keeps the original rather than returning an empty passage', () => {
    // A passage that is nothing but a gutter would clean away to nothing, and a
    // damaged passage is worth more to a student than none at all.
    const onlyGutter = '1\n\n5\n\n10\n\n15';
    expect(cleanPassage(onlyGutter)).toBe(onlyGutter);
  });

  it('does nothing to a passage that was read correctly', () => {
    const good = 'Une génération sans père\n\nJacques Duquesne écrit que les jeunes sont perdus.';
    expect(cleanPassage(good)).toBe(good);
  });
});

describe('the full stop a footnote marker pushed onto its own line', () => {
  it('puts it back on the sentence it belongs to', () => {
    // A superscript sits on its own baseline, so the reader ends the line at the
    // marker and the sentence's full stop opens the next one.
    expect(collapseBlankRuns('…discipline amoindrissante1\n.\nLe caractère')).toBe(
      '…discipline amoindrissante1.\nLe caractère',
    );
  });

  it('leaves a line that has words on it alone', () => {
    expect(collapseBlankRuns('a\n. Mais il revint')).toBe('a\n. Mais il revint');
  });

  it('does not attach punctuation to a blank line', () => {
    expect(collapseBlankRuns('a\n\n.')).toBe('a\n\n.');
  });
});

describe('a full stop stranded at the start of the next line', () => {
  it('moves it up when a footnote marker ended the line above', () => {
    expect(collapseBlankRuns('ne pas les contraindre2\n. C’est faux. Respecter')).toBe(
      'ne pas les contraindre2.\nC’est faux. Respecter',
    );
  });

  it('leaves an ellipsis that genuinely opens a line', () => {
    // No footnote marker above it, so the dots belong where they are.
    const quoted = 'Il répondit :\n… et pourtant elle tourne.';
    expect(collapseBlankRuns(quoted)).toBe(quoted);
  });

  it('leaves punctuation alone after an ordinary word', () => {
    const text = 'Il partit\n, dit-elle';
    expect(collapseBlankRuns(text)).toBe(text);
  });
});

describe('the cover page run onto the end of a Latin line', () => {
  it('takes the ministry text off a French heading', () => {
    const line = 'Énergie électrique produite par un réacteur nucléaire وزارة التربية والتعليم العالي';
    expect(stripTrailingMinistryText(line)).toBe('Énergie électrique produite par un réacteur nucléaire');
  });

  it('LEAVES Arabic that is the question itself, however mangled', () => {
    // THE RULE THAT KEEPS THIS SAFE. Of 75 mixed lines only 2 are the cover
    // page; the rest are Arabic questions whose encoding was destroyed on the
    // way in. "ثى اسرُرج أٌّ" is "then deduce that" — the question, not
    // furniture — and it matches none of the ministry's words precisely because
    // mangling is what broke those letters.
    const line = 'z2 ثى اسرُرج أٌّ';
    expect(stripTrailingMinistryText(line)).toBe(line);
  });

  it('leaves a line that is entirely Arabic to the line rule', () => {
    const line = 'وزارة التربية والتعليم العالي';
    expect(stripTrailingMinistryText(line)).toBe(line);
  });

  it('leaves a line with no Arabic untouched', () => {
    expect(stripTrailingMinistryText('Exercice 1 (7 points)')).toBe('Exercice 1 (7 points)');
  });
});
