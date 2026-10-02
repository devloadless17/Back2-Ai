# -*- coding: utf-8 -*-
"""Make proof crops for science-key rows that can be located exactly.

This is deliberately narrower than OCR.  A crop is emitted only when an
already-accepted cached key range maps to bounded Mathpix line regions on one
scheme page.  A whole table or page is not evidence for one sub-question, so
it is reported and skipped.  No model, API, database or network call occurs.

    python scripts/corpus/crop_science_answer_rows.py --track ls
    python scripts/corpus/crop_science_answer_rows.py --track ls --write

The output is consumed by `load-paper-parts.ts`; it adds `answerImage` beside
the same printed part label.  The viewer reveals the official crop under that
part, alongside the readable key text.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CORPUS = ROOT / 'corpus'
CACHE = CORPUS / 'science-answers-cache'
OUT = CORPUS / 'science-answer-crops.json'
FIGURES = ROOT / 'public' / 'answer-figures'
SCIENCE = {'physics', 'chemistry', 'maths', 'biology'}

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
import attach_science_answers as answers
import extract_exams as extract


def norm(value):
    return re.sub(r'[^a-z0-9]+', '', value.lower())


def key_lines_with_positions(paper):
    folder = CORPUS / 'text' / paper['sha256']
    pages = sorted(folder.glob('page-*.md'))
    texts = [f.read_text('utf-8') for f in pages]
    if paper.get('schemePages') and paper.get('paperPages'):
        chosen = list(enumerate(texts[paper['paperPages']:], paper['paperPages'] + 1))
    else:
        chosen = [(i + 1, text) for i, text in enumerate(texts)
                  if i > 0 and len(answers.MARK.findall(text)) >= 3]
    return [(page, line.rstrip()) for page, text in chosen for line in text.splitlines() if line.strip()][:answers.MAX_LINES]


def geometry(paper):
    source = CORPUS / 'meta' / paper['sha256'] / 'lines.json'
    if not source.exists():
        return {}
    data = json.loads(source.read_text('utf-8'))
    found = {}
    for page in data.get('pages', []):
        number = page.get('page')
        width, height = page.get('page_width'), page.get('page_height')
        if not number or not width or not height:
            continue
        rows = []
        for line in page.get('lines', []):
            region = line.get('region') or {}
            text = line.get('text') or ''
            if text and all(isinstance(region.get(k), (int, float)) for k in ('top_left_x', 'top_left_y', 'width', 'height')):
                rows.append((text, region))
        found[number] = (width, height, rows)
    return found


def locate(page, line, geo):
    """One unique line box containing the MMD key line, or no evidence."""
    want = norm(line)
    if len(want) < 4 or page not in geo:
        return None
    candidates = []
    for text, region in geo[page][2]:
        got = norm(text)
        if len(got) >= 4 and (want in got or got in want):
            candidates.append(region)
    return candidates[0] if len(candidates) == 1 else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--track', default='ls')
    ap.add_argument('--write', action='store_true')
    args = ap.parse_args()
    output, tally = [], {'papers': 0, 'mapped': 0, 'cropped': 0, 'no_geometry': 0, 'wide_region': 0, 'not_located': 0}
    for paper in json.loads((CORPUS / 'exams.json').read_text('utf-8')):
        path = paper['path'].replace('\\', '/')
        if not path.startswith(args.track + '/') or extract.profile_for(paper['path']) not in SCIENCE:
            continue
        cache = next(iter(CACHE.glob(paper['sha256'][:12] + '-*.json')), None)
        geo = geometry(paper)
        if not cache or not geo:
            if cache:
                tally['no_geometry'] += 1
            continue
        cached = json.loads(cache.read_text('utf-8')).get('reply') or {}
        by_id = {str(row.get('id')): row for row in cached.get('answers', []) if isinstance(row, dict)}
        key_lines = key_lines_with_positions(paper)
        items = {item['id']: item for item in answers.items_of(paper)}
        tally['papers'] += 1
        document = None
        for order, exercise in enumerate(paper['exercises']):
            parts = exercise.get('parts') or []
            for part_index, part in enumerate(parts):
                item_id = f'{order}.{part_index}'
                mapped = by_id.get(item_id) or {}
                lo, hi = mapped.get('from'), mapped.get('to')
                if not isinstance(lo, int) or not isinstance(hi, int) or not (1 <= lo <= hi <= len(key_lines)):
                    continue
                raw = '\n'.join(text for _, text in key_lines[lo - 1:hi])
                clean = answers.tidy(raw)
                if not clean or not answers.labels_agree(part.get('label') or '', clean) or not answers.usable_answer(clean, (items.get(item_id) or {}).get('text', '')):
                    continue
                tally['mapped'] += 1
                positions = [(page, locate(page, text, geo)) for page, text in key_lines[lo - 1:hi]]
                if not positions or any(box is None for _, box in positions) or len({page for page, _ in positions}) != 1:
                    tally['not_located'] += 1
                    continue
                page = positions[0][0]
                width, height, _ = geo[page]
                boxes = [box for _, box in positions]
                x0 = min(box['top_left_x'] for box in boxes)
                y0 = min(box['top_left_y'] for box in boxes)
                x1 = max(box['top_left_x'] + box['width'] for box in boxes)
                y1 = max(box['top_left_y'] + box['height'] for box in boxes)
                # One table box can span a page. It cannot truthfully be shown
                # as this part's answer, even when its text contains the row.
                if y1 - y0 > height * .28 or (x1 - x0) * (y1 - y0) > width * height * .32:
                    tally['wide_region'] += 1
                    continue
                # Key rows are scans, not transparent artwork. WebP preserves
                # the printed maths at this size while keeping a deployment
                # from carrying tens of megabytes of duplicate PDF pixels.
                name = f"{paper['sha256'][:12]}-key-p{page}-e{exercise['index']}-{part_index}.webp"
                output.append({'paper': path, 'index': exercise['index'], 'label': part.get('label') or '', 'image': f'/answer-figures/{name}',
                               'page': page, 'box': [round(x0), round(y0), round(x1 - x0), round(y1 - y0)]})
                if args.write:
                    import pypdfium2 as pdfium
                    target = FIGURES / name
                    if not target.exists():
                        FIGURES.mkdir(parents=True, exist_ok=True)
                        if document is None:
                            document = pdfium.PdfDocument(str(CORPUS / 'exams' / path))
                        image = document[page - 1].render(scale=width / document[page - 1].get_width()).to_pil()
                        pad = 10
                        image.crop((max(0, x0 - pad), max(0, y0 - pad), min(image.width, x1 + pad), min(image.height, y1 + pad))).save(target, 'WEBP', quality=88, method=6)
                tally['cropped'] += 1
        if document is not None:
            document.close()
    if args.write:
        OUT.write_text(json.dumps(output, ensure_ascii=False, indent=2), 'utf-8')
    print(json.dumps(tally, indent=2))
    print(f"{'wrote' if args.write else 'would write'} {len(output)} deterministic crop mappings")


if __name__ == '__main__':
    main()
