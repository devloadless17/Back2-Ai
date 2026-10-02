# -*- coding: utf-8 -*-
"""Crop only verifiable answer rows from every accepted paper-parts mapping.

No OCR, model, network or database is used.  A crop needs both an answer that
the scheme parser already accepted by printed label and one unique bounded
region in the original PDF's Mathpix geometry.  The report explains every
withheld candidate instead of silently treating a full page as an answer.
"""
import argparse
import collections
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CORPUS = ROOT / 'corpus'
SOURCE = CORPUS / '.mapping' / 'paper-parts.json'
OUT = CORPUS / 'official-answer-crops.json'
FIGURES = ROOT / 'public' / 'answer-figures'


def norm(text):
    return re.sub(r'[^a-z0-9]+', '', text.lower())


def geometry(sha):
    source = CORPUS / 'meta' / sha / 'lines.json'
    if not source.exists():
        return {}
    out = {}
    for page in json.loads(source.read_text('utf-8')).get('pages', []):
        width, height = page.get('page_width'), page.get('page_height')
        rows = []
        for line in page.get('lines', []):
            box = line.get('region') or {}
            if line.get('text') and all(isinstance(box.get(k), (int, float)) for k in ('top_left_x', 'top_left_y', 'width', 'height')):
                rows.append((line['text'], box))
        if width and height:
            out[page['page']] = (width, height, rows)
    return out


def evidence_line(answer):
    for line in answer.splitlines():
        line = re.sub(r'^\s*(?:\*\*[^*]+\*\*|[-*])\s*', '', line).strip()
        if len(norm(line)) >= 12:
            return line
    return ''


def locate(answer, pages):
    needle = norm(evidence_line(answer))
    if not needle:
        return None, 'no readable answer line'
    hits = []
    for page, (_, _, rows) in pages.items():
        for text, box in rows:
            candidate = norm(text)
            if len(candidate) >= 12 and (needle in candidate or candidate in needle):
                hits.append((page, box))
    if len(hits) != 1:
        return None, 'no unique page region' if not hits else 'ambiguous page region'
    page, box = hits[0]
    width, height, _ = pages[page]
    if box['height'] > height * .28 or box['width'] * box['height'] > width * height * .32:
        return None, 'region is a table or page'
    return (page, box), None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--write', action='store_true')
    args = ap.parse_args()
    results, reasons, subjects = [], collections.Counter(), collections.Counter()
    for paper in json.loads(SOURCE.read_text('utf-8')):
        pages = geometry(paper['sha256'])
        for exercise in paper.get('exercises', []):
            if exercise.get('answers', {}).get('status') != 'ok':
                continue
            for part_index, part in enumerate(exercise.get('parts', [])):
                answer = part.get('answer')
                if not answer:
                    continue
                if not pages:
                    reasons['no page geometry'] += 1
                    subjects[(paper['subject'], 'no page geometry')] += 1
                    continue
                hit, reason = locate(answer, pages)
                if not hit:
                    reasons[reason] += 1
                    subjects[(paper['subject'], reason)] += 1
                    continue
                page, box = hit
                name = f"{paper['sha256'][:12]}-key-p{page}-e{exercise['index']}-{part_index}.webp"
                results.append({'paper': paper['paper'], 'index': exercise['index'], 'label': part['label'],
                                'image': f'/answer-figures/{name}', 'page': page,
                                'box': [round(box['top_left_x']), round(box['top_left_y']), round(box['width']), round(box['height'])]})
                if args.write:
                    target = FIGURES / name
                    if not target.exists():
                        import pypdfium2 as pdfium
                        FIGURES.mkdir(parents=True, exist_ok=True)
                        doc = pdfium.PdfDocument(str(CORPUS / 'exams' / paper['paper']))
                        try:
                            width = pages[page][0]
                            image = doc[page - 1].render(scale=width / doc[page - 1].get_width()).to_pil()
                            pad = 10
                            x, y, w, h = box['top_left_x'], box['top_left_y'], box['width'], box['height']
                            image.crop((max(0, x - pad), max(0, y - pad), min(image.width, x + w + pad), min(image.height, y + h + pad))).save(target, 'WEBP', quality=88, method=6)
                        finally:
                            doc.close()
    if args.write:
        OUT.write_text(json.dumps(results, ensure_ascii=False, indent=2), 'utf-8')
    print(f"{'wrote' if args.write else 'would write'} {len(results)} answer crops")
    print('withheld by reason:')
    for reason, count in reasons.most_common(): print(f'  {count:5}  {reason}')
    print('largest subject gaps:')
    for (subject, reason), count in subjects.most_common(20): print(f'  {count:5}  {subject}: {reason}')


if __name__ == '__main__':
    main()
