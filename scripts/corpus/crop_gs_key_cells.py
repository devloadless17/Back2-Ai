# -*- coding: utf-8 -*-
"""
Answers the key DRAWS, cut from the key page: GS science parts whose key row
paper_parts.py dropped as hollow ("Figure", "t(min)", a graph) or as a
structural formula Mathpix wrote as SMILES.

    python scripts/corpus/crop_gs_key_cells.py            # report
    python scripts/corpus/crop_gs_key_cells.py --write    # cut, write corpus/gs-key-cell-crops.json
    python scripts/corpus/crop_gs_key_cells.py --track ls --write   # reads ls-paper-parts.json

A crop is cut only from a ruled table in the PDF's own text layer, and only
when it can be placed without doubt: the row's label cell reads exactly the
row's label, once, under the exercise's own heading on the key pages. The
answer cells (between the label and the mark) must hold a drawing — lines,
curves or an image — not only the word: gs/2016 2/phy_en.pdf B.1's key
prints "Figure" and nothing else, so the original has no answer to show,
and the part is reported as missing in the original instead.

No model, network or database. Output is read by load-paper-parts.ts, which
puts the image under the part as its `answerImage`.
"""
import argparse
import collections
import contextlib
import hashlib
import io
import json
import logging
import re
import sys
from pathlib import Path

import pdfplumber

logging.getLogger('pdfminer').setLevel(logging.ERROR)
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, str(Path(__file__).parent))

import paper_parts as pp  # noqa: E402

ROOT = pp.ROOT


def paths(track):
    """The parts read, the crops written, and the side files, for a track.

    GS keeps the files it was built with. Another track reads its own
    `<track>-paper-parts.json` (paper_parts.py --track … --out …).
    """
    mapping = ROOT / 'corpus' / '.mapping'
    parts = mapping / ('paper-parts.json' if track == 'gs' else f'{track}-paper-parts.json')
    return {
        'parts': parts,
        'out': ROOT / 'corpus' / f'{track}-key-cell-crops.json',
        # Answers the page's renderer refused (a tabular inside a table cell, broken
        # maths): written by `load-paper-parts.ts --refused-out`. Cut like a drawing.
        'refused': mapping / f'{track}-refused-answers.json',
        # Parts whose key row is only the word ("Figure"): no answer in the original.
        'no_drawing': mapping / f'{track}-key-no-drawing.json',
    }
FIGURES = ROOT / 'public' / 'answer-figures'
SCALE = 2  # render scale: 144 dpi

ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI']
ORD_EN = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth']
ORD_FR = ['premier', 'deuxi[eè]me', 'troisi[eè]me', 'quatri[eè]me', 'cinqui[eè]me', 'sixi[eè]me']


def heading_number(line):
    """The exercise a key line opens, 1-based, or None."""
    for k in range(6):
        if re.search(rf'(?i)\bexerci[cs]e\s*(?:n[°o]\s*)?(?:{k + 1}|{ROMAN[k]})\b|\b{ORD_EN[k]}\s+exercise\b'
                     rf'|\b{ORD_FR[k]}\s+exercice\b', line):
            return k + 1
    return None


def norm_label(text):
    return '.'.join(pp.label_tokens(text or ''))


def hollow_rows(paper, exercise, part_label, rows, refused=False):
    """The key rows of this part that paper_parts dropped as drawn, or whose
    text the page cannot show."""
    want = pp.label_tokens(part_label)
    out = []
    for r in rows:
        if r.get('exercise') != exercise or not r['tokens']:
            continue
        t = tuple(r['tokens'])
        if t[-len(want):] != want and t[:len(want)] != want:
            continue
        md = pp.answer_markdown([('', r['answer'])])[0][0][1]
        if refused:
            out.append({**r, 'formula': True})  # set in type: the cell's characters are the answer
        elif pp.hollow(md):
            out.append({**r, 'formula': bool(pp.SMILES.search(md))})
    return out


def key_lines(pdf, first, last):
    """(page index, top, text) of each text line on the key pages."""
    out = []
    for i in range(first, last):
        words = pdf.pages[i].extract_words(keep_blank_chars=False)
        lines = collections.defaultdict(list)
        for w in words:
            lines[round(w['top'] / 3)].append(w)
        for key in sorted(lines):
            ws = sorted(lines[key], key=lambda w: w['x0'])
            out.append((i, ws[0]['top'], ' '.join(w['text'] for w in ws)))
    return out


