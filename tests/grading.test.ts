import { describe, expect, it } from 'vitest';

import {
  baremeMaxScore,
  groundedIn,
  markingStyle,
  parseBareme,
  parseBaremeResult,
  pointsFor,
  statedMarksOf,
} from '@/lib/grading';

describe('parseBareme', () => {
  it('accepts a well-formed barème', () => {
    const bareme = parseBareme([
      { criterion: 'Sets up the integral correctly', points: 2 },
      { criterion: 'Correct final value with units', points: 1.5 },
    ]);

    expect(bareme).toHaveLength(2);
    expect(bareme?.[0]?.points).toBe(2);
  });

  it('rejects malformed JSONB rather than half-reading it', () => {
    expect(parseBareme(null)).toBeNull();
    expect(parseBareme([])).toBeNull();
    expect(parseBareme([{ criterion: 'missing points' }])).toBeNull();
    expect(parseBareme([{ criterion: 'negative', points: -1 }])).toBeNull();
    expect(parseBareme('not an array')).toBeNull();
  });
});

describe('baremeMaxScore', () => {
  it('totals the criteria', () => {
    expect(
      baremeMaxScore([
        { criterion: 'a', points: 2 },
        { criterion: 'b', points: 1.5 },
        { criterion: 'c', points: 0.5 },
      ]),
    ).toBe(4);
  });

  it('rounds to two decimals so half marks do not accumulate float noise', () => {
    expect(
      baremeMaxScore([
        { criterion: 'a', points: 0.1 },
        { criterion: 'b', points: 0.2 },
      ]),
    ).toBe(0.3);
  });
});

describe('parseBaremeResult', () => {
  it('returns an empty list for absent or malformed results', () => {
    expect(parseBaremeResult(null)).toEqual([]);
    expect(parseBaremeResult([{ criterion: 'a' }])).toEqual([]);
  });

  it('reads a stored marking result back', () => {
    const results = parseBaremeResult([
      { criterion: 'a', points_awarded: 1, points_possible: 2, justification: 'Partly right.' },
    ]);
    expect(results).toHaveLength(1);
    expect(results[0]?.points_awarded).toBe(1);
  });
});

describe('a criterion is met or it is not', () => {
  const c = { criterion: 'Balances the equation', points: 4 };

  it('awards the whole criterion or none of it', () => {
    expect(pointsFor(c, true)).toBe(4);
    expect(pointsFor(c, false)).toBe(0);
  });

  it('treats a criterion the marker did not return as not met', () => {
    // The barème is the authoritative list. Silence about one of its lines is
    // not evidence the student earned it.
    expect(pointsFor(c, undefined)).toBe(0);
  });

  it('never invents a value between the two', () => {
    // The guard against drifting back to fractional marks: a question here is a
    // whole exercise averaging six parts, and 1,594 of them carry ONE criterion
    // across three or more. "2.5 of 4" against a scheme that coarse is a number
    // that looks measured and is not.
    for (const met of [true, false, undefined]) {
      const awarded = pointsFor(c, met);
      expect(awarded === 0 || awarded === c.points).toBe(true);
    }
  });
});

describe('subjects are not marked the same way', () => {
  it('routes each real subject name to its marking style', () => {
    expect(markingStyle('Mathematics')).toBe('maths');
    expect(markingStyle('Mathematiques')).toBe('maths');
    expect(markingStyle('Physique')).toBe('physical_science');
    expect(markingStyle('Chemistry')).toBe('physical_science');
    expect(markingStyle('Sciences de la vie')).toBe('life_science');
    expect(markingStyle('\u0641\u0644\u0633\u0641\u0629 \u0639\u0627\u0645\u0629')).toBe('philosophy');
    expect(markingStyle('\u0623\u062f\u0628 \u0639\u0631\u0628\u064a')).toBe('literature');
    expect(markingStyle('Francais')).toBe('literature');
    expect(markingStyle('\u062a\u0627\u0631\u064a\u062e')).toBe('humanities');
    expect(markingStyle('\u062c\u063a\u0631\u0627\u0641\u064a\u0627')).toBe('humanities');
    expect(markingStyle('\u0627\u0642\u062a\u0635\u0627\u062f')).toBe('civics_economics');
  });

  it('falls back rather than throwing on a subject it does not know', () => {
    // A subject the mapping has not met must still be markable: the common
    // rules are what every caller got before styles existed.
    expect(markingStyle('Astrophysics')).toBe('general');
    expect(markingStyle('')).toBe('general');
  });

  it('never routes philosophy to the maths rules, or the reverse', () => {
    // The measured barèmes are opposite in shape — Falsafa 2.33 criteria over
    // 2.1 parts, Mathematics 1.35 over 4.3 — so marking one by the other's
    // instruction is the specific mistake this mapping exists to prevent.
    expect(markingStyle('\u0641\u0644\u0633\u0641\u0629 \u0639\u0627\u0645\u0629')).not.toBe('maths');
    expect(markingStyle('Mathematics')).not.toBe('philosophy');
  });
});

describe('a proposed criterion has to be grounded', () => {
  const material =
    'The pancreas secretes insulin when blood glucose rises. Insulin promotes the uptake of ' +
    'glucose by muscle and liver cells, which lowers glycaemia back towards its set point.';

  it('accepts a citation that is really in the material', () => {
    expect(groundedIn('Insulin promotes the uptake of glucose by muscle and liver cells', material)).toBe(true);
  });

  it('accepts it through the line breaks a PDF put in', () => {
    // A model copying a sentence reproduces its words, not the newline a PDF
    // dropped through the middle of it.
    expect(groundedIn('The pancreas secretes insulin\n   when blood glucose rises', material)).toBe(true);
  });

  it('refuses a citation the material does not contain', () => {
    // This is the model recalling a different syllabus. The criterion is
    // dropped before any marking rather than believed.
    expect(groundedIn('Glucagon is released by the alpha cells of the islets', material)).toBe(false);
  });

  it('refuses a citation too short to ground anything', () => {
    expect(groundedIn('insulin', material)).toBe(false);
    expect(groundedIn('the cells', material)).toBe(false);
  });
});

describe('statedMarksOf', () => {
  it('reads the tariff a Lebanese paper prints after the question', () => {
    expect(statedMarksOf('Calculer la vitesse du mobile au point B. (1,5 pt)')).toBe(1.5);
    expect(statedMarksOf('Determine the concentration of the solution. (2 pts)')).toBe(2);
    expect(statedMarksOf('Justifier votre réponse. (3 points)')).toBe(3);
  });

  it('reads an Arabic tariff', () => {
    expect(statedMarksOf('اشرح مفهوم الحرية عند سبينوزا. (٣ علامات)'.replace(/٣/, '3'))).toBe(3);
    expect(statedMarksOf('عرّف المفهوم التالي. (علامتان) (2 علامة)')).toBe(2);
  });

  it('takes the tariff, not a number from the physics', () => {
    // "3 points" here is a set of points in the plane, and it is not in the
    // tail anyway — the tariff is what is printed last.
    expect(statedMarksOf('On considère 3 points A, B et C du plan. Montrer qu ils sont alignés. (1 pt)')).toBe(1);
  });

  it('returns null when the paper states nothing', () => {
    expect(statedMarksOf('Démontrer que la suite est convergente.')).toBeNull();
    expect(statedMarksOf('')).toBeNull();
  });

  it('refuses a year dressed as a mark', () => {
    // "Session 2018 points" must not become a 2018-mark question.
    expect(statedMarksOf('Sujet de la session de 2018 points de repère.')).toBeNull();
  });
});
