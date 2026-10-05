"""Geography documents as printed: one picture per document page, in page order.

    python scripts/corpus/geo_document_pages.py [--only PAPER] [--sheet out.png]

A geography paper prints its documents (a map, graphs, tables, a text) and then
asks about them. The figure pipelines cut those documents twice over (exercise
figures and the reviewed map crops), with reading orders that collide, so a
paper showed its table and cartoon before its map, the cartoon twice, and the
diagram question 4 asks students to complete among the documents.

This cuts the document pages themselves instead: everything from below the
ministry letterhead on page 1 down to the first question, page by page. Where
the questions start mid-page, the page is cut above the first question line.
Which page that is comes from the paper's OCR pages (corpus/exams-ocr/<sha8>/);
where on the page, from the PDF's text layer, words read in both directions.
A cut that cannot be placed on the page is reported and left out, not guessed.

Writes public/geo-docs/<sha12>-p<N>.jpg and corpus/geo-docs/manifest.json.
"""
import argparse, glob, hashlib, json, logging, os, re, sys, unicodedata
from pathlib import Path

import pdfplumber
import pypdfium2 as pdfium

logging.getLogger('pdfminer').setLevel(logging.ERROR)
sys.stdout.reconfigure(encoding='utf-8')

OUT = Path('public/geo-docs')
MANIFEST = Path('corpus/geo-docs/manifest.json')
SCALE = 1.7
ADAPTED = re.compile(r'ehte|ehti|makf|su3ub|mu5t', re.I)
# The first question: a "الأسئلة" heading, or a numbered line asking about the documents.
Q_HEAD = re.compile(r'^\s*[#*\s]*(?:ال)?[أا]سئلة')
# LH: "□ معالجة موضوع جغرافي:" / "□ تحليل مستندات :"; SE 2021: "أولاً: حدد ...".
TASK_LINE = re.compile(r'^\s*[□■#*\s]*(?:معالجة|تحليل)\s|^\s*[#*\s]*أول\S{0,2}\s*[:：\-–]')
Q_LINE = re.compile(r'^\s*[#*\s]*(?:[0-9٠-٩]+\s*[-–.)]|[أا]\s*[-–.)])?\s*(?:من خلال|حدد|حدّد|حدِّد|استنادا|استناداً|بالاعتماد|اعتماداً|اعتمادا|انطلاقا|انطلاقاً|قدّم|قدم|يشير|يظهر|ورد في|اذكر|أذكر|اختر|أكمل)')
DOC = re.compile(r'المستند\s*رقم|مستند\s*رقم')
# The letterhead's last lines.
# Many of these PDFs map final and medial meem to other glyphs ("الرقن", "الودة",
# "االسن"), so the words are matched loosely.
HEAD_END = re.compile(r'الرق[من]|ال[مو]دّ?[ةه]|ا?ال?س[من]\s*:')
# In the text layer the first question is found by its number, which the broken
# glyph mapping leaves intact: "1- أ- حدد ..." read one way, "-1 ..." the other.
Q1_LAYER = (re.compile(r'^\s*[1١]\s*[-–.]'), re.compile(r'^\s*[-–.]\s*[1١](?:\s|$)'))
# LH papers follow their documents with an essay: "معالجة الموضوع الجغرافي :".
# The box mark survives every glyph mapping; "جغرافي" comes out as "جغزافي" in some.
TASK_HEAD = re.compile(r'جغ[رز]اف\S*\s*:?\s*$|مستندات\s*:|^\s*□')
Q_HEAD_LAYER = re.compile(r'^\s*\S{0,3}سئلة\s*:?\s*$')
TASHKEEL = re.compile(r'[ً-ْـ]')


def norm(s):
    return TASHKEEL.sub('', unicodedata.normalize('NFKC', s))


def lines_of(page, top=0.0, bottom=None):
    """Text lines with their vertical extent, each read both ways (presentation forms come reversed)."""
    words = page.extract_words(keep_blank_chars=False, use_text_flow=False, x_tolerance=1.5, y_tolerance=2)
    rows = []
    for w in sorted(words, key=lambda w: (round(w['top']), -w['x1'])):
        if float(w['top']) < top or (bottom is not None and float(w['bottom']) > bottom):
            continue
        if rows and abs(rows[-1]['top'] - float(w['top'])) < 4:
            rows[-1]['words'].append(w)
            rows[-1]['bottom'] = max(rows[-1]['bottom'], float(w['bottom']))
        else:
            rows.append({'top': float(w['top']), 'bottom': float(w['bottom']), 'words': [w]})
    for r in rows:
        ws = sorted(r['words'], key=lambda w: -w['x1'])
        a = ' '.join(norm(w['text']) for w in ws)
        b = ' '.join(norm(w['text'])[::-1] for w in ws)
        c = ' '.join(norm(w['text'])[::-1] for w in sorted(r['words'], key=lambda w: w['x0']))
        r['texts'] = (a, b, c)
    return rows