def find_cell(pdf, exam, ordinal, row_label, formula):
    """(page index, box) of the row's answer cells, or the reason it is not placed."""
    n = exam.get('schemePages') or 0
    # Where paper_parts read the key: from a key table found earlier than the
    # splitter's pages, or found where the splitter saw none (ls/2016 1/bio_en.pdf).
    missed = pp.missed_key_start(exam)
    if not n and not missed:
        return None, 'no key pages'
    first = missed - 1 if missed else exam['pages'] - n
    lines = key_lines(pdf, first, exam['pages'])
    if not lines:
        return None, 'key is a scan'
    heads = [(i, top, heading_number(t)) for i, top, t in lines if heading_number(t)]
    starts = [(i, top) for i, top, k in heads if k == ordinal]
    if not starts:
        return None, 'exercise heading not found'
    # A heading printed twice (a running title): the first opens the exercise;
    # the row must still be found exactly once before the next one.
    start = starts[0]
    after = [(i, top) for i, top, k in heads if k == ordinal + 1 and (i, top) > start]
    end = after[0] if after else (exam['pages'], 0)
    want = norm_label(row_label)
    hits = []
    for i in range(start[0], min(end[0] + 1, exam['pages'])):
        page = pdf.pages[i]
        for table in page.find_tables():
            for row in table.rows:
                top = float(row.bbox[1])
                if (i, top) < start or (i, top) >= end:
                    continue
                cells = [c for c in row.cells]
                if len(cells) < 3 or not cells[0]:
                    continue
                label = (page.crop(cells[0]).extract_text() or '').strip()
                if norm_label(label) != want or not label:
                    continue
                middle = [c for c in cells[1:-1] if c]
                if not middle:
                    continue
                box = tuple(float(v) for v in (min(c[0] for c in middle), row.bbox[1],
                                               max(c[2] for c in middle), row.bbox[3]))
                hits.append((i, box))
    if len(hits) != 1:
        return None, f'row found {len(hits)} times'
    i, box = hits[0]
    if not holds_answer(pdf.pages[i], box):
        # gs/2019/chem_eng.pdf 2.5: the row opens empty at the foot of a page
        # and its answer is the label-less row heading the next page.
        nxt = continuation(pdf, i, box)
        if nxt and holds_answer(pdf.pages[nxt[0]], nxt[1]):
            return nxt, None
        return None, 'the key prints no answer here'
    return (i, box), None


# What a cell says when its real answer is a drawing it does not contain.
ARABIC = re.compile(r'[؀-ۿﭐ-﷿ﹰ-﻿]')
BARE_WORDS = re.compile(r'(?i)\b(?:see|voir)\b|\bfig(?:ure)?\.?|\bgraphe?\b|\bcourbe\b|\bcurve\b'
                        r'|\b[a-z]\s*\(\s*[a-z]{1,3}\s*\)')


def holds_answer(page, box):
    """The answer cells hold more than the word "Figure": text, or a drawing."""
    region = page.crop(box)
    text = BARE_WORDS.sub(' ', region.extract_text() or '')
    if len(re.findall(r'\w', text)) >= 6:
        return True  # an answer set in type: words, a formula, a table
    lines = [{k: float(l[k]) for k in ('x0', 'x1', 'top', 'bottom')} for l in region.lines]
    # Short lines are the table's own rules; a drawing has curves, an image,
    # or strokes inside the cell.
    strokes = [l for l in lines if 2 < abs(l['x1'] - l['x0']) < (box[2] - box[0]) * 0.9
               and abs(l['bottom'] - l['top']) < (box[3] - box[1]) * 0.9]
    return bool(region.curves or region.images) or len(strokes) >= 2


