# -*- coding: utf-8 -*-
r"""
Printed tables and graphs that reached the text as a column of fragments,
replaced by the document itself, cut from the paper.

    python scripts/corpus/loose_documents.py <questions.jsonl> <audit.json> <fixes.json> \
        [--subjects "Life Sciences,Sciences de la vie"] [--preview DIR] [--write]

audit-rendered-text.tsx lists each run of fragment lines ("Cholesterol level
in the / blood (mg.dl-1) ≤ 120 150 220 ≥250 / … / 3 4 6 8 / Document 1 /
Document 2", Life Sciences SE 2021-2). The run's "Document N" captions say
which documents it is; document_figures.region_for finds each one on the
exercise's pages, and the run is replaced by their pictures. A run is
changed only when every document it names is found; otherwise it stays as it
is and is listed.

Questions with parts are left to document_figures.py; this is for questions
stored as one text. --preview cuts into DIR only; --write cuts into
public/answer-figures. Either way the fixes go to <fixes.json> for
load-text-fixes.ts, which writes only where the text is still the same.
"""
import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

import pdfplumber

sys.path.insert(0, str(Path(__file__).parent))
import document_figures as df  # noqa: E402
import paper_parts as pp  # noqa: E402

sys.stdout.reconfigure(encoding='utf-8')
CAPTION = re.compile(r'^\*{0,2}(?:Document|Doc\.?)\s*[-–]?\s*(\d{1,2})\*{0,2}$', re.I)


def exercises_by_ref(subject_ids):
    """source_ref -> (paper, sha256, index, ordinal), for every exercise in a parts file."""
    out = {}
    for path in sorted((pp.ROOT / 'corpus' / '.mapping').glob('*paper-parts.json')):
        for p in json.load(open(path, encoding='utf-8')):
            for e in p['exercises']:
                for s in subject_ids:
                    ref = hashlib.sha256(f"{s}:{p['sha256']}:{e['index']}:{e['ordinal'] - 1}".encode()).hexdigest()
                    out[ref] = (p['paper'], p['sha256'], e['index'], e['ordinal'])
    return out


SENTENCE_END = re.compile(r'[.:;?!»]\s*$')
LIST_HEAD = re.compile(r'^\s*(?:[-•*]|[a-zA-Z0-9]{1,3}\s*[-.)]|\|)')


def fragment(line):
    """A line of a flattened document, by the rule audit-rendered-text.tsx uses."""
    t = line.strip()
    return bool(t) and len(t.split()) <= 8 and not SENTENCE_END.search(t) and not LIST_HEAD.match(t) and '$$' not in t


def run_span(text, sample):
    """(start, end, lines) of the whole run in `text` that the audit sampled as
    "a / b / c" (the sample is cut short; the run is followed to its end)."""
    first = sample.split(' / ')[0].strip()
    lines = text.split('\n')
    pos = 0
    for i, line in enumerate(lines):
        if line.strip() == first and fragment(line):
            j = i
            while j + 1 < len(lines) and (fragment(lines[j + 1]) or not lines[j + 1].strip()):
                j += 1
            while j > i and not lines[j].strip():
                j -= 1
            end = pos + sum(len(l) + 1 for l in lines[i:j + 1]) - 1
            return pos, end, [l.strip() for l in lines[i:j + 1] if l.strip()]
        pos += len(line) + 1
    return None


WHY = []  # why the last locate_by_words refused, for the report


