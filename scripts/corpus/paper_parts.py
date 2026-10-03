# -*- coding: utf-8 -*-
"""
Each exercise of a science paper as its printed parts, each part with its own
official answer and marks.

    python scripts/corpus/paper_parts.py                       # GS, writes corpus/.mapping/paper-parts.json
    python scripts/corpus/paper_parts.py --track ls
    python scripts/corpus/paper_parts.py --show "gs/2019/phy_en.pdf" 2

WHY. A paper was stored one row per exercise: the whole statement as one
block, and ONE answer for it, read from the scheme pages' text layer. That
layer interleaves the scheme's three columns with the answer's own maths, so
the stored answer was scraps — gs/2019/phy_en.pdf exercise 2 held
"0.25 C ) = 0 , so , then Lω = LC" under "Redraw the circuit". A student saw
a thirteen-part exercise with no parts and an answer that matched none of them.

Mathpix read the same scheme pages as images, and wrote each one back as a
table: part, answer (real LaTeX), marks. This reads those tables and binds
each row to its part BY LABEL, never by position.

WHAT DECIDES WHAT.
  - Exercise boundaries and part labels: extract_exams.py (exams.json). The
    label list is the canonical structure; nothing here invents a part.
  - Part text: the exercise's Mathpix Markdown from display_text.py, cut at
    each part's first words. Only exercises display_text.py accepted.
  - Answers and marks: the scheme table's rows, matched to parts by label.

WHAT IS REFUSED, not guessed. An exercise keeps its old single block when:
  - a part cannot be found in the Markdown, or is found out of order;
and keeps its parts but gets NO answers when:
  - a scheme row names a label no part has (an orphan);
  - rows bind to parts out of printed order;
  - the rows' marks do not add up to what the exercise header states.
The marks check is the one that catches a misread table: a dropped row, a
mark read into the answer cell, two rows merged, each moves the sum.

Free: reads only what is already on disk. Arabic editions are never read.
"""
import argparse
import collections
import json
import re
import sys
from fractions import Fraction
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, str(Path(__file__).parent))

from display_text import find_tabular, replace_command, split_top, to_markdown  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
EXAMS = ROOT / 'corpus' / 'exams.json'
DISPLAY = ROOT / 'corpus' / '.mapping' / 'display-text.json'
META = ROOT / 'corpus' / 'meta'
OUT = ROOT / 'corpus' / '.mapping' / 'paper-parts.json'

ARABIC = re.compile(r'[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF]')
# The adapted papers set for candidates with special needs. They are separate
# exams with their own exercises, and the product does not show them.
ADAPTED = re.compile(r'ehteyejet|makf', re.I)
ARABIC_EDITION = re.compile(r'(_ar\b|_ar[._]|arab|_dr\.pdf)', re.I)


def subject_of(file):
    f = file.lower()
    if 'phy' in f:
        return 'physics'
    if 'chem' in f or 'chim' in f:
        return 'chemistry'
    if 'math' in f:
        return 'maths'
    return None


# --------------------------------------------------------------------------
# Labels
# --------------------------------------------------------------------------

# Mathpix sometimes reads a label in Cyrillic look-alikes: "В.З.a" is B.3.a.
CYRILLIC = str.maketrans('АВСЕНІКМОРТХЗаеосрх', 'ABCEHIKMOPTX3aeocpx')


def label_tokens(label):
    """'2-1)', '2.1', 'A. 3 a', 'II.1', '3a' -> comparable token tuples."""
    s = re.sub(r'\$|\\mathbf|\\mathrm|\\text|[{}]', ' ', (label or '').translate(CYRILLIC)).upper()
    return tuple(re.findall(r'\d+|[IVX]+(?![A-Z])|[A-Z]', s))


def join_label_cells(cells):
    """Label columns read left to right: '1' then '1-1' is 1.1, not 1.1.1.

    A later cell usually repeats its parent ("2" | "2-1" | "2-1-1"); where the
    hyphens were lost ("2-11" under "2-1") the digits still agree.
    """
    acc = ()
    for cell in cells:
        toks = label_tokens(cell)
        if not toks:
            continue
        if acc and len(toks) > len(acc) and toks[:len(acc)] == acc:
            acc = toks  # the cell repeats its parent: "2" | "2-1"
        elif acc and all(t.isdigit() for t in acc + toks) and ''.join(toks).startswith(''.join(acc)) \
                and len(''.join(toks)) > len(''.join(acc)):
            acc = acc + tuple(''.join(toks)[len(''.join(acc)):])
        else:
            acc = acc + toks
    return acc


def roman(s):
    vals = {'I': 1, 'V': 5, 'X': 10}
    total = 0
    for a, b in zip(s, s[1:] + ' '):
        v = vals[a]
        total += -v if b in vals and vals[b] > v else v
    return total


ORDINALS = {
    'first': 1, 'second': 2, 'third': 3, 'fourth': 4, 'fifth': 5, 'sixth': 6,
    'premier': 1, 'première': 1, 'premiere': 1, 'deuxième': 2, 'deuxieme': 2, 'second': 2, 'seconde': 2,
    'troisième': 3, 'troisieme': 3, 'quatrième': 4, 'quatrieme': 4, 'cinquième': 5, 'cinquieme': 5,
    'sixième': 6, 'sixieme': 6,
}
# A scheme printed for two tracks heads each track's version of an exercise
# with its tag: "Deuxième exercice (6 points) (S.V)" is the Life Sciences one.
TRACK_TAGS = {
    'gs': re.compile(r'\(\s*(?:S\.?\s*G|G\.?\s*S)\.?\s*\)|\bsciences?\s+g[ée]n[ée]rales?\b|\bgeneral\s+sciences?\b', re.I),
    'ls': re.compile(r'\(\s*(?:S\.?\s*V|L\.?\s*S)\.?\s*\)|\bsciences?\s+de\s+la\s+vie\b|\blife\s+sciences?\b', re.I),
}


def other_track(text, track):
    return any(rx.search(text) for t, rx in TRACK_TAGS.items() if t != track) \
        and not (track in TRACK_TAGS and TRACK_TAGS[track].search(text))


EX_NUMBERED = re.compile(r'\b(?:exercise|exercice)\s*(?:n\s*[°o]\s*)?(\d+|[IVX]+)\b', re.I)
EX_ORDINAL = re.compile(r'\b(' + '|'.join(sorted(ORDINALS, key=len, reverse=True)) + r')\s+(?:exercise|exercice)\b', re.I)
POINTS = re.compile(r'\(\s*(\d+(?:[.,]\d+)?)\s*(?:points?|pts?)\s*\)', re.I)


def exercise_heading(text):
    """'Exercise 2 (8 points)', 'Second exercise (7.5 points)' -> 2, else None.

    Only at the start of the text: an answer that says "as in exercise 1" is
    not a heading.
    """
    t = re.sub(r'\\[a-zA-Z]+|[{}$*#]', ' ', text).strip()
    m = EX_NUMBERED.match(t)
    if m:
        v = m.group(1)
        return int(v) if v.isdigit() else roman(v.upper())
    m = EX_ORDINAL.match(t)
    if m:
        return ORDINALS[m.group(1).lower()]
    return None


# --------------------------------------------------------------------------
# Marks
# --------------------------------------------------------------------------

VULGAR = {'½': Fraction(1, 2), '¼': Fraction(1, 4), '¾': Fraction(3, 4)}


MARK_TERM = re.compile(r'(\d+)\s*/\s*(\d+)|(\d+(?:\.\d+)?)|([½¼¾])')


def parse_mark(cell):
    """A mark cell: '0.25', '1,5', '½', '1 ½', '\\frac{1}{2}', '0.5 + 0.5'. None if it is not one.

    A cell holding several marks stacked one per line ("¼ ¼", "\\frac14
    \\frac12") awards their sum: the scheme splits one part's marks over the
    lines of its answer.
    """
    s = re.sub(r'\\(?:mathbf|mathrm|text|textbf|left|right)\b|[{}$]|\\[,;:!]', ' ', cell or '')
    s = re.sub(r'\\[dt]?frac\s*(\d+)\s*(\d+)', r' \1/\2 ', s)
    s = s.replace(',', '.')
    s = re.sub(r'\b(?:pts?|points?)\b', ' ', s, flags=re.I)
    if not s.strip() or re.sub(r'[\d./½¼¾+\s]', '', s):
        return None
    total = Fraction(0)
    for m in MARK_TERM.finditer(s):
        if m.group(1):
            if int(m.group(2)) not in (2, 3, 4, 8):
                return None
            total += Fraction(int(m.group(1)), int(m.group(2)))
        elif m.group(3):
            total += Fraction(m.group(3))
        else:
            total += VULGAR[m.group(4)]
    return float(total) if 0 < total <= 10 else None


# --------------------------------------------------------------------------
# The scheme as a sequence of rows
# --------------------------------------------------------------------------

ANSWER_HEAD = re.compile(
    r'^(?:expected\s+)?answers?$|^short\s+answers?$|^(?:expected\s+)?answers?\s+expected$|^réponses?(?:\s+attendues?)?$'
    r'|^corrigé$|^éléments\s+de\s+réponses?$|^eléments\s+des?\s+réponses?$|^réponse\s+attendue$|^solutions?$',
    re.I)
MARK_HEAD = re.compile(r'^(?:marks?|m|g|n|notes?|pts?|points?|barème|grades?)$', re.I)
# The label cell of a maths header names the exercise: "QI | Solution | G".
# Upper-case numerals only: a lone "ii" or "v" is a sub-part label.
HEADER_EXERCISE = re.compile(r'^(?:[Qq](?:uestion|UESTION)?|[Ee]x(?:ercise|ercice)?)?\s*[-._]?\s*([IVX]{1,4}|\d)$')
LABEL_HEAD = re.compile(r'^(?:part(?:ie)?(?:\s+(?:of\s+the|de\s+la)\s+q\.?)?|q\.?|questions?|n°)$', re.I)
COMMENT_HEAD = re.compile(r'^(?:comments?|commentaires?|remarques?)$', re.I)

FIGURE = re.compile(r'!\[[^\]]*\]\((https://cdn\.mathpix\.com/cropped/[^)\s]+)\)')