def letterhead_bottom(page):
    """Below the letterhead's name/number/duration lines, in the top third of page 1."""
    h = float(page.height)
    lines = lines_of(page, bottom=h * 0.33)
    hits = [r for r in lines if any(HEAD_END.search(t) for t in r['texts'])]
    # Where even those words are unreadable ("انشلى" for الرقم), the letterhead's
    # last line still ends with the colon of its name/number/duration fields.
    hits += [r for r in lines if r['bottom'] < h * 0.25 and len(r['texts'][0]) < 70
             and any(t.rstrip().endswith(':') or t.lstrip().startswith(':') for t in r['texts'])]
    if not hits:
        return None
    y = max(r['bottom'] for r in hits)
    # The grey box or rule under the letterhead closes just below its last
    # line: take the NEAREST such line. The farthest one within reach was the
    # top edge of the first document's frame (GS 2004-2), and cut into it.
    rules = [float(x['bottom']) for x in page.rects + page.lines
             if y - 2 <= float(x['bottom']) <= y + 25 and float(x['width']) > float(page.width) * 0.3]
    if rules:
        y = max(y, min(rules))
    # Never below the first line of text that follows.
    after = [r['top'] for r in lines_of(page) if r['top'] > y + 1]
    cut = y + 3
    if after:
        cut = min(cut, min(after) - 2)
    return cut


def question_top(page, after):
    """The top of the first question line below `after`."""
    for r in lines_of(page, top=after):
        a, b, c = r['texts']
        if (Q_HEAD_LAYER.search(b) or Q_HEAD_LAYER.search(a) or Q1_LAYER[0].search(b) or Q1_LAYER[1].search(a)
                or (len(b) < 45 and TASK_HEAD.search(b) and r['top'] - after > 40)
                or any(Q_HEAD.search(t) or Q_LINE.search(t) for t in r['texts'])):
            return r['top'] - 4
    return None


def ocr_start(sha):
    pages = sorted(glob.glob(f'corpus/exams-ocr/{sha[:8]}/page-*.md'))
    seen_doc = False
    for pi, p in enumerate(pages):
        lines = open(p, encoding='utf-8').read().splitlines()
        for li, line in enumerate(lines):
            # A task heading ("تحليل مستندات", "معالجة موضوع", "أولاً:") opens the
            # questions only once a document has been printed: some papers put
            # it above their documents (GS 2013-1), or start with the essay and
            # print the documents after it (LH 2004-2006).
            task = TASK_LINE.search(line)
            if (task and seen_doc) or (not task and (Q_HEAD.search(line) or Q_LINE.search(line))):
                return pi + 1, any(DOC.search(l) for l in lines[:li])
            seen_doc = seen_doc or bool(DOC.search(line))
    return None, False


def papers(only):
    for f in sorted(glob.glob('corpus/exams/*/*/*')):
        f = f.replace('\\', '/')
        name = os.path.basename(f).lower()
        if not name.endswith('.pdf') or not re.search(r'geo|jogra', name) or ADAPTED.search(name):
            continue
        rel = f.split('corpus/exams/')[1]
        if only and rel not in only:
            continue
        yield rel


def cut(rel):
    path = 'corpus/exams/' + rel
    sha = hashlib.sha256(open(path, 'rb').read()).hexdigest()
    q_page, docs_above = ocr_start(sha)
    rec = {'paper': rel, 'sha256': sha, 'q_page': q_page, 'pages': [], 'problems': []}
    if not q_page:
        rec['problems'].append('no question start in the OCR pages')
        return rec
    wanted = list(range(1, q_page)) + ([q_page] if docs_above or q_page == 1 else [])
    pdf = pdfium.PdfDocument(path)
    with pdfplumber.open(path) as plumb:
        for n in wanted:
            page = plumb.pages[n - 1]
            w, h = float(page.width), float(page.height)
            top, bottom = 0.0, h
            if n == 1:
                lb = letterhead_bottom(page)
                if lb is None:
                    rec['problems'].append('p1: letterhead end not found')
                    continue
                top = lb
            if n == q_page:
                if len(page.chars) < 200:
                    rec['problems'].append(f'p{n}: questions start on a scanned page')
                    continue
                qt = question_top(page, top)
                if qt is None:
                    rec['problems'].append(f'p{n}: first question not found on the page')
                    continue
                bottom = qt
            if bottom - top < h * 0.08:
                continue
            img = pdf[n - 1].render(scale=SCALE).to_pil().convert('L')
            box = (0, int(top * SCALE), img.width, int(bottom * SCALE))
            crop = img.crop(box)
            name = f'{sha[:12]}-p{n}.jpg'
            OUT.mkdir(parents=True, exist_ok=True)
            crop.save(OUT / name, quality=72, optimize=True)
            rec['pages'].append({'page': n, 'image': f'/geo-docs/{name}', 'box_pt': [0, round(top, 1), round(w, 1), round(bottom, 1)],
                                 'size': [w, h], 'px': [crop.width, crop.height], 'bytes': (OUT / name).stat().st_size,
                                 'sha256': hashlib.sha256((OUT / name).read_bytes()).hexdigest()})
    return rec


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', nargs='*')
    a = ap.parse_args()
    out = [cut(rel) for rel in papers(set(a.only or []))]
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding='utf-8')
    ok = sum(1 for r in out if r['pages'] and not r['problems'])
    print(f'{len(out)} papers: {ok} cut cleanly, {sum(1 for r in out if r["problems"])} with problems,'
          f' {sum(len(r["pages"]) for r in out)} pictures, {sum(p["bytes"] for r in out for p in r["pages"]) / 1e6:.1f} MB')
    for r in out:
        for p in r['problems']:
            print('  ', r['paper'], '-', p)


if __name__ == '__main__':
    main()
