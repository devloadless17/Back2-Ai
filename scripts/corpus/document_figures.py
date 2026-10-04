# -*- coding: utf-8 -*-
r"""
A paper's documents as the paper prints them: each "Document-1" box or figure
cut from the PDF page and shown where its caption stands.

    python scripts/corpus/document_figures.py --track ls --rows rows.csv           # report
    python scripts/corpus/document_figures.py --track ls --rows rows.csv --write   # rewrites the parts file

WHY. Mathpix keeps a boxed document's words but not its box: the Azicin
leaflet of se/2021 1/SELH_Chim_2021_1_En_0.pdf (Document-1) showed as loose
lines run into the exercise's introduction, its caption "Document-1" left
hanging, and graphs captioned "Doc. 1" showed nothing at all. Where the
database holds a picture for the exercise (question_visuals) the page shows
that, so only exercises with none are touched: `--rows` is a CSV of
id, source_ref, subject_id, visuals (one row per question with parts).

WHAT IS CUT. A caption standing alone on its line in the PDF's text layer,
inside the exercise's own span (positioned-structure.json):
  - inside a drawn box (a rect, or four thin strips): the box, words and all;
  - under a figure: the images and drawings just above the caption, caption
    included. Refused when prose sits beside it or a question is inside it.
The text keeps the picture where the caption was. The lines just before it
that the picture shows (a box's text, a table's rows and rules, a formula
read as SMILES) go, and so do short labels just after it ("Set b"). A
question, or a sentence naming the document, always stays.
Nothing found, nothing changed. No model, no network, no database.

WHEN. After paper_parts.py rebuilds a parts file, run this again, or the
pictures are lost. A second run changes nothing. rows.csv comes from:
  \copy (select q.id, q.source_ref, c.subject_id, (select count(*) from
  question_visuals v where v.question_id = q.id) as visuals from questions q
  join exam_cycles c on c.id = q.source_exam_id where q.verified_status <>
  'rejected' and q.paper_parts is not null and q.source_ref is not null)
  to 'rows.csv' with csv header
"""
import argparse
import csv
import hashlib
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
FIGURES = ROOT / 'public' / 'answer-figures'
SCALE = 2
# A caption on its own line: "Document-1", "Document 2", "Doc. 3", "*Doc. 1*".
CAPTION_LINE = re.compile(r'(?m)^[ \t]*[*_]{0,2}((?:Document|Doc\.?)\s*[-–]?\s*(\d{1,2}))[*_]{0,2}[ \t]*$')
TOKEN = re.compile(r'[a-zà-ÿ]+|\d+(?:[.,]\d+)?')
# A structural formula the text reader wrote as SMILES: `CCCC=CCCC(=O)OC...`
SMILES_LINE = re.compile(r'\s*`[A-Za-z0-9@+\-\[\]()=#$/\.%]+`\s*')
# A markdown table's rule line: |---|---|
TABLE_RULE = re.compile(r'^\s*\|?(?:\s*:?-{2,}:?\s*\|)+\s*:?-*:?\s*$')
# A question's own numbered line: "2.1. Choose", "3) Calculate".
QUESTION_LINE = re.compile(r'(?m)^\s*\d+(?:\.\d+)+\.?\s+[A-ZÀ-Ý]|^\s*\d+\s*\)\s+[A-ZÀ-Ý][a-zà-ÿ]+\s')


def parts_file(track):
    mapping = ROOT / 'corpus' / '.mapping'
    return mapping / ('gs-paper-parts.json' if track == 'gs' else f'{track}-paper-parts.json')


def caption_words(page, number):
    """(top, x0, x1, bottom) of each line of the page that is only the caption Document-N / Doc. N."""
    lines = {}
    for w in page.extract_words(keep_blank_chars=False):
        lines.setdefault(round(w['top'] / 3), []).append(w)
    out = []
    for ws in lines.values():
        ws.sort(key=lambda w: w['x0'])
        text = ' '.join(w['text'] for w in ws)
        if re.fullmatch(rf'(?:Document|Doc\.?)\s*[-–]?\s*{number}\s*[.:]?', text.strip(), re.I):
            out.append((float(min(w['top'] for w in ws)), float(min(w['x0'] for w in ws)),
                        float(max(w['x1'] for w in ws)), float(max(w['bottom'] for w in ws))))
    return out


