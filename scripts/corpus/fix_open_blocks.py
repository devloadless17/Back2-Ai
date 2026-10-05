# -*- coding: utf-8 -*-
r"""
Display formulas whose multi-line block lost its line breaks and its end,
closed again.

    python scripts/corpus/fix_open_blocks.py <questions.jsonl> <fixes.json> [--subjects "..."]

attach_science_answers.py `tidy` took "\\" off every line end and dropped every
line that began with \end{...} as table markup. A key's aligned working
("$$\begin{aligned}" then one equation per line) lost both, so KaTeX refuses
the whole block and the page shows its source in red (Physique GS 2005-1
III.3, Chemistry LS 2004-1 I.1).

The block is closed where its formula lines stop: a line that is LaTeX
(commands, "=", "^", "_") belongs to it; the first that is not (a mark
"(1pt)", a new key row, a blank line) ends it. The lines get their "\\"
back and the block its "\end{aligned}$$". Only official_solution(_latex);
the same parts guard as fix_key_rows.py. Writes {id, column, before, after}
for load-text-fixes.ts; audit-rendered-text.tsx says whether each block
now draws.
"""
import argparse
import json
import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')

OPEN = re.compile(r'\$\$\s*\\begin\{(aligned|array|gathered|cases)\}(\{[^}]*\})?')
MATHY = re.compile(r'\\[a-zA-Z]+|[=^_]|\\\\')
ROW = re.compile(r'^(?:[A-Z]{1,3}\.)?\d+(?:\.\d+)*[a-z]?\s*(?:—|-|\)|\s)')


def mathy(line):
    t = line.strip()
    if not t or '$' in t or ROW.match(t):
        return False
    if re.fullmatch(r'\(?\s*\d+(?:[.,]\d+)?\s*(?:pt|pts|points?)?\s*\)?\.?', t, re.I):
        return False  # a mark
    return bool(MATHY.search(t))


def close_blocks(text):
    lines = text.split('\n')
    out = []
    i = 0
    while i < len(lines):
        line = lines[i]
        m = OPEN.search(line)
        if not m or '\\end{' in line[m.end():] or '$$' in line[m.end():]:
            out.append(line)
            i += 1
            continue
        env = m.group(1)
        # the block's own lines: after the opening, while they read as LaTeX
        body = []
        head_rest = line[m.end():].strip()
        j = i + 1
        while j < len(lines) and mathy(lines[j]) and '\\end{' not in lines[j]:
            body.append(lines[j].rstrip())
            j += 1
        if j < len(lines) and '\\end{' in lines[j]:
            out.append(line)  # it has an end after all
            i += 1
            continue
        rows = ([head_rest] if head_rest else []) + body
        if not rows:
            out.append(line)
            i += 1
            continue
        rows = [r[:-2].rstrip() if r.endswith('\\\\') else r for r in rows]
        # "$$" on lines of their own: the page's Markdown reads a "$$" fence
        # only there, and drops what follows an opening one.
        if line[:m.start()].strip():
            out.append(line[:m.start()].rstrip())
        out.append('$$')
        out.append(line[m.start() + 2:m.end()].strip())
        out.append(' \\\\\n'.join(rows))
        out.append(f'\\end{{{env}}}')
        out.append('$$')
        i = j
    return '\n'.join(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('questions')
    ap.add_argument('fixes')
    ap.add_argument('--subjects')
    args = ap.parse_args()
    subjects = set(args.subjects.split(',')) if args.subjects else None
    loaded = set()
    for path in sorted((Path(__file__).resolve().parents[2] / 'corpus' / '.mapping').glob('*parts.json')):
        for paper in json.load(open(path, encoding='utf-8')):
            for e in paper.get('exercises') or []:
                if e.get('wholeKey'):
                    loaded.add(e['wholeKey'])
    fixes = []
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
            after = close_blocks(before)
            if after != before:
                fixes.append({'id': r['id'], 'title': r['title'], 'column': column, 'before': before, 'after': after})
    json.dump(fixes, open(args.fixes, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(f"{len(fixes)} column(s) in {len({f['id'] for f in fixes})} question(s) -> {args.fixes}")


if __name__ == '__main__':
    main()