def plain(cell):
    """A header or label cell as plain text."""
    s = replace_command(cell, 'multicolumn', lambda a: a[2], nargs=3)
    s = replace_command(s, 'multirow', lambda a: a[2], nargs=3)
    s = re.sub(r'\\(?:hline|cline\{[^}]*\})', ' ', s)
    s = re.sub(r'\\(?:mathbf|mathrm|text|textbf|mathit)\b', ' ', s)
    s = re.sub(r'[{}$]|\\[,;:!]', ' ', s)
    return re.sub(r'\s+', ' ', s).strip()


def flatten_nested(body):
    """Tabulars inside a cell become lines, so the outer table splits cleanly."""
    while True:
        spans = []
        pos = 0
        while True:
            t = find_tabular(body, pos)
            if not t:
                break
            spans.append(t)
            pos = t[3]
        if not spans:
            return body
        out = []
        pos = 0
        for b, bs, be, e in spans:
            inner = body[bs:be]
            n = find_tabular(inner)
            while n:  # innermost first
                inner = inner[:n[0]] + flatten_lines(inner[n[1]:n[2]]) + inner[n[3]:]
                n = find_tabular(inner)
            out.append(body[pos:b])
            out.append(flatten_lines(inner))
            pos = e
        out.append(body[pos:])
        body = ''.join(out)


def flatten_lines(inner):
    rows = []
    for r in split_top(inner, '\\\\'):
        r = re.sub(r'\\hline|\\cline\{[^}]*\}', ' ', r)
        cells = [c.strip() for c in split_top(r, '&')]
        line = ' '.join(c for c in cells if c)
        if line.strip():
            rows.append(line.strip())
    return '\n'.join(rows)


def table_rows(body):
    """Grid of (text, inherited) cells, with \\multicolumn expanded and \\multirow carried down."""
    # Only the top-level table's rows: nested ones are flattened first, and the
    # outer body is split on its own row breaks.
    grid = []
    carry = {}  # column -> [value, rows remaining]
    for raw in split_top(body, '\\\\'):
        raw = re.sub(r'^\s*(?:\\hline|\\cline\{[^}]*\}|\s)+', '', raw)
        if not re.sub(r'\\hline|\\cline\{[^}]*\}|\s', '', raw):
            continue
        cells = []
        for c in split_top(raw, '&'):
            span = [1]

            def mc(a, span=span):
                try:
                    span[0] = max(1, int(a[0].strip()))
                except ValueError:
                    pass
                return a[2]
            c = replace_command(c, 'multicolumn', mc, nargs=3)
            rs = [0]

            def mr(a, rs=rs):
                try:
                    rs[0] = int(a[0].strip())
                except ValueError:
                    pass
                return a[2]
            c = re.sub(r'\\multirow\[[^\]]*\]', r'\\multirow', c)
            c = replace_command(c, 'multirow', mr, nargs=3)
            col = len(cells)
            if rs[0] > 1:
                carry[col] = [c.strip(), rs[0] - 1]
                cells.append((c.strip(), 'span'))  # the first row of a \multirow
            elif not c.strip() and col in carry and carry[col][1] > 0:
                carry[col][1] -= 1
                cells.append((carry[col][0], True))
            else:
                if col in carry and c.strip():
                    del carry[col]
                cells.append((c.strip(), False))
            cells.extend([('', False)] * (span[0] - 1))
        grid.append(cells)
    return grid


# The mark column's heading may be the exercise's total: "3pts", "14 points".
MARK_TOTAL_HEAD = re.compile(r'^\d+(?:[.,]\d+)?\s*(?:pts?|points?)$', re.I)
# The exercise named in a header's first cell: "Q.I", "QV", "Q. 3", "Question I (4 points)".
EXERCISE_CELL = re.compile(
    r'^(?:[Qq](?:uestion|UESTION)?|[Ee]x(?:ercise|ercice)?)\s*[-._]?\s*([IVX]{1,4}|\d)\s*(?:\([^)]*\))?$'
    r'|^([IVX]{1,4})\s*(?:\([^)]*\))?$')


def header_layout(cells):
    """If this row is the table's header, which column is what."""
    texts = [plain(c) for c, _ in cells]
    answer = [i for i, t in enumerate(texts) if ANSWER_HEAD.match(t)]
    mark = [i for i, t in enumerate(texts) if MARK_HEAD.match(t)]
    if not answer or not mark:
        # Known by its shape instead: the exercise in the first cell, the mark
        # column's heading (or the exercise's total) in the last, whatever the
        # middle says — "I | Answers | 3pts", "Q1 | MATH GS ■ FIRST SESSION | | M",
        # "Question I (4 points) | | Points".
        named = EXERCISE_CELL.match(texts[0]) if texts else None
        last = texts[-1] if texts else ''
        if len(texts) >= 3 and named and (MARK_HEAD.match(last) or MARK_TOTAL_HEAD.match(last)):
            v = named.group(1) or named.group(2)
            return {
                'labels': [0], 'answer': 1, 'mark': len(texts) - 1, 'skip': [], 'width': len(cells),
                'exercise': int(v) if v.isdigit() else roman(v), 'shape': True,
            }
        return None
    a = answer[0]
    labels = [i for i in range(a) if not COMMENT_HEAD.match(texts[i])]
    named = [HEADER_EXERCISE.match(texts[i]) for i in labels]
    named = [m for m in named if m]
    return {
        'labels': labels,
        'answer': a,
        'mark': mark[-1],
        'skip': [i for i, t in enumerate(texts) if COMMENT_HEAD.match(t)],
        'width': len(cells),
        'exercise': (int(named[0].group(1)) if named[0].group(1).isdigit() else roman(named[0].group(1)))
        if named else None,
    }


def table_width(grid):
    """The width most rows have. One row with a stray cell does not reshape the table."""
    counts = collections.Counter(len(r) for r in grid)
    return max(counts, key=lambda w: (counts[w], w))


def fit(cells, layout):
    """A row brought to the table's width: padded, or its extra cells folded into the answer."""
    width = layout['width']
    if len(cells) < width:
        return cells + [('', False)] * (width - len(cells))
    if len(cells) > width and layout['mark'] == width - 1:
        a = layout['answer']
        middle = ' '.join(c for c, _ in cells[a:-1] if c.strip())
        return cells[:a] + [(middle, False)] + [('', False)] * (width - a - 2) + [cells[-1]]
    return cells


