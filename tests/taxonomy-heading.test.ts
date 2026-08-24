/*
 * The heading test in scripts/corpus/taxonomy.py, pinned to the exact lines
 * that broke it.
 *
 * `is_heading` decides which occurrence of a chapter title is the chapter and
 * which is a passing mention, and both of its failure modes were regressions
 * that read as improvements: accepting a bullet put the Alcohols chapter six
 * pages before its own heading, and accepting any line start moved a falsafa
 * lesson onto an extract inside itself. Neither showed up in the parser's
 * summary — both books still reported every chapter placed.
 *
 * The cases below are copied from the corpus, not invented. Kept as a test
 * rather than a comment because the rule is one regex and the next person to
 * widen it will have exactly the reasons this file exists to refuse.
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..');

/** Real lines, with the offset of the title inside each. */
const CASES: { line: string; title: string; heading: boolean; why: string }[] = [
  {
    line: '## ALCOHOLS',
    title: 'ALCOHOLS',
    heading: true,
    why: 'chemistry page 206 — the real chapter opening',
  },
  {
    line: '### 9.1 Alcohols',
    title: 'Alcohols',
    heading: true,
    why: 'numbered markdown heading',
  },
  {
    line: '\\section*{ALCOHOLS}',
    title: 'ALCOHOLS',
    heading: true,
    why: 'the LaTeX form, before normalisation rewrites it',
  },
  {
    line: '- Alcohols, aldehydes, ketones and carboxylic acids',
    title: 'Alcohols',
    heading: false,
    why: 'chemistry page 200 — a bullet in the PREVIOUS chapter, six pages early',
  },
  {
    line: '- The hydroxyl group -OH characterizes the alcohols.',
    title: 'alcohols',
    heading: false,
    why: 'chemistry page 202 — prose inside a bullet',
  },
  {
    line: '| Alcohols | R - OH | - OH |',
    title: 'Alcohols',
    heading: false,
    why: 'chemistry page 203 — a table row',
  },
  {
    line: '١ - الحاجات والدوافع',
    title: 'الحاجات والدوافع',
    heading: false,
    why: 'falsafa page 21 — a numbered line on a unit divider, not a heading',
  },
  {
    line: 'الحاجات والدوافع',
    title: 'الحاجات والدوافع',
    heading: false,
    why: 'falsafa page 23 — the "نص" extract; a bare line is not typography',
  },
  {
    line: 'إن الحاجات والدوافع هي قوى دينامية محركة',
    title: 'الحاجات والدوافع',
    heading: false,
    why: 'falsafa page 18 — mid-sentence',
  },
];

describe('taxonomy.is_heading', () => {
  it('separates a typeset heading from a bullet, a table row and prose', () => {
    const probe = CASES.map((c) => ({ line: c.line, pos: c.line.indexOf(c.title) }));
    expect(probe.every((p) => p.pos >= 0)).toBe(true);

    const script = [
      'import json, sys',
      'sys.path.insert(0, r"scripts/corpus")',
      'from taxonomy import is_heading',
      'cases = json.loads(sys.stdin.read())',
      'print(json.dumps([is_heading(c["line"], c["pos"]) for c in cases]))',
    ].join('\n');

    const out = execFileSync('python', ['-c', script], {
      cwd: ROOT,
      input: JSON.stringify(probe),
      encoding: 'utf8',
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });

    const got = JSON.parse(out.trim().split('\n').pop()!) as boolean[];
    const wrong = CASES.map((c, i) => ({ ...c, got: got[i] })).filter((c) => c.got !== c.heading);
    expect(wrong.map((w) => `${w.why}: expected ${w.heading}, got ${w.got}`)).toEqual([]);
  });
});