def locate_strip(pdf, run_lines, paper_pages):
    """A full-width strip of the paper holding the run's own words, grown to
    hold every drawing it touches; (page_index, page, box) or None.

    Where a document cannot be cut on its own (prose set beside it, a drawing
    with no frame), the strip of the page it sits in is still the paper as
    printed: nothing is sliced, and the prose beside it is the exercise's own.
    Refused on the marking-key pages and when the strip would be most of a
    page."""
    want = [norm(l) for l in run_lines if len(norm(l)) >= 4]
    if len(want) < 2:
        return None
    best = None
    for i, page in enumerate(pdf.pages[:paper_pages or len(pdf.pages)]):
        words = page.extract_words()
        keys = [norm(w['text']) for w in words]
        found, boxes = 0, []
        for target in want:
            for a in range(len(words)):
                acc, hit = '', None
                for b in range(a, min(len(words), a + 12)):
                    acc += keys[b]
                    if acc == target:
                        hit = words[a:b + 1]
                        break
                    if not target.startswith(acc):
                        break
                if hit:
                    found += 1
                    boxes += [(float(w['top']), float(w['bottom'])) for w in hit]
                    break
        if found and (best is None or found > best[0]):
            best = (found, i, page, boxes)
    if not best or best[0] < max(2, 0.6 * len(want)):
        return None
    found, i, page, boxes = best
    boxes.sort()
    groups = [[boxes[0]]]
    for b in boxes[1:]:
        if b[0] - max(x[1] for x in groups[-1]) > 60:
            groups.append([])
        groups[-1].append(b)
    group = max(groups, key=len)
    top, bottom = min(b[0] for b in group) - 6, max(b[1] for b in group) + 6
    h, w = float(page.height), float(page.width)
    graphics = [(float(g['top']), float(g['bottom']))
                for g in list(page.images) + list(page.curves) + list(page.rects) + list(page.lines)
                if float(g['bottom']) - float(g['top']) < h * 0.6]
    # A table whose borders are drawn row by row: an upright border segment
    # that starts at the strip's edge means the table goes on past it
    # (ls/2018 1/bio_en.pdf, the Botox table cut after two rows).
    posts = [(float(g['top']), float(g['bottom']))
             for g in list(page.rects) + list(page.lines)
             if float(g['x1']) - float(g['x0']) <= 3 and float(g['bottom']) - float(g['top']) < h * 0.6]
    graphics += [(t - 4, b + 4) for t, b in posts]
    # Grown until no drawing and no line of text is cut across by an edge.
    lines = [(float(x['top']), float(x['bottom'])) for x in page.extract_words()]
    changed = True
    while changed and bottom - top <= h * 0.6:
        changed = False
        for gt, gb in graphics + lines:
            if gt < bottom and gb > top and (gt < top - 0.5 or gb > bottom + 0.5):
                top, bottom = min(top, gt - 3), max(bottom, gb + 3)
                changed = True
    if bottom - top > h * 0.6:
        return None
    return i, page, (0.0, max(0.0, top), w, min(h, bottom))


def norm(s):
    return re.sub(r'[^0-9a-zà-ÿ]', '', s.lower())