def boxes(page):
    """Closed rectangles drawn on the page, from rects or from four lines."""
    out = [(float(r['x0']), float(r['top']), float(r['x1']), float(r['bottom'])) for r in page.rects]
    # A frame drawn as four thin strips (ls/2017 2/chem_en.pdf Document-1): two
    # rules of the same width, joined by an upright strip at each end.
    strips = out + [(float(l['x0']), float(l['top']), float(l['x1']), float(l['bottom'])) for l in page.lines]
    rules = [s for s in strips if s[3] - s[1] <= 3 and s[2] - s[0] > 40]
    posts = [s for s in strips if s[2] - s[0] <= 3 and s[3] - s[1] > 20]

    def post_at(x, y0, y1):
        return any(abs((p[0] + p[2]) / 2 - x) <= 3 and p[1] <= y0 + 3 and p[3] >= y1 - 3 for p in posts)
    for a in rules:
        for b in rules:
            if (b[1] - a[1] > 20 and abs(a[0] - b[0]) <= 3 and abs(a[2] - b[2]) <= 3
                    and post_at(a[0], a[1], b[3]) and post_at(a[2], a[1], b[3])):
                out.append((min(a[0], b[0]), a[1], max(a[2], b[2]), b[3]))
    return [b for b in out if b[2] - b[0] > 40 and b[3] - b[1] > 20]


def region_for(page, cap, lo, hi):
    """The box holding the caption, or the figure just above it; (kind, box) or None."""
    top, x0, x1, bottom = cap
    holding = [b for b in boxes(page) if b[0] <= x0 + 1 and b[2] >= x1 - 1 and b[1] <= top and b[3] >= bottom - 1]
    # The smallest box that holds it, if it is a document and not the page's frame
    # or a table cell holding only the caption.
    # Nor a frame round a whole section: one that holds a question ("2.1. Choose …",
    # ls/2019/chem_en.pdf) or half the page.
    holding = [b for b in holding if b[3] - b[1] > (bottom - top) * 2.5 and b[2] - b[0] < float(page.width) * 0.97
               and b[3] - b[1] < float(page.height) * 0.45 and not QUESTION_LINE.search(page.crop(b).extract_text() or '')]
    if holding:
        b = min(holding, key=lambda b: (b[2] - b[0]) * (b[3] - b[1]))
        if b[1] >= lo - 5 and b[3] <= hi + 25:  # a frame may end just past the span
            return 'box', b
    # A figure: images and drawings whose foot is within 60 points above the caption.
    graphics = [(float(i['x0']), float(i['top']), float(i['x1']), float(i['bottom'])) for i in page.images]
    graphics += [(float(c['x0']), float(c['top']), float(c['x1']), float(c['bottom'])) for c in page.curves]
    graphics += [(float(r['x0']), float(r['top']), float(r['x1']), float(r['bottom'])) for r in page.rects]
    graphics = [g for g in graphics if g[3] - g[1] < float(page.height) * 0.45]
    near = [g for g in graphics if top - 60 <= g[3] <= top + 2 and g[1] >= lo - 5 and g[2] > g[0]]
    if not near:
        return None
    # Grow upward through graphics that touch what is already taken.
    taken = list(near)
    changed = True
    while changed:
        changed = False
        y0 = min(g[1] for g in taken)
        for g in graphics:
            if g not in taken and g[3] >= y0 - 8 and g[1] < y0 and g[1] >= lo - 5:
                taken.append(g)
                changed = True
    # A frame's foot just under the caption belongs to the picture.
    foot = max([bottom] + [g[3] for g in graphics if bottom - 2 <= g[3] <= bottom + 14 and g[1] < top])
    b = (min(g[0] for g in taken + [(x0, 0, x1, 0)]), min(g[1] for g in taken),
         max(g[2] for g in taken + [(x0, 0, x1, 0)]), foot)
    if b[3] - b[1] < 30:
        return None
    # Words in the cut that no drawing covers, other than the caption, are the
    # exercise's own prose set beside the figure (ls/2019/bio_en.pdf Document 2).
    area = (min(g[0] for g in taken), min(g[1] for g in taken), max(g[2] for g in taken), max(g[3] for g in taken))
    loose = [w for w in page.crop(b).extract_words()
             if not (area[0] - 2 <= float(w['x0']) and float(w['x1']) <= area[2] + 2
                     and area[1] - 2 <= float(w['top']) and float(w['bottom']) <= area[3] + 2)
             and float(w['top']) < top - 1]
    if len(loose) > 8 or QUESTION_LINE.search(page.crop(b).extract_text() or ''):
        return None
    return 'figure', b


