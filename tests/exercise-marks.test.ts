import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..');

/**
 * A mark written as a fraction.
 *
 * `MARK` in `extract_exams.py` read a decimal or an Arabic-Indic digit and
 * nothing else. An exercise header only counts as a header if a mark follows
 * it, so "Deuxième exercice : (6 1/2 pts)" was not an exercise at all — and on
 * gs/2006 1/gs physics_fr 1.pdf that recovered one exercise of four and stored
 * the paper as worth 7 marks instead of 27.
 *
 * 77 of the 151 under-parsed MVP papers had their headings sitting in the text
 * unmatched, and this is the cause. Pinned here because it is a regex against
 * two thousand PDFs: the failure is silent, and the paper still parses — just
 * into a third of itself.
 */
function run(script: string, input: unknown): unknown {
  const out = execFileSync('python', ['-c', script], {
    cwd: ROOT,
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });
  return JSON.parse(out.trim().split('\n').pop()!);
}

const LOAD = [
  'import json, sys, importlib.util',
  'spec = importlib.util.spec_from_file_location("ex", "scripts/corpus/extract_exams.py")',
  'ex = importlib.util.module_from_spec(spec); spec.loader.exec_module(ex)',
].join('\n');

describe('to_number', () => {
  it('reads every way these papers write a mark', () => {
    const cases = ['7', '6 1⁄2', '7 1⁄2', '6½', '½', '6,5', '6.5', '٧', '1/2', '¼'];
    const got = run(
      [LOAD, 'cases = json.loads(sys.stdin.read())',
       'print(json.dumps([ex.to_number(c) for c in cases]))'].join('\n'),
      cases,
    ) as number[];

    expect(got[0]).toBe(7);
    expect(got[1]).toBe(6.5);   // "6 1/2" — the one that broke 77 papers
    expect(got[2]).toBe(7.5);
    expect(got[3]).toBe(6.5);   // "6½"
    expect(got[4]).toBe(0.5);   // bare "½"
    expect(got[5]).toBe(6.5);   // French decimal comma
    expect(got[6]).toBe(6.5);
    expect(got[7]).toBe(7);     // Arabic-Indic ٧
    expect(got[8]).toBe(0.5);
    expect(got[9]).toBe(0.25);
  });

  it('values something it cannot read as zero rather than guessing', () => {
    const got = run(
      [LOAD, 'cases = json.loads(sys.stdin.read())',
       'print(json.dumps([ex.to_number(c) for c in cases]))'].join('\n'),
      ['', 'pts', 'x', '--'],
    ) as number[];
    expect(got).toEqual([0, 0, 0, 0]);
  });
});

describe('the exercise header pattern', () => {
  it('matches a header whose mark is a mixed number', () => {
    const headers = [
      '\nPremier exercice : (7 pts)   Bobine',
      '\nDeuxième exercice :  (6 1⁄2 pts)   Noyaux atomiques',
      '\nQuatrième exercice : (7 1⁄2 pts)   Oscillations',
      '\nFirst Exercise (6½ points)  Kinematics',
    ];
    const got = run(
      [LOAD, 'cases = json.loads(sys.stdin.read())',
       'print(json.dumps([bool(ex.EXERCISE.search(c)) for c in cases]))'].join('\n'),
      headers,
    ) as boolean[];
    expect(got).toEqual([true, true, true, true]);
  });

  it('still does not treat a bare sentence as an exercise header', () => {
    // The widening must not turn prose into structure. A header is a header
    // because it carries a mark, and that has to stay true.
    const got = run(
      [LOAD, 'cases = json.loads(sys.stdin.read())',
       'print(json.dumps([bool(ex.EXERCISE.search(c)) for c in cases]))'].join('\n'),
      ['\nPremier exercice de la journée', '\nExercise the muscles', '\nDeuxième exercice'],
    ) as boolean[];
    expect(got).toEqual([false, false, false]);
  });
});

describe('Arabic exercise headings', () => {
  it('reads a heading whose space the font ate', () => {
    // Arabic shaping fonts join the noun to its ordinal and extraction never
    // puts the space back: "التمرينالثاني" for "التمرين الثاني". Requiring a
    // space meant those were not headings at all — gs/2016 1/phy_ar.pdf
    // recovered two exercises of four.
    const got = run(
      [LOAD, 'cases = json.loads(sys.stdin.read())',
       'print(json.dumps([bool(ex.EXERCISE.search(c)) for c in cases]))'].join('\n'),
      [
        '\nالتمرينالثاني (٥ علامات)',
        '\nالتمرين الثاني (٥ علامات)',
        '\nالتمرينالرابع (7 علامات)',
        '\nالتمرين 2 (4 علامات)',
      ],
    ) as boolean[];
    expect(got).toEqual([true, true, true, true]);
  });

  it('does not match a different word that merely starts the same way', () => {
    // "التمرينات" is "the exercises" — a plural noun in prose, not a heading.
    const got = run(
      [LOAD, 'cases = json.loads(sys.stdin.read())',
       'print(json.dumps([bool(ex.EXERCISE.search(c)) for c in cases]))'].join('\n'),
      ['\nالتمرينات المفيدة', '\nالتمرين مفيد جدا'],
    ) as boolean[];
    expect(got).toEqual([false, false]);
  });
});

/*
 * NOT TESTED HERE, BECAUSE IT WAS REVERTED.
 *
 * A fourth fix let a bare numeral header carry a mark spelled out in Arabic
 * words — "I) (علامتان ونصف العلامة", which is how gs/2015 2/math_ar.pdf heads
 * all five of its exercises. It worked on its targets (three papers went 1->4,
 * 1->4 and 3->6 exercises) and cost eleven exercises on papers it had no
 * business touching: gs/2016 2/falsafe.pdf lost seven, and philosophy papers
 * across three sessions lost one each.
 *
 * The cause is ordering, not the pattern. `find_headers` tries EXERCISE_BARE
 * BEFORE the subject and part paths, so widening it does not merely match more
 * headers — it CAPTURES papers that should have fallen through to a different
 * reader entirely. A philosophy paper offering a choice of subjects became a
 * bare-numeral paper and stopped being parsed as what it is.
 *
 * Narrowing the pattern to require a dual or counted plural took the loss from
 * fifteen to eleven and did not remove it. Anyone retrying this should change
 * the ORDER or gate the Arabic branch on the paper already looking like a maths
 * paper — not widen the pattern further — and should measure it with
 * `compare_extract.py --limit 0`, because a sample does not contain enough
 * philosophy papers to show the damage.
 */
