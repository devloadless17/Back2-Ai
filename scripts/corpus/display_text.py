"""
Display text for each science exercise, built from its own Mathpix lines.

    python scripts/corpus/display_text.py            # writes corpus/.mapping/display-text.json
    python scripts/corpus/display_text.py --show "gs/2018 2/math_fr.pdf" 6

WHY. A question's stored text came from the PDF's text layer. On a science
paper that layer is wreckage: exponents land on the next line, fractions are
flattened, vector arrows and Greek letters vanish. The viewer renders Markdown
and KaTeX correctly; it was being handed text with no formulas left in it.

Mathpix read the same pages as images and wrote the formulas back as LaTeX.
Its text is NOT trusted for structure — its Arabic is destructive and its
reading order is its own — so this never decides where an exercise starts or
ends. C1 (positioned-structure.json) already did that against the canonical
extractor. This only reads the lines C1 placed inside an exercise's statement
span and turns them into Markdown the viewer can render.

WHAT IS REFUSED, not guessed:
  - C1 alignment below STRONG, or a container that shares its first printed
    line with another (no position finer than that line exists);
  - a container that starts inside the marking scheme;
  - Arabic papers, and any output that carries Arabic;
  - output whose words do not cover the canonical statement (recall), or that
    carries many words the statement does not have (precision) — the second
    catches a span that ran into the scheme or the next exercise.

A refused exercise keeps the text it has. The KaTeX gate runs in the loader
(load-display-text.ts), with the page's own parser.
"""
import collections
import json
import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')

C1_PATH = Path('corpus/.mapping/positioned-structure.json')
EXAMS_PATH = Path('corpus/exams.json')
OUT_PATH = Path('corpus/.mapping/display-text.json')

MIN_RECALL = 0.85
MIN_PRECISION = 0.80
ARABIC = re.compile(r'[\u0600-\u06FF]')


# --------------------------------------------------------------------------
# Brace-aware scanning
# --------------------------------------------------------------------------

def group_end(s, i):
    """s[i] == '{'. Index just past its matching '}', or -1."""
    depth = 0
    j = i
    while j < len(s):
        ch = s[j]
        if ch == '\\':
            j += 2
            continue
        if ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                return j + 1
        j += 1
    return -1


def replace_command(s, name, fn, nargs=1, optional=False):
    """Replace every \\name[opt]{a}{b}... with fn(args). Brace-balanced."""
    pat = re.compile(r'\\' + re.escape(name) + r'(?![A-Za-z])\*?')
    out = []
    pos = 0
    while True:
        m = pat.search(s, pos)
        if not m:
            out.append(s[pos:])
            return ''.join(out)
        j = m.end()
        opt = None
        if optional and j < len(s) and s[j] == '[':
            k = s.find(']', j)
            if k < 0:
                out.append(s[pos:])
                return ''.join(out)
            opt = s[j + 1:k]
            j = k + 1
        args = []
        ok = True
        for _ in range(nargs):
            while j < len(s) and s[j] in ' \t':
                j += 1
            if j >= len(s) or s[j] != '{':
                ok = False
                break
            e = group_end(s, j)
            if e < 0:
                ok = False
                break
            args.append(s[j + 1:e - 1])
            j = e
        if not ok:
            out.append(s[pos:m.end()])
            pos = m.end()
            continue
        out.append(s[pos:m.start()])
        out.append(fn(args, opt) if optional else fn(args))
        pos = j


def split_top(s, sep):
    """Split on `sep` ('\\\\' or '&') outside maths and outside braces."""
    parts = []
    buf = []
    depth = 0
    math = False
    i = 0
    while i < len(s):
        ch = s[i]
        if ch == '\\':
            if sep == '\\\\' and s.startswith('\\\\', i) and depth == 0 and not math:
                parts.append(''.join(buf))
                buf = []
                i += 2
                # optional spacing: \\[2pt]
                m = re.match(r'\[[^\]]*\]', s[i:])
                if m:
                    i += m.end()
                continue
            buf.append(s[i:i + 2])
            i += 2
            continue
        if ch == '$':
            math = not math
            if s.startswith('$$', i):
                buf.append('$$')
                i += 2
                continue
        elif ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
        elif ch == '&' and sep == '&' and depth == 0 and not math:
            parts.append(''.join(buf))
            buf = []
            i += 1
            continue
        buf.append(ch)
        i += 1
    parts.append(''.join(buf))
    return parts


