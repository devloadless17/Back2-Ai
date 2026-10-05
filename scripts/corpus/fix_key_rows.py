# -*- coding: utf-8 -*-
r"""
Marking-key rows printed with their label twice, made readable.

    python scripts/corpus/fix_key_rows.py <questions.jsonl> <fixes.json> [--subjects "Life Sciences,Sciences de la vie"]

attach_science_answers.py joined each key table row's cells with " — ", and
the tables give a question number column and a label column side by side. So
the page prints "2 2 — Nicotine stimulates … — (1 pt)", "1 1.1 — We call …",
and, where the answer cell held a list, "2 2 &" over the list with the mark
alone on its last line ("0.75"). Life Sciences SE 2021-2, LH 2021-2.

Each row gets one label: the same label twice is one ("2 2" -> "2"), a
number and its own sub-label is the sub-label ("1 1.1" -> "1.1"). Two labels
that differ otherwise ("1.2 2") are left as printed: which one is right is a
guess. A row the key prints twice (same label, same words) is printed once. In a
list answer the "&" goes and the lone mark becomes "— (0.75 pt)".

Left alone: a question whose parts carry answers, or whose solution is a
parts file's wholeKey. load-paper-parts.ts writes those solutions and would
put the old text back. A question with unanswered parts and no wholeKey keeps
the solution it had, so it is fixed like the rest (Life Sciences LH 2011-2).

Writes one fix per changed column: {id, source_ref, title, column, before,
after}. load-text-fixes.ts applies them, only where the stored text is still
`before`.
"""
import argparse
import json
import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')

LABEL = r'\d+(?:\.\d+)*[a-z]?'
MULTIROW = re.compile(r'\\multi(?:row|column)(?:\[[^\]]*\])?\{[^}]*\}\{[^}]*\}\{([^}]*)\}')
ROW = re.compile(rf'^(?P<a>{LABEL})\s+(?P<b>{LABEL})\s*(?P<sep>—|&)\s*(?P<rest>.*)$')
MARK = re.compile(r'^\s*(\d+(?:[.,]\d+)?|\d+/\d+)\s*$')


def one_label(a, b):
    if a == b:
        return a
    if b.startswith(a) and (b[len(a):len(a) + 1] in ('.', '') or b[len(a):].isalpha()):
        return b
    return None


def tidy(text):
    lines = text.split('\n')
    out = []
    in_list = False
    last_row = None
    i = 0
    while i < len(lines):
        line = MULTIROW.sub(r'\1', lines[i])
        m = ROW.match(line.strip())
        label = one_label(m.group('a'), m.group('b')) if m else None
        if m and label:
            rest = m.group('rest').strip()
            if m.group('sep') == '&':
                in_list = True
                rest = rest.rstrip('&').strip()
                # the list's first line joins its label
                if not rest and i + 1 < len(lines) and lines[i + 1].strip() and not ROW.match(lines[i + 1].strip()):
                    i += 1
                    rest = lines[i].strip()
            else:
                in_list = False
            row = f'{label} — {rest}' if rest else f'{label} —'
            if row == last_row or row in (o.strip() for o in out):
                # the same row again: drop it and the blank before it
                while out and not out[-1].strip():
                    out.pop()
                i += 1
                continue
            last_row = row
            out.append(row)
            i += 1
            continue
        if in_list and MARK.match(line):
            nxt = lines[i + 1].strip() if i + 1 < len(lines) else ''
            if not nxt or ROW.match(nxt):
                k = len(out) - 1
                while k >= 0 and not out[k].strip():
                    k -= 1
                if k >= 0:
                    mark = MARK.match(line).group(1)
                    out[k] = f'{out[k].rstrip()} — ({mark} pt)'
                    in_list = False
                    i += 1
                    continue
        if not line.strip():
            in_list = in_list and i + 1 < len(lines) and not ROW.match(lines[i + 1].strip())
        out.append(lines[i])
        i += 1
    return '\n'.join(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('questions')
    ap.add_argument('fixes')
    ap.add_argument('--subjects', help='comma-separated subject names; default all')
    args = ap.parse_args()
    subjects = set(args.subjects.split(',')) if args.subjects else None
    fixes = []
    touched = set()
    loaded = set()  # solutions load-paper-parts.ts writes from a parts file
    for path in sorted((Path(__file__).resolve().parents[2] / 'corpus' / '.mapping').glob('*parts.json')):
        for paper in json.load(open(path, encoding='utf-8')):
            for e in paper.get('exercises') or []:
                if e.get('wholeKey'):
                    loaded.add(e['wholeKey'])
    for line in open(args.questions, encoding='utf-8'):
        r = json.loads(line)
        if subjects and r['subject'] not in subjects:
            continue
        pp = r.get('paper_parts')
        if pp and any(p.get('answer') or p.get('answerImage') for p in pp.get('parts') or []):
            continue
        if (r.get('official_solution') or '') in loaded:
            continue
        for column in ('official_solution', 'official_solution_latex'):
            before = r.get(column)
            if not before:
                continue
            after = tidy(before)
            if after != before:
                fixes.append({'id': r['id'], 'source_ref': r.get('source_ref'), 'title': r['title'],
                              'column': column, 'before': before, 'after': after})
                touched.add(r['id'])
    json.dump(fixes, open(args.fixes, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(f'{len(fixes)} column(s) in {len(touched)} question(s) -> {args.fixes}')


if __name__ == '__main__':
    main()