def clear_of_text(page, box, pad=3):
    """The box with a little white margin, kept off the text lines just above and below it."""
    x0, top, x1, bottom = box
    top, bottom = top - pad, bottom + pad
    for w in page.extract_words():
        wt, wb = float(w['top']), float(w['bottom'])
        if float(w['x1']) < x0 or float(w['x0']) > x1:
            continue
        if wb > top and wt < box[1] and (wt + wb) / 2 < box[1]:
            top = max(top, wb + 0.5)  # a line above, mostly outside
        if wt < bottom and wb > box[3] and (wt + wb) / 2 > box[3]:
            bottom = min(bottom, wt - 0.5)  # a line below, mostly outside
    return x0 - pad, top, x1 + pad, bottom


def cut(pdf_path, page_index, box, name, folder=FIGURES):
    import pypdfium2 as pdfium
    doc = pdfium.PdfDocument(str(pdf_path))
    img = doc[page_index].render(scale=SCALE).to_pil()
    crop = img.crop((max(0, box[0] * SCALE), max(0, box[1] * SCALE), box[2] * SCALE, box[3] * SCALE))
    folder.mkdir(parents=True, exist_ok=True)
    crop.save(folder / name, 'WEBP', quality=88)


def tokens(text):
    """Words and numbers, lower case, with LaTeX left out."""
    return TOKEN.findall(re.sub(r'\$[^$]*\$|\[a-zA-Z]+', ' ', text).lower())


def never_dropped(line):
    """A question, or a sentence that names the document, stays."""
    return bool(QUESTION_LINE.search(line) or re.match(r'\s*\d+(?:\.\d+)*\s*[-.)]\s', line)
                or re.search(r'\b(?:Document|Doc\.?)\s*[-–]?\s*\d', line))