# --------------------------------------------------------------------------
# Tables
# --------------------------------------------------------------------------

TAB_BEGIN = re.compile(r'\\begin\{tabular\}(\[[^\]]*\])?')
TAB_END = '\\end{tabular}'


def find_tabular(s, start=0):
    """(begin, bodyStart, bodyEnd, end) of the first tabular at/after start, nesting-aware."""
    m = TAB_BEGIN.search(s, start)
    if not m:
        return None
    j = m.end()
    if j < len(s) and s[j] == '{':
        e = group_end(s, j)
        if e < 0:
            return None
        j = e
    body_start = j
    depth = 1
    k = j
    while depth:
        nb = TAB_BEGIN.search(s, k)
        ne = s.find(TAB_END, k)
        if ne < 0:
            return None
        if nb and nb.start() < ne:
            depth += 1
            k = nb.end()
        else:
            depth -= 1
            k = ne + len(TAB_END)
    return m.start(), body_start, k - len(TAB_END), k


def inline_math(cell):
    """A cell is one line: display maths becomes inline, newlines become spaces."""
    cell = re.sub(r'\$\$(.+?)\$\$', lambda m: '$' + m.group(1).strip() + '$', cell, flags=re.S)
    return re.sub(r'\s*\n\s*', ' ', cell).strip()


def escape_pipes(cell):
    """No `|` may reach a GFM row: in maths it is \\vert, in prose \\|."""
    out = []
    for k, piece in enumerate(re.split(r'(\$[^$]*\$)', cell)):
        if k % 2:
            piece = piece.replace('\\|', '\\Vert ').replace('|', '\\vert ')
        else:
            piece = piece.replace('|', '\\|')
        out.append(piece)
    return ''.join(out)


def clean_cell(cell):
    cell = re.sub(r'\\hline|\\cline\{[^}]*\}', ' ', cell)
    cell = re.sub(r'\\multirow\[[^\]]*\]', r'\\multirow', cell)
    cell = replace_command(cell, 'multirow', lambda a: a[2], nargs=3)
    # a diagonal header cell: row label and column label in one corner
    for cmd in ('backslashbox', 'slashbox'):
        cell = replace_command(cell, cmd, lambda a: a[0].strip() + ' / ' + a[1].strip(), nargs=2)
    cell = re.sub(r'!\[[^\]]*\]\([^)]*\)', ' ', cell)
    cell = inline_blocks(cell)
    return escape_pipes(inline_math(cell))


def flatten_tabular(body):
    """A tabular nested in a cell: its rows run on one line."""
    rows = [' '.join(clean_cell(c) for c in split_top(r, '&')) for r in split_top(body, '\\\\')]
    return ' '.join(r.strip() for r in rows if r.strip())


def table_to_gfm(body):
    rows = []
    for raw in split_top(body, '\\\\'):
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
            cells.append(clean_cell(c))
            cells.extend([''] * (span[0] - 1))
        rows.append(cells)
    if not rows:
        return ''
    width = max(len(r) for r in rows)
    rows = [r + [''] * (width - len(r)) for r in rows]
    lines = ['| ' + ' | '.join(rows[0]) + ' |', '|' + '---|' * width]
    lines += ['| ' + ' | '.join(r) + ' |' for r in rows[1:]]
    return '\n\n' + '\n'.join(lines) + '\n\n'


def convert_tables(s):
    # innermost first: a tabular with no tabular inside it
    while True:
        spans = []
        pos = 0
        while True:
            t = find_tabular(s, pos)
            if not t:
                break
            spans.append(t)
            pos = t[3]
        if not spans:
            return s
        out = []
        pos = 0
        for b, bs, be, e in spans:
            inner = s[bs:be]
            while True:  # flatten nested tabulars inside this one
                n = find_tabular(inner)
                if not n:
                    break
                inner = inner[:n[0]] + flatten_tabular(inner[n[1]:n[2]]) + inner[n[3]:]
            out.append(s[pos:b])
            out.append(table_to_gfm(inner))
            pos = e
        out.append(s[pos:])
        s = ''.join(out)