def continuation(pdf, i, box):
    """The first row of the next page's table, when it has no label of its own."""
    if i + 1 >= len(pdf.pages) or float(pdf.pages[i].height) - box[3] > 60:
        return None
    page = pdf.pages[i + 1]
    tables = sorted(page.find_tables(), key=lambda t: float(t.bbox[1]))
    for table in tables:
        if ARABIC.search(page.crop(table.bbox).extract_text() or ''):
            continue  # the ministry's header, printed on every page
        row = table.rows[0]
        cells = row.cells
        if len(cells) < 3 or not cells[0]:
            continue
        if (page.crop(cells[0]).extract_text() or '').strip():
            return None
        middle = [c for c in cells[1:-1] if c]
        if middle:
            return i + 1, tuple(float(v) for v in (min(c[0] for c in middle), row.bbox[1],
                                                   max(c[2] for c in middle), row.bbox[3]))
    return None


def cut(path, page_index, box, name):
    import pypdfium2 as pdfium
    pdf = pdfium.PdfDocument(str(path))
    img = pdf[page_index].render(scale=SCALE).to_pil()
    pad = 2
    crop = img.crop((max(0, (box[0] - pad) * SCALE), max(0, (box[1] - pad) * SCALE),
                     (box[2] + pad) * SCALE, (box[3] + pad) * SCALE))
    FIGURES.mkdir(parents=True, exist_ok=True)
    crop.save(FIGURES / name, 'WEBP', quality=88)
    return f'/answer-figures/{name}'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--write', action='store_true')
    ap.add_argument('--track', default='gs')
    args = ap.parse_args()
    files = paths(args.track)
    meta = {e['path'].replace('\\', '/'): e for e in json.loads(pp.EXAMS.read_text(encoding='utf-8'))}
    papers = [p for p in json.loads(files['parts'].read_text(encoding='utf-8')) if p['paper'].startswith(args.track + '/')]
    crops, missing, unplaced = [], [], collections.Counter()
    refused = {(r['paper'], r['index'], r['label']) for r in json.loads(files['refused'].read_text(encoding='utf-8'))} \
        if files['refused'].exists() else set()
    for p in papers:
        exam = meta[p['paper']]
        todo = [(e, part) for e in p['exercises'] for part in e.get('parts') or []
                if (not part.get('answer') or (p['paper'], e['index'], part['label']) in refused) and not any(q['label'].startswith(part['label'] + '.')
                                                      for q in e.get('parts') or [])]
        if not todo:
            continue
        with contextlib.redirect_stdout(io.StringIO()):
            rows, _ = pp.paper_rows(exam)
        rows = rows or []
        path = ROOT / 'corpus' / 'exams' / p['paper']
        with pdfplumber.open(str(path)) as pdf:
            for e, part in todo:
                drawn = hollow_rows(p['paper'], e['index'], part['label'], rows,
                                    (p['paper'], e['index'], part['label']) in refused)
                if len(drawn) != 1:
                    continue
                r = drawn[0]
                got, why = find_cell(pdf, exam, e['ordinal'], r['label'], r['formula'])
                where = f"{p['paper']} ex{e['ordinal']} {part['label']}"
                if not got:
                    unplaced[why] += 1
                    if why == 'the key prints no answer here':
                        missing.append({'paper': p['paper'], 'index': e['index'], 'label': part['label'], 'where': where})
                    continue
                page_index, box = got
                name = (f"{exam['sha256'][:12]}-{args.track}key-p{page_index + 1}-e{e['index']}-"
                        f"{re.sub(r'[^a-z0-9]+', '-', part['label'].lower()).strip('-')}.webp")
                image = cut(path, page_index, box, name) if args.write else f'/answer-figures/{name}'
                crops.append({'paper': p['paper'], 'index': e['index'], 'label': part['label'], 'image': image,
                              'page': page_index + 1, 'box': [round(v, 1) for v in box]})
    print(f'cut: {len(crops)}')
    for k, v in unplaced.most_common():
        print(f'not placed — {k}: {v}')
    print('in the original, no answer to show:')
    for m in missing:
        print('   ', m['where'])
    if args.write:
        files['out'].write_text(json.dumps(crops, ensure_ascii=False, indent=1), encoding='utf-8')
        files['no_drawing'].write_text(json.dumps(missing, ensure_ascii=False, indent=1), encoding='utf-8')
        print(f"wrote {files['out']}")
    else:
        for c in crops[:40]:
            print('   ', c['paper'], c['index'], c['label'], c['page'], c['box'])


if __name__ == '__main__':
    main()