def infer_layout(grid):
    """A table with no header row: last column the marks, label columns before the answer."""
    width = table_width(grid)
    # A heading row ("Exercise 1 : torsion pendulum | 7½") says nothing about
    # which column holds what.
    rows = [r for r in grid if len(r) == width and not header_layout(r)
            and not exercise_heading(' '.join(plain(c) for c, _ in r[:-1] if c))]
    if not rows or width < 2:
        return None
    marks = sum(1 for r in rows if parse_mark(r[-1][0]) is not None)
    if marks < max(1, len(rows) // 2):
        return None
    labels = []
    for col in range(width - 2):
        vals = [plain(r[col][0]) for r in rows if r[col][0].strip()]
        if not vals or all(len(v) <= 8 and label_tokens(v) for v in vals):
            # An empty column is the padding of a label spanning two.
            labels.append(col)
        else:
            break
    return {'labels': labels, 'answer': len(labels), 'mark': width - 1, 'width': width}


def scheme_text(exam, sha):
    """The scheme pages' Mathpix text, in reading order, page by page."""
    path = META / sha / 'lines.json'
    if not path.exists():
        return None
    n = exam.get('schemePages') or 0
    if not n:
        return None
    first = exam['pages'] - n + 1
    data = json.loads(path.read_text(encoding='utf-8'))
    out = []
    for pg in data['pages']:
        if pg.get('page', 0) >= first:
            for ln in pg.get('lines', []):
                out.append((pg['page'], str(ln.get('text') or '')))
    return out


# "I- Preliminary Study\n1- n(A) = ..." / "II-1- The number of moles" / "2- ..."
# — the label of a scheme that has no label column, read off the answer.
SECTION_LEAD = re.compile(r'\s*([IVX]{1,4})\s*[-.]\s*')
NUMBER_LEAD = re.compile(r'\s*(\d{1,2}(?:\s*[.\-]\s*\d{1,2})*)\s*[-.)]')


def answer_label(answer, section):
    """(section, label tokens) read off the start of an answer cell."""
    text = plain(answer)
    m = SECTION_LEAD.match(text)
    if m:
        section = m.group(1)
        rest = text[m.end():]
        if not NUMBER_LEAD.match(rest):
            # The section's title runs to the end of its line.
            nl = answer.find('\n')
            rest = plain(answer[nl + 1:]) if nl >= 0 else ''
        n = NUMBER_LEAD.match(rest)
        return section, ((section,) + label_tokens(n.group(1))) if n else (section,)
    n = NUMBER_LEAD.match(text)
    if n:
        toks = label_tokens(n.group(1))
        return section, ((section,) + toks) if section else toks
    return section, ()


def scheme_rows(exam, sha, track):
    """Every answer row of the scheme: {exercise, label, tokens, answer, marks, page}."""
    lines = scheme_text(exam, sha)
    if lines is None:
        return None, 'no scheme'
    rows = []
    current = None
    implicit = 0
    layout = None
    rows_since_heading = 0
    skipping = False  # inside another track's version of an exercise
    section = None

    def heading(text):
        nonlocal current, rows_since_heading, skipping, section
        n = exercise_heading(text)
        if not n:
            return False
        current, rows_since_heading, section = n, 0, None
        skipping = other_track(text, track)
        return True

    for page, text in lines:
        pos = 0
        while True:
            t = find_tabular(text, pos)
            before = text[pos:t[0]] if t else text[pos:]
            for m in re.finditer(r'[^\n]+', before):
                heading(m.group(0))
            if not t:
                break
            body = flatten_nested(text[t[1]:t[2]])
            grid = table_rows(body)
            pos = t[3]
            if not grid:
                continue
            own = None
            for r_i, cells in enumerate(grid):
                lay = header_layout(cells)
                if lay:
                    own = lay
                    break
            if own and own.get('shape'):
                # A header known by its shape says which exercise, not which
                # columns: two label columns ("1" | "1-1") are read off the rows.
                inferred = infer_layout(grid)
                if inferred and inferred['width'] == own['width']:
                    own = {**inferred, 'exercise': own['exercise'], 'shape': True}
            table_layout = own or (layout if layout and layout['width'] == table_width(grid) else None) \
                or infer_layout(grid)
            if not table_layout:
                continue
            layout = table_layout
            for cells in grid:
                # Every header row, not only a table's first: one table can run
                # on through several exercises ("Q-I | Solutions | N" and later,
                # mid-table, "Q-II | Solutions | N"). A header naming its
                # exercise says which; one that does not, after answered rows,
                # opens the next.
                lay = header_layout(cells)
                if lay:
                    if lay.get('exercise'):
                        n = lay['exercise']
                        # A key lists its exercises in order; a number that does
                        # not move forward is misprinted (gs/2021 2 heads its
                        # fifth exercise "III" a second time).
                        if current and n < current and rows_since_heading:
                            n = current + 1
                        current, rows_since_heading, section = n, 0, None
                    elif rows_since_heading and not skipping:
                        current = (current or implicit) + 1
                        rows_since_heading = 0
                    continue
                # A row holding only the exercise's number: "II", "Question III | 6 pts".
                filled = [plain(c) for c, _ in cells if c.strip()]
                alone = HEADER_EXERCISE.match(filled[0]) if filled and (
                    len(filled) == 1 or (len(filled) == 2 and parse_mark(filled[1]) is not None)) else None
                if alone and (alone.group(0)[:1].isalpha() or not alone.group(1).isdigit()):
                    v = alone.group(1)
                    current = int(v) if v.isdigit() else roman(v)
                    rows_since_heading, section = 0, None
                    continue
                # "Exercise 1 : torsion pendulum | 7½" — a heading row, which
                # may carry the exercise's total in the mark column.
                head = ' '.join(plain(c) for c, _ in cells[:-1] if c)
                if len(head) < 160 and heading(head):
                    continue
                if skipping:
                    continue
                cells = fit(cells, layout)
                label_cells = [plain(cells[i][0]) for i in layout['labels'] if i < len(cells) and cells[i][0]]
                label = ' '.join(label_cells)
                # Every answer column, in order: a multiple-choice key prints
                # the working in one and the option chosen, "(d)", in the next.
                answer_cells = [cells[i][0] for i in range(layout['answer'], len(cells))
                                if i != layout['mark'] and i not in layout['labels']
                                and i not in layout.get('skip', ()) and cells[i][0].strip()]
                answer = '\n\n'.join(answer_cells)
                mark_cell, spanned = cells[layout['mark']] if layout['mark'] < len(cells) else ('', False)
                marks = parse_mark(mark_cell)
                # One mark printed across several rows (\multirow) is the
                # group's, counted once: carried into every row it read 4 for
                # each of six questions worth 4 together (gs/2007 1/math_en.pdf I).
                if spanned is True:
                    marks = None
                tokens = ()
                if not layout['labels']:
                    section, tokens = answer_label(answer, section)
                    label = '.'.join(tokens)
                elif label and len(label) <= 16:
                    tokens = join_label_cells(label_cells)
                # "A | 2a  z' + z = 0": the section in the label column, the
                # sub-label at the head of the answer cell (gs/2016 1/math_en.pdf).
                if len(tokens) == 1 and not tokens[0].isdigit():
                    head = re.match(r'^\s*(\d{1,2}\s*[a-h]?|[a-h])\s*[-.)]?\s{2,}', answer)
                    if head:
                        tokens = tokens + label_tokens(head.group(1))
                        answer = answer[head.end():]
                # "II-" alone, or with its title: a section's heading row.
                if len(tokens) == 1 and not tokens[0].isdigit() and marks is None and section_title(answer):
                    continue
                # "1 | Organic synthesis |": a numbered heading row, its title
                # shown as the answer to part 1 (gs/2007 2/chem_en.pdf I).
                if len(tokens) == 1 and marks is None and not spanned and section_title(answer) \
                        and not re.search(r'\d', answer) and len(answer.split()) <= 5:
                    continue
                if not tokens and not answer.strip() and marks is None:
                    continue
                # Before an exercise's first labelled row, an unlabelled one is a
                # title ("Mathematics"), not the continuation of an answer.
                if not tokens and not rows_since_heading:
                    continue
                if current is None:
                    implicit += 1
                    current = implicit
                rows.append({
                    'exercise': current, 'label': plain(label), 'tokens': tokens,
                    'answer': answer, 'marks': marks, 'page': page, 'sharedMark': bool(spanned),
                })
                rows_since_heading += 1
    return rows, None


# --------------------------------------------------------------------------
# The scheme as a list (2004–2009 physics): labels at line starts, marks inline
# --------------------------------------------------------------------------

# One label in a run at the start of a line: "I -", "1)", "2-", "a)", "ii)".
LIST_TOKEN = re.compile(r'\s*-?\s*([IVX]{1,4}|[A-D]|\d{1,2}|[a-h]|[ivx]{1,4})\s*[-–.)]\s*')
# A mark written beside an answer: "(1/4pt.)", "(1/2)", "(1 ½ pt)", "(1pt)".
MARK_NOTE = re.compile(r'\(\s*((?:\d+\s+)?\d\s*/\s*[248]|\d+(?:[.,]\d+)?\s*[½¼¾]?|[½¼¾])\s*'
                       r'(pts?\.?|points?)?\s*\.?\s*\)', re.I)


def list_level(tok, stack):
    if re.fullmatch(r'[IVX]{1,4}|[A-D]', tok):
        return 0
    if tok.isdigit():
        return 1
    if tok in ('i', 'v') and stack[2] is None:
        return 2  # a letter, not a roman numeral, when no letter is open
    if re.fullmatch(r'[ivx]{1,4}', tok):
        return 3
    return 2


def inline_marks(text):
    """The marks written inside an answer, summed. A bare "(2)" is an equation
    number, so a note counts only with a unit or as a fraction."""
    s = re.sub(r'\\(?:mathbf|text|boldsymbol|mathrm|left|right)\b', ' ', text)
    s = re.sub(r'[{}$~]', ' ', s)
    s = re.sub(r'\\[dt]?frac\s*(\d)\s+(\d)\b', r' \1/\2 ', s)  # \frac{\mathbf{1}}{\mathbf{2}}
    s = re.sub(r'\bp\s+t(s?)\b', r'pt\1', s)  # \mathbf{p t}
    total = 0.0
    found = False
    for m in MARK_NOTE.finditer(s):
        if not m.group(2) and '/' not in m.group(1) and not re.search('[½¼¾]', m.group(1)):
            continue
        v = parse_mark(m.group(1))
        if v is not None:
            total += v
            found = True
    return total if found else None


def logical_lines(text):
    """Lines, with a display formula kept as one line however many it spans."""
    out, buf, in_display = [], [], False
    for line in text.split('\n'):
        buf.append(line)
        if line.count('$$') % 2:
            in_display = not in_display
        if not in_display:
            out.append('\n'.join(buf))
            buf = []
    if buf:
        out.append('\n'.join(buf))
    return out


MATH_LABEL = re.compile(r'^(\s*)\$\s*((?:\\mathbf\{\s*[0-9a-z]{1,3}\s*\}\s*[-.)]\s*)+)')


def unwrap_math_label(line):
    """A label set inside the formula it opens: "$\\mathbf{1}-\\mathrm{E}=…$" is
    part 1, "$\\mathbf{a}-\\mathbf{i}) …$" is a-i). Taken out ahead of the "$"."""
    m = MATH_LABEL.match(line)
    if not m:
        return line
    labels = re.sub(r'\\mathbf\{\s*([0-9a-z]{1,3})\s*\}', r'\1', m.group(2)).replace(' ', '')
    return f"{m.group(1)}{labels} ${line[m.end():]}"


def section_title(text):
    """Nothing, or a short title with no formula: what a section's heading row holds."""
    t = re.sub(r'\s+', ' ', text or '').strip(' -:.*')
    return len(t) <= 3 or (len(t) <= 80 and '$' not in t and '\\' not in t)


def list_rows(exam, sha, track):
    """Answer rows of a scheme written as a list rather than a table."""
    lines = scheme_text(exam, sha)
    if lines is None:
        return None
    text = '\n'.join(t for _, t in lines)
    text = re.sub(r'\\(?:begin|end)\{(?:itemize|enumerate)\}', '\n', text)
    text = re.sub(r'\\item\[([^\]]*)\]', lambda m: '\n' + m.group(1) + ' ', text)
    text = re.sub(r'\\item\b', '\n', text)
    rows, current, skipping = [], None, False
    stack = [None, None, None, None]
    row = None
    for line in logical_lines(text):
        if not line.strip():
            continue
        n = exercise_heading(line) if len(line) < 160 else None
        if n:
            current, stack, row = n, [None] * 4, None
            skipping = other_track(line, track)
            continue
        if skipping or current is None:
            continue
        line = unwrap_math_label(line)
        pos, toks = 0, []
        if not line.lstrip().startswith('$'):
            while True:
                m = LIST_TOKEN.match(line, pos)
                if not m:
                    # "B - $\mathbf{1}-…$": the run continues inside a formula.
                    rest = unwrap_math_label(line[pos:])
                    if toks and rest != line[pos:]:
                        line = line[:pos] + rest
                        continue
                    break
                toks.append(m.group(1))
                pos = m.end()
        if toks:
            for tok in toks:
                lvl = list_level(tok, stack)
                stack[lvl] = tok
                for deeper in range(lvl + 1, 4):
                    stack[deeper] = None
            row = {'exercise': current, 'label': '.'.join(t for t in stack if t),
                   'tokens': tuple(t.upper() for t in stack if t), 'answer': line[pos:], 'page': None}
            rows.append(row)
        elif row is not None:
            row['answer'] += '\n' + line
    for r in rows:
        r['marks'] = inline_marks(r['answer'])
    # "A- Charging of the capacitor": a section's title, not an answer.
    return [r for r in rows if not (len(r['tokens']) == 1 and not r['tokens'][0].isdigit()
                                    and r['marks'] is None and section_title(r['answer']))]


# --------------------------------------------------------------------------
# Rows -> parts
# --------------------------------------------------------------------------

def add_missing_sections(md, intro, parts, segs, rows):
    """Sections the extractor missed, recovered from the paper's own heading.

    gs/2004 1/2004 gs physics_en 1.pdf exercise 2 prints "C - Interaction
    photon - hydrogen atom" and its key answers C, but the extracted parts
    stop at B.2, so C's rows had no part and the whole exercise was refused.
    A section is added only where the key names it AND the statement prints
    its heading as a line of its own; it is cut from the part it was buried
    in. Never invented: no heading on the paper, no part.
    """
    _, orphans = bind_rows(rows, parts)
    ptoks = [label_tokens(p['label']) for p in parts]
    have = {t[0] for t in ptoks if t}
    missing, numbered = [], []
    for r in orphans:
        t = r['tokens']
        s = t[0] if t else None
        if s and not s.isdigit() and s not in have and s not in missing:
            missing.append(s)
        # "A1" where the parts start at A.2: a numbered part the extractor lost.
        head = t[:2] if len(t) >= 2 and not t[0].isdigit() and t[1].isdigit() else t[:1] if t and t[0].isdigit() else ()
        if head and head not in ptoks and head not in numbered and (len(head) == 1 or head[0] in have):
            numbered.append(head)
    if not missing and not numbered:
        return None
    starts, pos = [], 0
    for seg in segs:
        at = md.find(seg, pos)
        if at < 0:
            return None
        starts.append(at)
        pos = at + len(seg)
    pieces = [(at, p['label']) for at, p in zip(starts, parts)]
    for sec in missing:
        heads = [m.start() for m in re.finditer(
            r'(?m)^[ \t*#>]*(?:part(?:ie)?\s+)?' + re.escape(sec) + r'\s*[-.–)/:]', md)]
        heads = [h for h in heads if h > starts[0] and h not in starts]
        if not heads:
            return None
        pieces.append((heads[0], sec))
    for head in numbered:
        prefix, n = head[:-1], int(head[-1])
        after = [k for k, t in enumerate(ptoks) if t[:len(prefix)] == prefix and len(t) > len(prefix)
                 and t[len(prefix)].isdigit() and int(t[len(prefix)]) > n]
        if not after:
            return None
        k = after[0]
        lo = starts[k - 1] + 1 if k > 0 else 0
        # "1)" opening a line, or after its section on the same line: "A - 1) …".
        sec = (re.escape(prefix[0]) + r'\s*[-.–)]\s*(?:\*\*)?\s*') if prefix else ''
        printed = [m.start(1) for m in re.finditer(
            r'(?m)^[ \t*>#]*(?:\*\*)?\s*(' + (f'(?:{sec})?' if sec else '') + str(n) + r'\s*[-.)])',
            md[lo:starts[k]])]
        if not printed:
            return None
        pieces.append((lo + printed[-1], '.'.join(head)))
    pieces.sort()
    labels = [lab for _, lab in pieces]
    if len(set(labels)) != len(labels):
        return None
    ends = [at for at, _ in pieces[1:]] + [len(md)]
    new_segs = [md[at:end].strip() for (at, _), end in zip(pieces, ends)]
    if any(not s for s in new_segs):
        return None
    by_label = {p['label']: p for p in parts}
    new_parts = [by_label.get(lab, {'label': lab, 'text': ''}) for lab in labels]
    return new_parts, new_segs, missing + [".".join(h) for h in numbered]


SIDECARS = ROOT / 'corpus' / 'schemes'
WHOLE_KEY_STATUSES = {'orphan rows', 'out of order', 'marks disagree'}


def whole_key(rows, exam, ex_index, pdf_path, sha, display):
    """The exercise's answer key as printed, under the key's own labels.

    For an exercise whose rows could not be bound part by part, the old stored
    answer is the scheme pages' text layer — scraps like "1.5 2 ME7 < MEo …".
    The clean rows are on hand, so the key is shown whole, each row under its
    own label ("1-2)", "2-1)"), and the student matches them. Only when the
    rows read like this exercise and no other (`check_belonging`).
    """
    rows = [r for r in rows if r['answer'].strip()]
    if len(rows) < 2:
        return None
    chunks = [('.'.join(r['tokens']).lower(), r['answer']) for r in rows]
    md, figures = answer_markdown(chunks)
    text = '\n\n'.join(labelled(lab, m) for lab, m in md if m.strip())
    if figures:
        for k, path in enumerate(cut_figures(pdf_path, sha, figures)):
            text = text.replace(f'[[figure:{k}]]', f'\n\n![]({path})\n\n' if path else '')
    text = re.sub(r'\n{3,}', '\n\n', text).strip()
    if not text or SMILES.search(text):
        return None
    probe = {'answers': {'status': 'ok', 'byPart': {0: {'answer': text}}}}
    ex = next(e for e in exam['exercises'] if e['index'] == ex_index)
    check_belonging(exam, [(probe, ex)], display)
    return text if probe['answers']['status'] == 'ok' else None


def drop_sandwiched(parts):
    """A "part" whose label breaks the run it sits in is not a part.

    gs/2019/phy_en.pdf I lists 1-6, "4", 1-7: the "4" is a graph's axis
    ("4 – 2 – 4 – 6 – 8 – 10 t1 Doc. 2") read as a question, and it stopped
    the exercise being split. Dropped only when both neighbours belong to one
    family (1.6 and 1.7) and it does not.
    """
    toks = [label_tokens(p['label']) for p in parts]
    keep = []
    for k, p in enumerate(parts):
        if 0 < k < len(parts) - 1 and toks[k - 1] and toks[k + 1] and toks[k] \
                and toks[k - 1][0] == toks[k + 1][0] != toks[k][0] and len(toks[k + 1]) > 1:
            continue
        keep.append(p)
    return keep


def table_questions(md):
    """A multiple-choice exercise: one table, one numbered row per question.

    The extractor finds no parts in it, because its questions are table rows.
    Each becomes a part shown as the table's header and its own row, so the
    answer sits under the question it answers. (intro, [(label, text)]) or None.
    """
    lines = md.split('\n')
    start = next((i for i, l in enumerate(lines) if l.startswith('|')), None)
    if start is None:
        return None
    end = start
    while end < len(lines) and lines[end].startswith('|'):
        end += 1
    table = lines[start:end]
    numbered = [i for i, l in enumerate(table) if re.match(r'^\|\s*(\d{1,2})\s*\|', l)]
    if len(numbered) < 2:
        return None
    head = table[:numbered[0]]
    if not any(re.fullmatch(r'\|(?:-+\|)+', l) for l in head):
        return None
    nums = [int(re.match(r'^\|\s*(\d{1,2})', table[i]).group(1)) for i in numbered]
    if nums != list(range(1, len(nums) + 1)):
        return None
    after = '\n'.join(lines[end:]).strip()
    parts = []
    for k, i in enumerate(numbered):
        rows = table[i:numbered[k + 1]] if k + 1 < len(numbered) else table[i:]
        text = '\n'.join(head + rows)
        if k == len(numbered) - 1 and after:
            text += '\n\n' + after
        parts.append((str(nums[k]), text))
    return '\n'.join(lines[:start]).strip(), parts


# A section heading: "B- Experimental study", "II. …", or "Part B" alone on its line.
# Not "E: «The chosen urn is U1»" — a bare letter with a colon names an event.
SECTION_LINE = re.compile(
    r'(?m)^[ \t*#>]*(?:\*\*)?\s*(?:(?:Part(?:ie)?\s+)([A-H]|[IVX]{1,4})\s*(?:\*\*)?\s*(?:[-.–)/:]|$)'
    r'|([A-H]|[IVX]{1,4})\s*(?:\*\*)?\s*[-.–)])')


def section_name(m):
    return m.group(1) or m.group(2)


def move_section_heads(segs, labels):
    """A "Part B" line left at the bottom of part A's last segment opens B instead."""
    segs = list(segs)
    for k in range(len(segs) - 1):
        lines = segs[k].rstrip().split('\n')
        last = lines[-1].strip()
        m = SECTION_LINE.match(last)
        nxt = label_tokens(labels[k + 1])
        if m and len(last) <= 40 and nxt and nxt[0] == section_name(m) and len(lines) > 1:
            segs[k] = '\n'.join(lines[:-1]).rstrip()
            segs[k + 1] = last + '\n\n' + segs[k + 1]
    return segs


def printed_labels(md, intro, segs, nest=False):
    """Each part's label as the paper prints it: its own number ("2-1)") under the
    last section heading above it ("B-"). None where a part prints no label.

    With `nest`, a lone small letter ("b- Calculate the probability …",
    gs/2005 1/gs math_en 1.pdf, a part the extractor labelled "8") is the
    sub-part of the number printed above it: "1.B".

    The extractor's labels lose sections (gs/2016 1 maths reads 1, 2, 1, 2, 1, 2,
    3 for A1, A2, B1, B2, C1…) and take formula numbers for labels ("B.72").
    The clean text has neither fault, so when a key will not bind to the
    extracted labels it is tried against these.
    """
    out, pos = [], len(intro)
    for seg in segs:
        at = md.find(seg, pos)
        if at < 0:
            return None
        pos = at + len(seg)
        opens = SECTION_LINE.match(seg)
        if opens:
            # The part opens its section: "B- Experimental study\n1) Determine…".
            section = section_name(opens)
            own = ()
            for line in seg[opens.end():].split('\n'):
                m = PRINTED_LABEL.match(re.sub(r'^[\s*#>]+', '', line))
                if m:
                    own = label_tokens(m.group(0))
                    break
        else:
            # From the line after the exercise's own heading ("IV- (3 points)"),
            # so a "Part A" printed above the first part still counts.
            first = md.find('\n') + 1
            heads = [h for h in SECTION_LINE.finditer(md, first, at) if h.start() < at]
            section = section_name(heads[-1]) if heads else None
            m = PRINTED_LABEL.match(re.sub(r'^[\s*#>]+', '', seg))
            if m is None:
                return None
            own = label_tokens(m.group(0))
            if nest and re.fullmatch(r'\s*[a-z]\s*[-.)]', m.group(0)) and out:
                above = out[-1].split('.')
                numbered = [k for k, t in enumerate(above) if t.isdigit()]
                if numbered:
                    out.append('.'.join(above[:numbered[-1] + 1] + list(own)))
                    continue
        if own and section and own[0] == section:
            own = own[1:]  # "A-1)" carries its section already
        toks = ((section,) if section else ()) + own
        out.append('.'.join(toks))
    return out if len(set(out)) == len(out) and all(out) else None


ROMAN_TOKEN = re.compile(r'[IVX]{1,4}')


def numbered_by_first_column(rows, exam):
    """A key whose first label column is the exercise number: "I | 2-a- | …".

    gs/2004 2/math_en.pdf prints the exercise's Roman numeral beside its rows
    and no heading at all, so every row was read as exercise 1's. When most
    labelled rows open with a numeral, the numerals run through several
    exercises the paper has, and no part of the paper is labelled with one
    (a physics "II.1" is a section, not an exercise), the numeral is the
    exercise.
    """
    if not rows:
        return rows
    if any(label_tokens(p['label'])[:1] and ROMAN_TOKEN.fullmatch(label_tokens(p['label'])[0])
           for e in exam['exercises'] for p in e.get('parts') or []):
        return rows
    labelled = [r for r in rows if r['tokens']]
    lead = [r for r in labelled if ROMAN_TOKEN.fullmatch(r['tokens'][0])]
    numerals = {roman(r['tokens'][0]) for r in lead}
    indices = {e['index'] for e in exam['exercises']}
    if len(lead) < 0.6 * len(labelled) or len(numerals) < 3 or not numerals <= indices:
        return rows
    out, current = [], None
    for r in rows:
        if r['tokens'] and ROMAN_TOKEN.fullmatch(r['tokens'][0]):
            current = roman(r['tokens'][0])
            r = {**r, 'exercise': current, 'tokens': r['tokens'][1:]}
            # "IV | IV 1": the numeral repeated in the next column too.
            while r['tokens'] and ROMAN_TOKEN.fullmatch(r['tokens'][0]) and roman(r['tokens'][0]) == current:
                r['tokens'] = r['tokens'][1:]
        elif current is not None:
            r = {**r, 'exercise': current}
        out.append(r)
    return out


def bind_rows(rows, parts):
    """Each row to the part whose label is the longest prefix of the row's. Continuation rows merge."""
    ptoks = [label_tokens(p['label']) for p in parts]
    bound = []  # (part index, row)
    orphans = []
    last = None
    for r in rows:
        toks = r['tokens']
        if not toks:
            if last is None:
                orphans.append(r)
                continue
            bound.append((last, r))  # a continuation of the row above
            continue
        def longest_prefix(t):
            best = None
            for i, pt in enumerate(ptoks):
                if pt and t[:len(pt)] == pt and (best is None or len(pt) > len(ptoks[best])):
                    best = i
            return best
        best = longest_prefix(toks)
        if best is None and last is not None:
            # "1" under section B: the scheme dropped the section letter.
            head = tuple(t for t in ptoks[last] if not t.isdigit())[:1]
            if head:
                best = longest_prefix(head + toks)
        if best is None and len(toks) > 1 and not toks[0].isdigit():
            # "A.I.1" where the paper numbers the part "I.1": a section the
            # parts list does not carry.
            best = longest_prefix(toks[1:])
        if best is None and len(toks) > 1:
            # "B.b" where the parts are numbered "B.2": the key letters what
            # the statement numbers.
            numbered = toks[:1] + tuple(str(ord(t) - 64) if re.fullmatch('[A-H]', t) else t for t in toks[1:])
            best = longest_prefix(numbered)
        if best is None:
            orphans.append(r)
            continue
        bound.append((best, r))
        last = best
    return bound, orphans


FIGURE_DIR = ROOT / 'public' / 'answer-figures'


def page_sizes(sha):
    """Mathpix's pixel size of each page, the frame its crop boxes are in."""
    data = json.loads((META / sha / 'lines.json').read_text(encoding='utf-8'))
    return {pg['page']: (pg.get('page_width'), pg.get('page_height')) for pg in data['pages']}


def cut_figures(pdf_path, sha, figures):
    """A drawing printed as an answer ("Redraw the circuit"), cut from the scheme page.

    Mathpix's own crops live on its CDN for 90 days; the PDF is the permanent
    copy, so the box is cut from it. Returns the public path of each, or None.
    """
    import pypdfium2 as pdfium
    sizes = page_sizes(sha)
    out = []
    doc = None
    try:
        for f in figures:
            pw, ph = sizes.get(f['page'], (None, None))
            if not pw or not f['w'] or not f['h']:
                out.append(None)
                continue
            name = f"{sha[:12]}-p{f['page']}-{f['y']}-{f['x']}.png"
            target = FIGURE_DIR / name
            if not target.exists():
                if doc is None:
                    doc = pdfium.PdfDocument(str(pdf_path))
                page = doc[f['page'] - 1]
                image = page.render(scale=pw / page.get_width()).to_pil()
                pad = 6
                box = (max(0, f['x'] - pad), max(0, f['y'] - pad),
                       min(image.width, f['x'] + f['w'] + pad), min(image.height, f['y'] + f['h'] + pad))
                FIGURE_DIR.mkdir(parents=True, exist_ok=True)
                image.crop(box).save(target, optimize=True)
            out.append(f'/answer-figures/{name}')
    finally:
        if doc is not None:
            doc.close()
    return out


def answer_markdown(chunks):
    figures = []

    def fig(m):
        url = m.group(1)
        q = dict(re.findall(r'(\w+)=(\d+)', url.replace('\\&', '&')))
        pg = re.search(r'-(\d+)\.jpg', url)
        figures.append({
            'page': int(pg.group(1)) if pg else None,
            'x': int(q.get('top_left_x', 0)), 'y': int(q.get('top_left_y', 0)),
            'w': int(q.get('width', 0)), 'h': int(q.get('height', 0)),
        })
        return f' [[figure:{len(figures) - 1}]] '
    out = []
    for label, text in chunks:
        text = FIGURE.sub(fig, text)
        md = to_markdown(text)
        out.append((label, md))
    return out, figures


# --------------------------------------------------------------------------
# Statement -> parts
# --------------------------------------------------------------------------

MATH = re.compile(r'\$\$.*?\$\$|\$[^$]*\$', re.S)
WORD = re.compile(r'[^\W\d_]{3,}')
PRINTED_LABEL = re.compile(r'^\s*(?:[A-Za-z]{1,3}\s*[-.–)]\s*)?(?:\d{1,2}\s*[-.–]\s*)*\d{1,2}\s*[-.–)]|^\s*[a-z]\s*[-.)]|^\s*[A-Z]\s*[-.–)]')


def prose_words(text):
    return [w.lower() for w in WORD.findall(MATH.sub(' ', text))]


def strip_label(text):
    return PRINTED_LABEL.sub('', text, count=1)


def word_index(md):
    """Positions of the prose words of the Markdown, maths removed."""
    out = []
    masked = MATH.sub(lambda m: ' ' * len(m.group(0)), md)
    for m in WORD.finditer(masked):
        out.append((m.group(0).lower(), m.start()))
    return out


def anchor(words, start, want):
    """Earliest best-scoring place at/after `start` where `want` reads, in order.

    Returns the index of the first word that MATCHED, not of the word the
    search started from. Starting at "the" in "across the capacitor is:
    Determine the expression" scores in full for "Determine the expression",
    and reporting the start put part 5's cut in the middle of part 4.
    """
    if not want:
        return None
    k = len(want)
    best = (0, None)
    for i in range(start, len(words)):
        if words[i][0] not in want[:2]:
            continue
        j, hit, first = i, 0, None
        for w in want:
            for jj in range(j, min(j + 3, len(words))):
                if words[jj][0] == w:
                    hit += 1
                    first = jj if first is None else first
                    j = jj + 1
                    break
        if hit > best[0]:
            best = (hit, first)
            if hit == k:
                break
    need = k if k <= 2 else max(2, -(-k * 3 // 4))
    return best[1] if best[0] >= need else None


ANCHOR_WORDS = 6


def printed_label_at(md, lo, pos, text):
    """Where the part's own printed label ("4)", "2-3-2)") stands, just before its first words."""
    m = PRINTED_LABEL.match(text)
    if not m:
        return None
    pattern = r'\s*'.join(re.escape(ch) for ch in re.sub(r'\s+', '', m.group(0)))
    found = None
    for hit in re.finditer(pattern, md[lo:pos]):
        at = lo + hit.start()
        if at == 0 or md[at - 1] in ' \t\n*>':
            found = at
    return found


def section_of(label):
    toks = label_tokens(label)
    return toks[0] if toks and not toks[0].isdigit() else None


def label_line(md, floor, text):
    """Where the part's printed label ("2.5.1)", "4-") opens a line after `floor`."""
    m = PRINTED_LABEL.match(text)
    if not m:
        return None
    pattern = r'\s*'.join(re.escape(ch) for ch in re.sub(r'\s+', '', m.group(0)))
    for hit in re.finditer(r'(?m)^[ \t*>#]*(' + pattern + r')', md):
        at = hit.start(1)
        if at > floor:
            return at
    return None


def split_statement(md, parts):
    """Intro + one Markdown segment per part, or (None, reason).

    A part is found by its first words — only words the Markdown has at all,
    since the extractor's copy carries scan debris ("amu", "chrono mètre")
    that can never match. A part with too few words is found by its printed
    label at the start of a line. A part with neither is not a part (an
    energy-level diagram's numbers read as "B.3") and gets no segment: its
    entry in the result is None.
    """
    words = word_index(md)
    vocab = {w for w, _ in words}
    cuts = []
    placed = []
    start = 0
    for k, p in enumerate(parts):
        want = [w for w in prose_words(strip_label(p['text'])) if w in vocab][:ANCHOR_WORDS]
        i = anchor(words, start, want) if len(want) >= 2 else None
        if i is None:
            at = label_line(md, cuts[-1] if cuts else -1, p['text'])
            if at is None:
                if len(want) < 2:
                    placed.append(False)
                    continue
                return None, f"part {p['label']} not found"
            i = next((j for j in range(start, len(words)) if words[j][1] >= at), len(words) - 1)
            pos = at
        else:
            pos = words[i][1]
        placed.append(True)
        # The previous part's cut; before the first part, nothing (a part may start the text).
        floor = cuts[-1] if cuts else -1
        line = md.rfind('\n', 0, pos) + 1
        above = md.rfind('\n', 0, max(0, line - 1)) + 1
        printed = printed_label_at(md, max(floor, above), pos, p['text'])
        if printed is not None and printed > floor:
            cut = printed
            if not md[line:cut].strip(' \t*'):
                cut = line
        else:
            cut = line
            # The label printed alone on the line above ("**A-** " or "2)").
            gap = md[above:line].strip()
            if gap and len(gap) <= 12 and not WORD.search(MATH.sub(' ', gap).replace('**', '')):
                cut = above
        if cut <= floor:
            # Two parts on one printed line ("1) a) ..."): cut at the word itself.
            cut = pos
            if cut <= floor:
                return None, f"part {p['label']} out of order"
        # A new section's heading ("B- Study of the oscillator") belongs to
        # the first part of that section, not to the tail of the one before.
        sec = section_of(p['label'])
        # Only when this is the section's own first part: a list starting at
        # "A.2" lost A.1, and pulling the cut back to "A-" would swallow it.
        rest = label_tokens(p['label'])[1:]
        if sec and (not rest or rest[0] == '1') and (k == 0 or section_of(parts[k - 1]['label']) != sec):
            heads = [m.start() for m in re.finditer(
                r'^[ \t*#>]*(?:part(?:ie)?\s+)?' + re.escape(sec) + r'\s*[-.–)/:]', md[max(floor, 0):cut],
                re.M | re.I)]
            if heads and max(floor, 0) + heads[-1] > floor:
                cut = max(floor, 0) + heads[-1]
        cuts.append(cut)
        start = i + 1
    if not cuts:
        return None, 'no part found'
    intro = md[:cuts[0]].rstrip()
    found = iter(md[a:b].strip() for a, b in zip(cuts, cuts[1:] + [len(md)]))
    segs = [next(found) if ok else None for ok in placed]
    if any(s is not None and not s for s in segs):
        return None, 'empty part'
    return (intro, segs), None


# --------------------------------------------------------------------------
# One paper
# --------------------------------------------------------------------------

def paper_rows(exam):
    """Every answer row of a paper's key, each with a stable `rid`, and why there are none."""
    sha = exam['sha256']
    track = exam['path'].replace('\\', '/').split('/')[0].lower()
    rows, why = scheme_rows(exam, sha, track)
    rows = numbered_by_first_column(rows, exam)
    # A scheme printed as a list (2004–2009 physics) has no table to read.
    listed = list_rows(exam, sha, track) if not why else None
    if listed and len({r['exercise'] for r in listed}) > len({r['exercise'] for r in rows or []}):
        rows = listed
    for i, r in enumerate(rows or []):
        r['rid'] = i
    return rows, why


MATCHES = ROOT / 'corpus' / '.mapping' / 'key-row-matches.json'
_matches = None


def model_matches(sha):
    """{rid: (ordinal, part label)} for a paper, from match_key_rows.py, or {}."""
    global _matches
    if _matches is None:
        _matches = json.loads(MATCHES.read_text(encoding='utf-8')) if MATCHES.exists() else {}
    return {int(k): tuple(v) for k, v in (_matches.get(sha) or {}).items() if v}


def placed_tokens(own, part_label):
    """A row the model placed on a part keeps its own sub-letter: "A.2.a" and
    "A.2.b" placed on part A.2 answer it as a) and b), not as one block with
    the letters lost (55 parts of 27 exercises showed a and b run together).
    "2.a" placed on part "B.2" keeps its "a" the same way."""
    part = label_tokens(part_label)
    own = tuple(own or ())
    if len(own) > len(part) and own[:len(part)] == part:
        return own
    if len(own) >= 2 and re.fullmatch('[A-H]', own[-1]) and part and own[-2] == part[-1]:
        return part + own[-1:]
    return part


def ignores_named_rows(parts, texts, rows, placed, matched):
    """The model filled a part while passing over every row the key labels for it.

    gs/2004 2/phy_en.pdf II: the key prints rows B.1.a, B.1.b, B.1.c; the
    model put section A's row on part B.1 and used none of those three, so
    B.1 showed another question's answer. A part is suspect only when rows
    name it by label (the longest-prefix rule of bind_rows) and NONE of them
    is among what the model placed there: the model may still re-file rows
    ("1" under section 2 as 2.1, gs/2019/phy_en.pdf), move them between
    exercises, or pick one of two rows labelled alike (a key that also prints
    another paper's exercise, gs/2016 2/chem_fr.pdf) — all measured right.

    Labels alone also refused five right placements, where the key misprints
    its labels (I.2 for II.2) — the very case the model is for — and the
    words of a physics answer are too few to judge by. What only the wrong
    case has: the part prints sub-questions a, b, c, and the key has one row
    for each, labelled for this part (B.1.a, B.1.b, B.1.c), all passed over."""
    ptoks = [label_tokens(p['label']) for p in parts]

    def named(toks):
        best = None
        for i, pt in enumerate(ptoks):
            if pt and tuple(toks[:len(pt)]) == pt and (best is None or len(pt) > len(ptoks[best])):
                best = i
        return None if best is None else parts[best]['label']

    on = collections.defaultdict(set)
    for r in placed:
        on[matched[r['rid']][1]].add(r['rid'])
    by_name = collections.defaultdict(set)
    here = matched[placed[0]['rid']][0] if placed else None
    for r in rows or []:
        if r['rid'] in matched and matched[r['rid']][0] != here:
            continue  # the model filed it under another exercise; its "1.1" is that exercise's
        own = named(r['tokens'])
        if own:
            by_name[own].add(r['rid'])
    letters_of = collections.defaultdict(set)
    for r in rows or []:
        if r['rid'] in by_name.get(named(r['tokens']) or '', ()):
            own = named(r['tokens'])
            tail = r['tokens'][len(label_tokens(own)):]
            if len(tail) == 1 and re.fullmatch('[A-H]', tail[0]):
                letters_of[own].add(tail[0].lower())
    for label, ids in on.items():
        asked = printed_letters(texts.get(label, ''))
        if asked and letters_of.get(label) == set(asked) and not (ids & by_name[label]):
            return True
    return False


SUB_LETTER = re.compile(r'(?:^|\n|\s)\*{0,2}([a-h])\*{0,2}\s?[-.)]\s', re.M)


def printed_letters(text):
    """The sub-questions a, b, c … a part prints, in order; [] if fewer than two.
    "(d)" is a line's name, not a sub-question."""
    want, got = 'a', []
    for m in SUB_LETTER.finditer(text or ''):
        if m.group(1) == want and (text[m.start(1) - 1] if m.start(1) else '') != '(':
            got.append(want)
            want = chr(ord(want) + 1)
    return got if len(got) >= 2 else []


def build_paper(exam, display):
    sha = exam['sha256']
    rows, why = paper_rows(exam)
    by_ex = collections.defaultdict(list)
    for r in rows or []:
        by_ex[r['exercise']].append(r)
    out = []
    for order, ex in enumerate(exam['exercises']):
        rec = {'ordinal': order + 1, 'index': ex['index'], 'marks': ex['marks'], 'title': ex.get('title') or ''}
        parts = drop_sandwiched(ex.get('parts') or [])
        shown = display.get((sha, order + 1))
        # A question table is read as the exercise's parts when the extractor
        # found none — or only debris: one "part", or labels like "21" and
        # "26" that are numbers from a formula (gs/2011 2/math_en.pdf I).
        bogus = len(parts) <= 1 or all(not p['label'].isdigit() or int(p['label']) > 12 for p in parts)
        questions = table_questions(shown) if shown and bogus else None
        if questions and parts and len(questions[1]) < 3:
            questions = None
        if not parts and not questions:
            out.append({**rec, 'status': 'no parts'})
            continue
        if not shown:
            out.append({**rec, 'status': 'no display text'})
            continue
        if questions:
            intro, found = questions
            parts = [{'label': lab, 'text': text} for lab, text in found]
            segs = [text for _, text in found]
            rec['tableQuestions'] = True
        else:
            split, reason = split_statement(shown, parts)
            if not split:
                out.append({**rec, 'status': 'split refused', 'reason': reason})
                continue
            intro, segs = split
        dropped = [p['label'] for p, s in zip(parts, segs) if s is None]
        if dropped:
            rec['partsDropped'] = dropped  # not parts: no words, no printed label
            parts = [p for p, s in zip(parts, segs) if s is not None]
            segs = [s for s in segs if s is not None]
        rec.update(status='split', intro=intro,
                   parts=[{'label': p['label'], 'text': s} for p, s in zip(parts, segs)])
        mine = by_ex.get(ex['index']) or []
        rec['answers'] = prebind(parts, mine, why)
        if rec['answers']['status'] in ('orphan rows', 'out of order'):
            printed = printed_labels(shown, intro, segs)
            if printed and printed != [p['label'] for p in parts]:
                relabelled = [{**p, 'label': lab} for p, lab in zip(parts, printed)]
                again = prebind(relabelled, mine, why)
                if again['status'] == 'bound':
                    rec['labelsFromText'] = {'was': [p['label'] for p in parts], 'now': printed}
                    parts = relabelled
                    segs = move_section_heads(segs, printed)
                    rec['parts'] = [{'label': lab, 'text': s} for lab, s in zip(printed, segs)]
                    rec['answers'] = again
        if rec['answers']['status'] == 'bound':
            # Bound, but under labels the extractor took from formulas ("8",
            # "16", "A.88"): a row went to a neighbour's prefix and the part
            # it answers stayed empty. The printed labels are tried; they are
            # kept only if the key still binds whole, in order, and — judged
            # after the marks, below — answers more of the exercise's
            # last-level parts than the extractor's labels do, both passing.
            # (gs/2004 2/phy_en.pdf III: relabelled it passed with 2 of 4
            # parts where the original failed and showed the whole key.)
            printed = printed_labels(shown, intro, segs, nest=True)
            if printed and printed != [p['label'] for p in parts]:
                relabelled = [{**p, 'label': lab} for p, lab in zip(parts, printed)]
                again = prebind(relabelled, mine, why)
                if again['status'] == 'bound' and \
                        label_coverage(relabelled, again['bound']) > label_coverage(parts, rec['answers']['bound']):
                    rec['_alt'] = {'parts': relabelled, 'answers': again, 'printed': printed,
                                   'segs': move_section_heads(segs, printed)}
        if rec['answers']['status'] == 'orphan rows':
            grown = add_missing_sections(shown, intro, parts, segs, mine)
            if grown:
                more, more_segs, added = grown
                again = prebind(more, mine, why)
                if again['status'] == 'bound':
                    parts = more
                    rec['parts'] = [{'label': p['label'], 'text': s} for p, s in zip(more, more_segs)]
                    rec['answers'] = again
                    rec['sectionsAdded'] = added
        if rec['answers']['status'] != 'bound' and not why:
            # Last: the model's reading of which key row answers which part
            # (match_key_rows.py). It only points; the rows are the key's own,
            # and order, marks and belonging are judged exactly as above.
            matched = model_matches(sha)
            labels = {p['label'] for p in parts}
            mine_m = [{**r, 'exercise': ex['index'], 'tokens': placed_tokens(r['tokens'], matched[r['rid']][1])}
                      for r in rows or [] if r['rid'] in matched
                      and matched[r['rid']][0] == order + 1 and matched[r['rid']][1] in labels]
            texts = {p['label']: s for p, s in zip(parts, segs)}
            if len(mine_m) >= 2 and not ignores_named_rows(parts, texts, rows, mine_m, matched):
                again = prebind(parts, mine_m, why)
                if again['status'] == 'bound':
                    rec['answers'] = again
                    rec['matchedBy'] = 'model'
        out.append((rec, ex, parts))

    # The scale is voted by exercises bound by label; a model-placed one follows it.
    voters = [(item[0]['answers'], item[1]) for item in out
              if isinstance(item, tuple) and not item[0].get('matchedBy')]
    if not any(a.get('status') == 'bound' for a, _ in voters):
        # Every exercise placed by the model (gs/2005 2/math_en.pdf): they vote.
        voters = [(item[0]['answers'], item[1]) for item in out if isinstance(item, tuple)]
    scale = paper_scale(voters)
    final = []
    for item in out:
        if not isinstance(item, tuple):
            final.append(item)
            continue
        rec, ex, parts = item
        alt = rec.pop('_alt', None)
        pdf_path = ROOT / 'corpus' / 'exams' / exam['path'].replace('\\', '/')
        rec['answers'] = finish_answers(ex, parts, rec['answers'], scale, pdf_path, sha)
        if alt and rec['answers'].get('status') == 'ok':
            other = finish_answers(ex, alt['parts'], alt['answers'], scale, pdf_path, sha)
            # By share: "8" becoming "1.B" makes "1" a parent, so the count of
            # last-level parts changes with the labels.
            share = lambda a: a['leavesAnswered'] / a['leaves'] if a['leaves'] else 0  # noqa: E731
            if other.get('status') == 'ok' and share(other) > share(rec['answers']) \
                    and other['leavesAnswered'] >= rec['answers']['leavesAnswered']:
                rec['labelsFromText'] = {'was': [p['label'] for p in parts], 'now': alt['printed']}
                rec['parts'] = [{'label': lab, 'text': s} for lab, s in zip(alt['printed'], alt['segs'])]
                rec['answers'] = other
        final.append((rec, ex))

    check_belonging(exam, [(rec, ex) for rec, ex in (f for f in final if isinstance(f, tuple))], display)
    out, final = final, []
    for item in out:
        if not isinstance(item, tuple):
            final.append(item)
            continue
        rec, ex = item
        if rec['answers']['status'] == 'ok':
            for i, p in enumerate(rec['parts']):
                got = rec['answers']['byPart'].get(i)
                if got:
                    if got['marks'] is not None:
                        p['marks'] = got['marks']
                    if got['answer']:
                        p['answer'] = got['answer']
        elif rec['answers']['status'] in WHOLE_KEY_STATUSES and not (SIDECARS / f'{sha}.json').exists():
            # A paper whose maths key the scheme reader already took keeps it.
            key = whole_key(by_ex.get(ex['index']) or [], exam, ex['index'],
                            ROOT / 'corpus' / 'exams' / exam['path'].replace('\\', '/'), sha, display)
            if key:
                rec['wholeKey'] = key
        final.append(rec)
    return final


LATEX_COMMAND = re.compile(r'\\[a-zA-Z]+')
LAYOUT_COMMAND = re.compile(
    r'\\(?:mathrm|mathbf|text|operatorname|mathit|boldsymbol|overrightarrow|vec|left|right|begin|end'
    r'|frac|dfrac|sqrt|times|cdot|quad|qquad|Rightarrow|rightarrow|aligned|array|gathered)\b')
# Within this many (as a share of the answer's vocabulary) the own exercise
# wins. Measured on the 235 accepted exercises: 0.05 flags one correct set (an
# English paper whose key is printed in French) and catches 99% of simulated
# swaps between exercises of equal marks; 0 catches 99% and flags four.
BELONGING_MARGIN = 0.05


def vocabulary(text):
    """What identifies an exercise: its prose words, the names of its points
    and objects ("AB", "OABC", "PN"), and its data ("4000", "0.45").

    Prose alone flagged 12 correct exercises of 235: answers are mostly
    formulas, and the few words they have ("energy", "circuit") recur across
    a paper. The names and numbers are what an answer shares with its own
    statement and no other.
    """
    text = text or ''
    words = {w.lower() for w in WORD.findall(LATEX_COMMAND.sub(' ', text))}
    s = re.sub(r'[{}_^\\]', '', LAYOUT_COMMAND.sub(' ', text))
    names = set(re.findall(r'\b[A-Z]{2,5}\b', s))
    numbers = {n.replace(',', '.') for n in re.findall(r'\d+[.,]\d+|\d{2,}', s)}
    # The functions a maths exercise studies: "h(x)", "g(x)". Its answers name
    # little else, and gs/2009 1/math_en.pdf VI read like exercise I without them.
    bare = re.sub(r'\\(?:mathrm|mathbf|text|left|right)\s*|[{}]', '', text)
    functions = {m.group(1).lower() + '(x)' for m in re.finditer(r'\b([a-zA-Z])\s*\(\s*x\s*\)', bare)}
    return words | names | numbers | functions


def check_belonging(exam, answered, display=None):
    """Each exercise's answers must read most like that exercise.

    The marks gate cannot tell two exercises of equal worth apart, and their
    labels overlap ("1", "2", "3"…). gs/2013 1/math_en.pdf printed no heading
    the reader caught between exercises IV and V, both worth 3 points with
    parts 1–4, and V's probability answers were bound to IV's circle and
    similitude — and passed every check. Words settle it: the answers to a
    probability exercise talk about balls and urns.

    Words that half the paper's exercises share ("show", "deduce", "value")
    say nothing about which exercise they came from and are not counted.
    """
    texts = {}
    for order, e in enumerate(exam['exercises']):
        shown = (display or {}).get((exam['sha256'], order + 1), '')
        texts[e['index']] = vocabulary(' '.join(
            [e.get('title') or '', e.get('statement') or '', shown]
            + [p.get('text') or '' for p in e.get('parts') or []]))
    if len(texts) < 2:
        return
    seen = collections.Counter(w for v in texts.values() for w in v)
    common = {w for w, n in seen.items() if n >= max(2, len(texts) / 2)}
    for rec, ex in answered:
        a = rec['answers']
        if a.get('status') != 'ok':
            continue
        if rec.get('tableQuestions') and a.get('leavesAnswered') == a.get('leaves') == len(rec['parts']):
            # A multiple-choice table ranges over the whole syllabus, so its
            # words say little about which exercise it is. Its structure says
            # it instead: one answer row for each numbered question, no more.
            a['belonging'] = 'one row per question'
            continue
        words = vocabulary(' '.join(v['answer'] or '' for v in a['byPart'].values())) - common
        if len(words) < 6:
            a['belonging'] = 'too few words to check'
            continue
        score = {k: len(words & (v - common)) / len(words) for k, v in texts.items()}
        own = score.get(ex['index'], 0)
        rival_k, rival = max(((k, s) for k, s in score.items() if k != ex['index']), key=lambda t: t[1])
        a['belonging'] = {'own': round(own, 2), 'rival': rival_k, 'rivalScore': round(rival, 2)}
        if rival > own + BELONGING_MARGIN:
            rec['answers'] = {'status': 'answers read like another exercise',
                              'own': round(own, 2), 'rival': rival_k, 'rivalScore': round(rival, 2)}


def prebind(parts, rows, why):
    """Rows bound to parts, checked for orphans and order; the marks are judged per paper."""
    if why:
        return {'status': why}
    if not rows:
        return {'status': 'no rows for exercise'}
    bound, orphans = bind_rows(rows, parts)
    if orphans:
        return {'status': 'orphan rows', 'orphans': [r['label'] or r['answer'][:40] for r in orphans][:6]}
    order = [i for i, _ in bound]
    if any(b < a for a, b in zip(order, order[1:])):
        return {'status': 'out of order', 'order': [parts[i]['label'] for i in order]}
    return {'status': 'bound', 'bound': bound, 'sum': sum(r['marks'] or 0 for _, r in bound)}


def paper_scale(items):
    """The scale the scheme is printed on, relative to the paper's own marks.

    Usually 1. GS maths schemes are printed out of 40 for a paper marked out of
    20, so every exercise sums to twice its header. A scale other than 1 is
    accepted only when at least two exercises land on it independently: a
    misread moves one exercise, not several by the same factor.
    """
    ratios = collections.Counter()
    for a, ex in items:
        if a.get('status') == 'bound' and ex['marks']:
            ratios[round(a['sum'] / ex['marks'], 2)] += 1
    best = max((r for r in ratios if r != 1.0), key=lambda r: ratios[r], default=None)
    if best and best in (2.0, 0.5, 1.75, 1.5) and ratios[best] >= 2 and ratios[best] > ratios.get(1.0, 0):
        return best
    return 1.0


# What a scheme cell holds when its real answer is a graph Mathpix did not cut
# out ("t(s)", "Figure"), or a separator between two alternatives ("OU").
HOLLOW = re.compile(
    r'(?i)(?:ou|or|figure|fig\.?|graphe?|courbe|curve|voir\s+figure|see\s+figure)\.?'
    r'|[a-z]\s*\(\s*[a-z]{1,3}\s*\)')


# A drawn structural formula, which Mathpix writes as SMILES: `CC(=O)OC`.
# No student reads that, and a misread one ("[C-]") would look official.
SMILES = re.compile(r'`[^`\n]*[=()\[\]#@][^`\n]*`')


def hollow(answer):
    t = re.sub(r'\*\*[^*]{0,12}\*\*', ' ', answer)  # sub-labels: **a)**
    t = re.sub(r'\s+', ' ', t).strip()
    return not t or bool(HOLLOW.fullmatch(t)) or bool(SMILES.search(t))


def label_coverage(parts, bound):
    """Share of the exercise's last-level parts that a row answers, itself or through a parent."""
    labels = [p['label'] for p in parts]
    leaves = [l for l in labels if not any(m.startswith(l + '.') for m in labels)]
    hit = {parts[i]['label'] for i, _ in bound}
    covered = [l for l in leaves if any(l == h or l.startswith(h + '.') for h in hit)]
    return len(covered) / len(leaves) if leaves else 0.0


def label_only(answer, label_set):
    """An answer cell holding only this exercise's own labels: the label column, misread as answers."""
    words = answer.split()
    return bool(words) and all('.'.join(label_tokens(w)) in label_set for w in words)


# Markdown that must start its own line: display maths, a table, a list, an image.
BLOCK_START = re.compile(r'^(?:\$\$|\||[-*] |\d+[.)] |!\[)')


def labelled(label, md):
    """A sub-answer under its sub-label ("a)"). On one line, unless the answer
    opens a block: "**a)** $$" on one line is not display maths to Markdown."""
    if not label:
        return md
    head = f'**{label})**'
    return f'{head}\n\n{md}' if BLOCK_START.match(md.lstrip()) else f'{head} {md}'


def finish_answers(ex, parts, pre, scale, pdf_path, sha):
    if pre.get('status') != 'bound':
        return pre
    bound, total = pre['bound'], pre['sum']
    unmarked = False
    if not ex['marks'] or abs(total - ex['marks'] * scale) > 0.01:
        # A key whose marks did not survive the scan (gs/2009 1/physics_en.pdf
        # kept one of thirty) has nothing to add up. Its labels can still
        # vouch for it: rows for most of the parts, none for a part the paper
        # lacks, in printed order — and `check_belonging` reads the content.
        # Shown without marks, since none were read.
        # Likewise a key that read SOME of its marks: the rows are bound by
        # label, only a mark or two escaped the reader ("(1)" with no unit is
        # an equation number to it). Too few marks is a reading gap; too MANY
        # means another exercise's rows came in, and stays refused.
        stated = (ex['marks'] or 0) * scale
        if total < stated - 0.01 and len(bound) >= 2 and label_coverage(parts, bound) >= 0.5:
            unmarked = True
        else:
            return {'status': 'marks disagree', 'sum': round(total, 2), 'stated': ex['marks'], 'scale': scale}
    grouped = collections.OrderedDict()
    for i, r in bound:
        g = grouped.setdefault(i, {'chunks': [], 'marks': 0.0})
        sub = r['tokens'][len(label_tokens(parts[i]['label'])):]
        g['chunks'].append(('.'.join(sub).lower(), r['answer']))
        g['marks'] += (r['marks'] or 0) / scale
        g['shared'] = g.get('shared') or r.get('sharedMark', False)
    label_set = {'.'.join(label_tokens(p['label'])) for p in parts}
    if any(label_only(plain(r['answer']), label_set) for _, r in bound if r['answer'].strip()):
        return {'status': 'answers are labels'}
    by_part = {}
    figures_total = 0
    hollowed = 0
    for i, g in grouped.items():
        chunks, figures = answer_markdown(g['chunks'])
        figures_total += len(figures)
        text = '\n\n'.join(labelled(lab, md) for lab, md in chunks if md.strip() or lab)
        if figures:
            paths = cut_figures(pdf_path, sha, figures)
            for k, path in enumerate(paths):
                text = text.replace(f'[[figure:{k}]]', f'\n\n![]({path})\n\n' if path else '')
        text = re.sub(r'\n{3,}', '\n\n', text).strip()
        # Mathpix sometimes repeats a row: gs/2011 1/chem_fr.pdf III printed
        # 1.4's answer again as 1.5's. The copy answers nothing.
        repeated = len(text) >= 20 and any((v.get('answer') or '') == text for v in by_part.values())
        if hollow(text) or repeated:
            # The marks are still the paper's; only the answer is missing.
            hollowed += 1
            by_part[i] = {'answer': None, 'marks': None if unmarked or g.get('shared') else round(g['marks'], 2)}
            continue
        by_part[i] = {'answer': text, 'marks': None if unmarked or g.get('shared') else round(g['marks'], 2)}
    leaves = [i for i, p in enumerate(parts)
              if not any(q['label'].startswith(p['label'] + '.') for q in parts)]
    return {
        'status': 'ok', 'byPart': by_part, 'figures': figures_total, 'hollow': hollowed, 'unmarked': unmarked,
        'leavesAnswered': sum(1 for i in leaves if (by_part.get(i) or {}).get('answer')), 'leaves': len(leaves),
    }


C1_PATH = ROOT / 'corpus' / '.mapping' / 'positioned-structure.json'


def recover_display(display, exams_by_sha):
    """Clean text for exercises display_text.py refused, from lines it never tried.

    The line map records, beside each exercise's own lines, a lead-in (a
    document box printed above the exercise's title) and trailing lines.
    display_text.py reads the own lines only, so gs/2019/phy_en.pdf III lost
    "Doc. 5" — the text its questions ask about — and was refused for low
    recall, leaving the flattened text-layer formulas on screen. Each refused
    exercise is tried again with those lines added, through display_text's own
    `build` and every gate it applies. Returns {(sha, ordinal): markdown}.
    """
    import display_text as dt
    import position_structure as ps
    found = {}
    mapped = json.loads(C1_PATH.read_text(encoding='utf-8'))
    # A paper Mathpix read after the line map was built (gs/2013 2/phy_1.pdf,
    # sent 2026-10-03) is mapped here, in memory, the way the map maps any.
    have = {c['sha256'] for c in mapped}
    fresh = []
    for exam in exams_by_sha.values():
        if exam['sha256'] not in have and exam['path'].replace('\\', '/').startswith('gs/') and subject_of(exam['file']):
            got = ps.position_paper(exam)
            if got:
                fresh.append(got)
    for c1 in mapped + fresh:
        exam = exams_by_sha.get(c1['sha256'])
        if not exam or not c1['paper'].startswith('gs/'):
            continue
        new = c1 in fresh
        for c in c1['containers']:
            key = (c1['sha256'], c['ordinal'])
            if key in display:
                continue
            if new:
                try:
                    got = dt.build(c1, exam, c)
                except (IndexError, KeyError):
                    got = {}
                if got.get('verdict') == 'ok' and got.get('markdown'):
                    found[key] = got['markdown']
                    continue
            lead, trail = c.get('leadInSpans') or [], c.get('trailingSpans') or []
            # A paper's last exercise can run on into the key: its words are all
            # there but a third of what follows is answers (precision 0.33).
            # Cut at the key's first page.
            paper_pages = (exam.get('pages') or 0) - (exam.get('schemePages') or 0)
            own = [s for s in c['spans'] if not paper_pages or s['page'] <= paper_pages]
            for spans in (lead + c['spans'], c['spans'] + trail, lead + c['spans'] + trail, own, lead + own):
                if spans == c['spans']:
                    continue
                try:
                    got = dt.build(c1, exam, {**c, 'spans': spans})
                except (IndexError, KeyError):
                    continue
                if got.get('verdict') == 'ok' and got.get('markdown'):
                    found[key] = got['markdown']
                    break
    return found


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--track', default='gs')
    ap.add_argument('--show', nargs=2, metavar=('PAPER', 'EXERCISE'))
    ap.add_argument('--out', default=str(OUT))
    args = ap.parse_args()

    exams = json.loads(EXAMS.read_text(encoding='utf-8'))
    display = {}
    for d in json.loads(DISPLAY.read_text(encoding='utf-8')):
        if d.get('verdict') == 'ok' and d.get('markdown'):
            display[(d['sha256'], d['ordinal'])] = d['markdown']
    recovered = recover_display(display, {e['sha256']: e for e in exams})
    display.update(recovered)
    print(f'clean text recovered for {len(recovered)} exercise(s) display_text.py had refused')

    if args.show:
        exam = next(e for e in exams if e['path'].replace('\\', '/') == args.show[0])
        rec = build_paper(exam, display)[int(args.show[1]) - 1]
        print(json.dumps({k: v for k, v in rec.items() if k != 'answers'}, ensure_ascii=False, indent=1)[:6000])
        a = rec.get('answers') or {}
        print(json.dumps({k: v for k, v in a.items() if k != 'byPart'}, ensure_ascii=False))
        return

    papers = []
    tally = collections.defaultdict(collections.Counter)
    for exam in exams:
        path = exam['path'].replace('\\', '/')
        subject = subject_of(exam['file'])
        if not path.startswith(args.track + '/') or not subject:
            continue
        if ADAPTED.search(exam['file']) or ARABIC_EDITION.search(exam['file']) or exam['language'] == 'ar':
            continue
        exercises = build_paper(exam, display)
        papers.append({'paper': path, 'sha256': exam['sha256'], 'subject': subject,
                       'language': exam['language'], 'exercises': exercises})
        key = f"{subject}/{exam['language']}"
        for e in exercises:
            tally[key]['exercises'] += 1
            tally[key]['status: ' + e['status']] += 1
            if e['status'] == 'split':
                tally[key]['answers: ' + e['answers']['status']] += 1
                tally[key]['whole answer key shown instead'] += bool(e.get('wholeKey'))
                if e['answers']['status'] == 'ok':
                    tally[key]['leaves'] += e['answers']['leaves']
                    tally[key]['leaves answered'] += e['answers']['leavesAnswered']
                    tally[key]['answer figures'] += e['answers']['figures']
                    tally[key]['hollow answers dropped'] += e['answers'].get('hollow', 0)
                    tally[key]['ok without marks (some or all unread)'] += bool(e['answers'].get('unmarked'))

    Path(args.out).write_text(json.dumps(papers, ensure_ascii=False, indent=1), encoding='utf-8')
    for key in sorted(tally):
        print(key)
        for k, v in sorted(tally[key].items()):
            print(f'   {k:28} {v}')
    print(f'\nwrote {args.out}: {len(papers)} papers')


if __name__ == '__main__':
    main()