# --------------------------------------------------------------------------
# Blocks and inline markup
# --------------------------------------------------------------------------

def caption_of(block):
    m = re.search(r'\\caption\{', block)
    if not m:
        return ''
    e = group_end(block, m.end() - 1)
    return block[m.end():e - 1].strip() if e > 0 else ''


def inline_blocks(s):
    """Markup that can sit inside a cell as well as in prose."""
    s = replace_command(s, 'textbf', lambda a: '**' + a[0].strip() + '**')
    s = replace_command(s, 'textit', lambda a: '*' + a[0].strip() + '*')
    s = replace_command(s, 'emph', lambda a: '*' + a[0].strip() + '*')
    s = replace_command(s, 'underline', lambda a: a[0])
    s = replace_command(s, 'footnote', lambda a: ' (' + a[0].strip() + ')')
    s = replace_command(s, 'footnotetext', lambda a: '\n' + a[0].strip())
    s = re.sub(r'<smiles>(.*?)</smiles>', lambda m: '`' + m.group(1) + '`', s, flags=re.S)
    s = re.sub(r'\\begin\{(itemize|enumerate)\}|\\end\{(itemize|enumerate)\}', '\n', s)
    s = re.sub(r'\\item\[([^\]]*)\]\s*', lambda m: '\n' + (m.group(1).strip() + ' ' if m.group(1).strip() else ''), s)
    s = re.sub(r'\\item\s*', '\n- ', s)
    return s


def figure_blocks(s, env):
    def repl(m):
        cap = caption_of(m.group(0))
        return f'\n\n*{cap}*\n\n' if cap else '\n'
    return re.sub(r'\\begin\{' + env + r'\}.*?\\end\{' + env + r'\}', repl, s, flags=re.S)


def heading(args):
    """A section title; a `\\\\` inside it is a second printed line, set bold too."""
    lines = [re.sub(r'\s+', ' ', part).strip() for part in split_top(args[0], '\\\\')]
    return '\n\n' + '\n'.join(f'**{l}**' for l in lines if l) + '\n\n'


def to_markdown(raw):
    s = raw
    s = figure_blocks(s, 'figure')
    s = re.sub(r'!\[[^\]]*\]\([^)]*\)', '', s)
    # a table environment wraps a tabular and may carry a caption
    def table_env(m):
        block = m.group(0)
        cap = caption_of(block)
        block = re.sub(r'\\begin\{table\}(\[[^\]]*\])?|\\end\{table\}|\\centering', '', block)
        block = replace_command(block, 'captionsetup', lambda a: '')
        block = replace_command(block, 'caption', lambda a: '')
        return block + (f'\n\n*{cap}*\n\n' if cap else '')
    s = re.sub(r'\\begin\{table\}.*?\\end\{table\}', table_env, s, flags=re.S)
    s = convert_tables(s)
    for cmd in ('section', 'subsection', 'subsubsection', 'title'):
        s = replace_command(s, cmd, heading)
    s = inline_blocks(s)
    s = re.sub(r'\\(author|date)\{[^}]*\}', '', s)
    # A multi-line $$…$$ must stand as its own block. Left mid-paragraph it is
    # inline maths, and Markdown still reads its inner lines as blocks: a line
    # starting "- " or "1." opens a list and cuts the formula in half.
    s = re.sub(r'\$\$(.+?)\$\$',
               lambda m: '\n\n$$\n' + m.group(1).strip() + '\n$$\n\n' if '\n' in m.group(1) else m.group(0),
               s, flags=re.S)
    # A table printed as a list item ("- | a | b |") is not a table to
    # Markdown. The table gets its own block; a label other than a bare bullet
    # stays on the line above it.
    def lift_table(m):
        label = m.group(1).strip()
        head = '' if label in ('', '-') else label + '\n'
        return head + '\n' + m.group(2) + '\n' + m.group(3)
    s = re.sub(r'^([^\n|]*[^\s|][^\n|]*?)[ \t]*(\|[^\n]*\|)\n(\|(?:---\|)+)$', lift_table, s, flags=re.M)
    # paragraph hygiene
    s = re.sub(r'[ \t]+\n', '\n', s)
    s = re.sub(r'\n{3,}', '\n\n', s)
    return s.strip()