def drop_repeated_lines(text, start, end, box_tokens):
    """The text before and after the caption at text[start:end], without the lines next
    to it that the picture shows: above it, lines whose words and numbers are in the
    picture (a box's text, a table's rows and rules); below it, short labels the
    picture holds ("Set b", gs/2017 1/chem_en.pdf)."""
    lines = text[:start].split('\n')
    k = len(lines)
    while k > 0:
        line = lines[k - 1]
        got = tokens(line)
        if not line.strip() or TABLE_RULE.match(line) or SMILES_LINE.fullmatch(line):
            k -= 1  # a blank, a table's rule, or the drawn formula read as SMILES
            continue
        if never_dropped(line):
            break
        if got and sum(1 for t in got if t in box_tokens) >= 0.85 * len(got):
            k -= 1
            continue
        break
    after = text[end:].split('\n')
    j = 0
    while j < len(after):
        line = after[j]
        got = tokens(line)
        if not line.strip():
            j += 1
            continue
        if got and len(got) <= 6 and all(t in box_tokens for t in got) and not never_dropped(line):
            j += 1
            continue
        break
    dropped = '\n'.join([x for x in lines[k:] if x.strip()] + [x for x in after[:j] if x.strip()])
    tail = '\n'.join(after[j:])
    return '\n'.join(lines[:k]).rstrip() + '\n\n', ('\n\n' + tail.lstrip('\n') if tail.strip() else ''), dropped


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--track', required=True)
    ap.add_argument('--rows', required=True, help='CSV: id,source_ref,subject_id,visuals')
    ap.add_argument('--write', action='store_true')
    ap.add_argument('--preview', help='cut the images into this folder only, to look at them')
    args = ap.parse_args()

    rows = list(csv.DictReader(open(args.rows, encoding='utf-8')))
    subjects = {r['subject_id'] for r in rows}
    visuals = {}
    for r in rows:
        visuals[r['source_ref']] = visuals.get(r['source_ref'], 0) + int(r['visuals'])
    spans = {(c['sha256'], k['ordinal']): k for c in json.loads(pp.C1_PATH.read_text(encoding='utf-8'))
             for k in c['containers']}
    exams = {e['path'].replace('\\', '/'): e for e in json.loads(pp.EXAMS.read_text(encoding='utf-8'))}

    path = parts_file(args.track)
    papers = json.loads(path.read_text(encoding='utf-8'))
    done, skipped = [], []
    for p in papers:
        pdf_path = ROOT / 'corpus' / 'exams' / p['paper']
        for e in p['exercises']:
            if e.get('status') != 'split':
                continue
            refs = [hashlib.sha256(f"{s}:{p['sha256']}:{e['index']}:{e['ordinal'] - 1}".encode()).hexdigest()
                    for s in subjects]
            found = [r for r in refs if r in visuals]
            if not found or any(visuals[r] for r in found):
                continue  # not loaded, or the page already shows its pictures
            fields = [('intro', e)] + [('text', x) for x in e.get('parts') or []]
            if not any(CAPTION_LINE.search(holder.get(key) or '') for key, holder in fields):
                continue
            span = spans.get((p['sha256'], e['ordinal']))
            if not span or not pdf_path.exists():
                skipped.append(f"{p['paper']} ex{e['ordinal']}: no span or no PDF")
                continue
            with pdfplumber.open(str(pdf_path)) as pdf:
                for key, holder in fields:
                    text = holder.get(key) or ''
                    for m in reversed(list(CAPTION_LINE.finditer(text))):
                        label, number = m.group(1), m.group(2)
                        hit = None
                        for s in span['spans']:
                            page = pdf.pages[s['page'] - 1]
                            scale = float(page.height) / s['pageHeight']
                            lo, hi = s['yStart'] * scale, s['yEnd'] * scale
                            caps = [c for c in caption_words(page, number) if lo - 5 <= c[0] <= hi + 5]
                            for c in caps:
                                got = region_for(page, c, lo, hi)
                                if got:
                                    hit = (s['page'] - 1, page, got)
                                    break
                            if hit:
                                break
                        where = f"{p['paper']} ex{e['ordinal']} {label}"
                        if not hit:
                            skipped.append(f'{where}: not found on the page')
                            continue
                        page_index, page, (kind, box) = hit
                        name = (f"{p['sha256'][:12]}-doc-p{page_index + 1}-e{e['index']}-"
                                f"{re.sub(r'[^a-z0-9]+', '-', label.lower()).strip('-')}.webp")
                        image = f'![{label}](/answer-figures/{name})'
                        # The lines just before the caption that the picture shows
                        # word for word (a box's text, a table's cells) go.
                        box_tokens = set(tokens(page.within_bbox(box).extract_text() or ''))
                        head, tail, dropped = drop_repeated_lines(text, m.start(), m.end(), box_tokens)
                        text = head + image + tail
                        done.append({'paper': p['paper'], 'ordinal': e['ordinal'], 'label': label, 'kind': kind,
                                     'page': page_index + 1, 'box': [round(v, 1) for v in box], 'image': name,
                                     'dropped': dropped[:300]})
                        if args.write:
                            cut(pdf_path, page_index, clear_of_text(page, box), name)
                        elif args.preview:
                            cut(pdf_path, page_index, clear_of_text(page, box), name, Path(args.preview))
                    holder[key] = text
    for d in done:
        print(f"cut {d['kind']:6} {d['paper']} ex{d['ordinal']} {d['label']} p{d['page']} {d['box']}"
              f"  dropped: {d['dropped'][:120]!r}")
    for s in skipped:
        print('skip', s)
    print(f'cut {len(done)}, skipped {len(skipped)}')
    if args.write:
        path.write_text(json.dumps(papers, ensure_ascii=False, indent=1), encoding='utf-8')
        print(f'wrote {path}')


if __name__ == '__main__':
    main()