def locate_by_words(pdf, span, run_lines):
    """The region of the exercise's pages holding the run's own words, and the
    drawings around them; (page_index, page, box) or None.

    Each run line with 4+ letters or digits is looked for as consecutive words
    of a page; the page with most found lines wins, if it has most of them.
    Refused when the region reaches a question or ordinary prose."""
    want = [norm(l) for l in run_lines if len(norm(l)) >= 4]
    if len(want) < 2:
        return None
    best = None
    # The exercise's own span first; then whole pages, since a span can stop
    # short of a document printed beside or after it. The words themselves
    # say which document it is.
    places = []
    for s in span['spans']:
        page = pdf.pages[s['page'] - 1]
        scale = float(page.height) / s['pageHeight']
        places.append((s, s['yStart'] * scale - 5, s['yEnd'] * scale + 5))
    for i, page in enumerate(pdf.pages):
        places.append(({'page': i + 1}, 0.0, float(page.height)))
    for s, lo, hi in places:
        page = pdf.pages[s['page'] - 1]
        words = [w for w in page.extract_words() if lo <= float(w['top']) <= hi]
        keys = [norm(w['text']) for w in words]
        found, boxes = 0, []
        for target in want:
            hit = None
            for a in range(len(words)):
                acc = ''
                for b in range(a, min(len(words), a + 12)):
                    acc += keys[b]
                    if acc == target:
                        hit = words[a:b + 1]
                        break
                    if not target.startswith(acc):
                        break
                if hit:
                    break
            if hit:
                found += 1
                boxes += [(float(w['x0']), float(w['top']), float(w['x1']), float(w['bottom'])) for w in hit]
        if found and (best is None or found > best[0]):
            best = (found, s, page, boxes, lo, hi)
    if not best or best[0] < max(2, 0.6 * len(want)):
        WHY.append(f'lines found {best[0] if best else 0}/{len(want)}')
        return None
    found, s, page, boxes, lo, hi = best
    # The biggest group of found words, top to bottom: a line found again far
    # away on the page ("Document 2" in a sentence) does not stretch the cut.
    boxes.sort(key=lambda b: b[1])
    groups = [[boxes[0]]]
    for b in boxes[1:]:
        if b[1] - max(x[3] for x in groups[-1]) > 60:
            groups.append([])
        groups[-1].append(b)
    boxes = max(groups, key=len)
    region = [min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes)]
    graphics = [(float(g['x0']), float(g['top']), float(g['x1']), float(g['bottom']))
                for g in list(page.images) + list(page.curves) + list(page.rects) + list(page.lines)]
    graphics = [g for g in graphics if lo <= g[1] and g[3] <= hi and g[3] - g[1] < float(page.height) * 0.6]

    def mostly_near(g, r, pad=40):
        """Most of the drawing lies within `pad` of the region: a page frame or
        a rule across the page does not."""
        ix0, iy0 = max(g[0], r[0] - pad), max(g[1], r[1] - pad)
        ix1, iy1 = min(g[2], r[2] + pad), min(g[3], r[3] + pad)
        if ix1 < ix0 or iy1 < iy0:
            return False
        size = max(g[2] - g[0], 1) * max(g[3] - g[1], 1)
        return max(ix1 - ix0, 1) * max(iy1 - iy0, 1) >= 0.7 * size

    changed = True
    while changed:
        changed = False
        for g in graphics:
            inside = g[0] >= region[0] and g[2] <= region[2] and g[1] >= region[1] and g[3] <= region[3]
            if not inside and mostly_near(g, region):
                region = [min(region[0], g[0]), min(region[1], g[1]), max(region[2], g[2]), max(region[3], g[3])]
                changed = True
    w, h = float(page.width), float(page.height)
    box = (max(0.0, region[0] - 2), max(0.0, region[1] - 2), min(w, region[2] + 2), min(h, region[3] + 2))
    if box[3] - box[1] > h * 0.6 or box[3] - box[1] < 20:
        WHY.append('size')
        return None
    # Nor a cut through a drawing that goes on outside it.
    for g in graphics:
        meets = g[0] < box[2] - 3 and g[2] > box[0] + 3 and g[1] < box[3] - 3 and g[3] > box[1] + 3
        if meets and (g[0] < box[0] - 3 or g[2] > box[2] + 3 or g[1] < box[1] - 3 or g[3] > box[3] + 3):
            WHY.append('slices a drawing')
            return None
    inside = page.crop(box).extract_text() or ''
    if df.QUESTION_LINE.search(inside) or df.NUMBERED_ASK.search(inside):
        WHY.append('holds a question')
        return None
    # The run is the document's own words: words in the region that are not in
    # it are the exercise's prose or questions set beside the document.
    own = {norm(t) for l in run_lines for t in l.split()}
    foreign = [w for w in page.within_bbox(box).extract_words()
               if len(norm(w['text'])) >= 2 and norm(w['text']) not in own]
    # Painting them out was tried: it erased labels inside drawings and the
    # cells of tables whose words the run had lost. So: refused.
    if len(foreign) > 6:
        WHY.append(f'{len(foreign)} foreign words')
        return None
    return s['page'] - 1, page, box, []


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('questions')
    ap.add_argument('audit')
    ap.add_argument('fixes')
    ap.add_argument('--subjects')
    ap.add_argument('--subject-ids', required=True, help='file with one subject id per line')
    ap.add_argument('--preview')
    ap.add_argument('--write', action='store_true')
    args = ap.parse_args()
    subjects = set(args.subjects.split(',')) if args.subjects else None
    rows = {}
    for line in open(args.questions, encoding='utf-8'):
        r = json.loads(line)
        rows[r['id']] = r
    findings = [f for f in json.load(open(args.audit, encoding='utf-8'))
                if f['kind'] == 'loose' and f['where'] == 'question' and f['id'] in rows
                and (not subjects or f['subject'] in subjects)]
    subject_ids = [l.strip() for l in open(args.subject_ids, encoding='utf-8') if l.strip()]
    where = exercises_by_ref(subject_ids)
    paper_pages = {e['sha256']: e.get('paperPages') for e in json.loads(pp.EXAMS.read_text(encoding='utf-8'))}
    spans = {(c['sha256'], k['ordinal']): k for c in json.loads(pp.C1_PATH.read_text(encoding='utf-8'))
             for k in c['containers']}

    texts = {}  # (id, column) -> text being rewritten
    fixes, done, left = [], [], []
    for f in findings:
        r = rows[f['id']]
        if r.get('paper_parts'):
            continue
        hit = where.get(r.get('source_ref') or '')
        if not hit:
            left.append(f"{r['title']}: exercise not found from source_ref")
            continue
        paper, sha, index, ordinal = hit
        pdf_path = pp.ROOT / 'corpus' / 'exams' / paper
        span = spans.get((sha, ordinal))
        if not span or not pdf_path.exists():
            left.append(f"{r['title']} ({paper} ex{ordinal}): no span or no PDF")
            continue
        column = 'content_latex' if r.get('content_latex') else 'content_text'
        text0 = texts.get((r['id'], column), r.get(column)) or ''
        at = run_span(text0, f['sample'])
        if not at:
            left.append(f"{r['title']} ({paper} ex{ordinal}): run not found in the stored text")
            continue
        run_lines = at[2]
        numbers = list(dict.fromkeys(m.group(1) for l in run_lines for m in [CAPTION.match(l)] if m))
        cuts = []
        with pdfplumber.open(str(pdf_path)) as pdf:
            for n in numbers:
                got = None
                for s in span['spans']:
                    page = pdf.pages[s['page'] - 1]
                    scale = float(page.height) / s['pageHeight']
                    lo, hi = s['yStart'] * scale, s['yEnd'] * scale
                    for c in df.caption_words(page, n):
                        if lo - 5 <= c[0] <= hi + 5:
                            region = df.region_for(page, c, lo, hi)
                            if region:
                                got = (s['page'] - 1, page, region, c)
                                break
                    if got:
                        break
                if not got:
                    break
                page_index, page, (kind, box), cap = got
                name = f"{sha[:12]}-doc-p{page_index + 1}-e{index}-document-{n}.webp"
                cuts.append((n, kind, page_index, page, box, name, df.strays(page, box, cap) if kind == 'figure' else []))
            how = 'captions'
            if not numbers or len(cuts) != len(numbers):
                # A cut built around the run's words alone was right one time in
                # four (sliced tables, a key page): the strip of the page is used
                # instead.
                got = locate_strip(pdf, run_lines, paper_pages.get(sha))
                if got:
                    page_index, page, box = got
                    name = f"{sha[:12]}-doc-p{page_index + 1}-e{index}-strip-{int(box[1])}.webp"
                    cuts = [(', '.join(numbers), 'strip', page_index, page, box, name, [])]
                    how = 'strip'
                else:
                    missing = [n for n in numbers if n not in {c[0] for c in cuts}]
                    why = f"Document {', '.join(missing)} not found on the page" if missing else 'run names no document'
                    left.append(f"{r['title']} ({paper} ex{ordinal}): {why}; no strip either")
                    continue
        # The pictures must hold the run: most of its words are in them. A
        # picture that does not is some other document, and the run stays.
        run_words = [norm(t) for l in run_lines if not CAPTION.match(l) for t in l.split() if len(norm(t)) >= 2]
        held = set()
        for _, _, _, page, box, _, _ in cuts:
            held |= {norm(w['text']) for w in page.crop(box).extract_words()}
        if run_words and sum(1 for t in run_words if t in held) < 0.6 * len(run_words):
            left.append(f"{r['title']} ({paper} ex{ordinal}): the picture does not hold the run's words")
            continue
        images = '\n\n'.join(f'![Document {n}](/answer-figures/{name})' if n else f'![Document](/answer-figures/{name})'
                               for n, _, _, _, _, name, _ in cuts)
        changed = False
        for col in ('content_latex', 'content_text'):
            key = (r['id'], col)
            text = texts.get(key, r.get(col))
            if not text:
                continue
            span_at = run_span(text, f['sample'])
            if not span_at:
                continue
            texts[key] = text[:span_at[0]].rstrip() + '\n\n' + images + '\n\n' + text[span_at[1]:].lstrip()
            changed = True
        if not changed:
            left.append(f"{r['title']} ({paper} ex{ordinal}): run not found in the stored text")
            continue
        for n, kind, page_index, page, box, name, blank in cuts:
            if args.write:
                df.cut(pdf_path, page_index, df.clear_of_text(page, box), name, blank=blank)
            elif args.preview:
                df.cut(pdf_path, page_index, df.clear_of_text(page, box), name, Path(args.preview), blank=blank)
        done.append(f"{r['title']} ({paper} ex{ordinal}): by {how}: Document {', '.join(n for n, *_ in cuts) or '(no caption)'}")

    for (qid, column), text in texts.items():
        if text != rows[qid].get(column):
            fixes.append({'id': qid, 'column': column, 'title': rows[qid]['title'],
                          'before': rows[qid][column], 'after': text})
    json.dump(fixes, open(args.fixes, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    for d in done:
        print('cut ', d)
    for l in left:
        print('left', l)
    print(f'replaced {len(done)} run(s); left {len(left)}; {len(fixes)} column fix(es) -> {args.fixes}')


if __name__ == '__main__':
    main()