FOOTER = re.compile(r'^\s*(\d{1,2}|page\s*\d+(\s*/\s*\d+)?|\d+\s*/\s*\d+|-+\s*\d+\s*-+)\s*$', re.I)


# --------------------------------------------------------------------------
# Coverage
# --------------------------------------------------------------------------

def words(text):
    text = re.sub(r'\\[A-Za-z]+', ' ', text)
    return collections.Counter(re.findall(r'[^\W\d_]{3,}', text.lower()))


def coverage(md, canonical):
    a, b = words(md), words(canonical)
    common = sum((a & b).values())
    recall = common / max(1, sum(b.values()))
    precision = common / max(1, sum(a.values()))
    return round(recall, 3), round(precision, 3)


# --------------------------------------------------------------------------

def lines_of(sha):
    d = json.loads((Path('corpus/meta') / sha / 'lines.json').read_text(encoding='utf-8'))
    return [str(l.get('text') or '') for pg in d['pages'] for l in pg['lines']]


def build(paper, exam, container):
    ex = exam['exercises'][container['ordinal'] - 1]
    # Arabic page furniture (the ministry header) sits in the canonical text of
    # some EN/FR papers; it is never exercise content.
    canonical = ARABIC.sub(' ', '\n'.join(x for x in (ex.get('title'), ex.get('statement')) if x))
    rec = {
        'paper': paper['paper'], 'sha256': paper['sha256'], 'ordinal': container['ordinal'],
        'index': ex.get('index'), 'status': container['alignment']['status'],
    }
    if paper['language'] == 'ar':
        return {**rec, 'verdict': 'refused', 'reason': 'arabic paper'}
    if container['alignment']['status'] not in ('EXACT', 'STRONG'):
        return {**rec, 'verdict': 'refused', 'reason': f"C1 {container['alignment']['status']}"}
    if 'shares its first printed line' in container['alignment']['evidence']:
        return {**rec, 'verdict': 'refused', 'reason': 'shared first line'}
    if container['startsInScheme']:
        return {**rec, 'verdict': 'refused', 'reason': 'starts in scheme'}
    L = lines_of(paper['sha256'])
    idx = sorted({i for s in container['spans'] for i in range(s['lineFrom'], s['lineTo'] + 1)})
    raw = ''.join(L[i] for i in idx if not FOOTER.match(L[i]))
    md = to_markdown(raw)
    if ARABIC.search(md):
        return {**rec, 'verdict': 'refused', 'reason': 'arabic in output'}
    recall, precision = coverage(md, canonical)
    rec.update(recall=recall, precision=precision, markdown=md)
    if recall < MIN_RECALL:
        return {**rec, 'verdict': 'refused', 'reason': 'low recall'}
    if precision < MIN_PRECISION:
        return {**rec, 'verdict': 'refused', 'reason': 'low precision'}
    return {**rec, 'verdict': 'ok'}


def main():
    c1 = json.loads(C1_PATH.read_text(encoding='utf-8'))
    exams = {e['sha256']: e for e in json.loads(EXAMS_PATH.read_text(encoding='utf-8'))}
    if '--show' in sys.argv:
        i = sys.argv.index('--show')
        want, ordinal = sys.argv[i + 1], int(sys.argv[i + 2])
        p = next(p for p in c1 if p['paper'] == want)
        r = build(p, exams[p['sha256']], p['containers'][ordinal - 1])
        print({k: v for k, v in r.items() if k != 'markdown'})
        print(r.get('markdown', ''))
        return
    out = []
    for p in c1:
        exam = exams.get(p['sha256'])
        if not exam or p['language'] == 'ar':
            continue
        if len(exam['exercises']) != len(p['containers']):
            out.extend({'paper': p['paper'], 'sha256': p['sha256'], 'ordinal': c['ordinal'],
                        'verdict': 'refused', 'reason': 'exercise count differs'} for c in p['containers'])
            continue
        for c in p['containers']:
            out.append(build(p, exam, c))
    OUT_PATH.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding='utf-8')
    tally = collections.Counter(r['verdict'] if r['verdict'] == 'ok' else r['reason'] for r in out)
    print(f'{len(out)} exercises -> {OUT_PATH}')
    for k, v in tally.most_common():
        print(f'  {v:5d}  {k}')


if __name__ == '__main__':
    main()
