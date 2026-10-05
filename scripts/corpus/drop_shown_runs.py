# -*- coding: utf-8 -*-
r"""
Loose lines that repeat a picture the question already shows, taken out.

    python scripts/corpus/drop_shown_runs.py <questions.jsonl> <audit.json> <visuals.jsonl> <fixes.json>

A run of fragment lines (audit-rendered-text.tsx "loose") on a question that
has pictures of its paper (question_visuals) is often that picture's own text
layer, leaked into the question: the graph's axis labels, the table's cells
(Life Sciences LS 2018-2: "Document 2 / Excitatory neuron / Neuron that /
releases dopamine …" under the drawing it came from). The page shows both.

Each run line is found as consecutive words on the pictures' pages. The run
is dropped only when most of its lines are found there and nearly all the
found words lie inside a picture the question shows. Otherwise it stays.

visuals.jsonl: one row per active visual: question_id, paper_sha256, page,
bbox_x, bbox_y, bbox_w, bbox_h, page_width, page_height. Writes {id, column,
before, after} for load-text-fixes.ts.
"""
import collections
import json
import sys
from pathlib import Path

import pdfplumber

sys.path.insert(0, str(Path(__file__).parent))
import loose_documents as ld  # noqa: E402
import paper_parts as pp  # noqa: E402

sys.stdout.reconfigure(encoding='utf-8')


def main():
    questions, audit, visuals_path, out = sys.argv[1:5]
    rows = {}
    for line in open(questions, encoding='utf-8'):
        r = json.loads(line)
        rows[r['id']] = r
    visuals = collections.defaultdict(list)
    for line in open(visuals_path, encoding='utf-8'):
        v = json.loads(line)
        visuals[v['question_id']].append(v)
    paths = {e['sha256']: e['path'].replace('\\', '/')
             for e in json.loads(pp.EXAMS.read_text(encoding='utf-8'))}
    findings = [f for f in json.load(open(audit, encoding='utf-8'))
                if f['kind'] == 'loose' and f['where'] == 'question' and visuals.get(f['id'])]

    texts, done, left = {}, [], []
    for f in findings:
        r = rows[f['id']]
        vs = visuals[f['id']]
        sha = vs[0]['paper_sha256']
        path = paths.get(sha)
        if not path or not (pp.ROOT / 'corpus' / 'exams' / path).exists():
            left.append(f"{r['title']}: paper not found")
            continue
        column = 'content_latex' if r.get('content_latex') else 'content_text'
        text0 = texts.get((r['id'], column), r.get(column)) or ''
        at = ld.run_span(text0, f['sample'])
        if not at:
            left.append(f"{r['title']}: run not found in the stored text")
            continue
        want = [ld.norm(l) for l in at[2] if len(ld.norm(l)) >= 3]
        if len(want) < 2:
            left.append(f"{r['title']}: run too short to place")
            continue
        found, inside, outside = 0, 0, 0
        with pdfplumber.open(str(pp.ROOT / 'corpus' / 'exams' / path)) as pdf:
            for page_no in sorted({v['page'] for v in vs if v['paper_sha256'] == sha}):
                page = pdf.pages[page_no - 1]
                boxes = []
                for v in vs:
                    if v['paper_sha256'] != sha or v['page'] != page_no:
                        continue
                    sx, sy = float(page.width) / v['page_width'], float(page.height) / v['page_height']
                    boxes.append((v['bbox_x'] * sx - 3, v['bbox_y'] * sy - 3,
                                  (v['bbox_x'] + v['bbox_w']) * sx + 3, (v['bbox_y'] + v['bbox_h']) * sy + 3))
                words = page.extract_words()
                keys = [ld.norm(w['text']) for w in words]
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
                    if not hit:
                        continue
                    found += 1
                    for w in hit:
                        cx = (float(w['x0']) + float(w['x1'])) / 2
                        cy = (float(w['top']) + float(w['bottom'])) / 2
                        if any(b[0] <= cx <= b[2] and b[1] <= cy <= b[3] for b in boxes):
                            inside += 1
                        else:
                            outside += 1
        if found < max(2, 0.6 * len(want)) or inside < 0.9 * (inside + outside):
            left.append(f"{r['title']}: {found}/{len(want)} lines found, {inside} words in a picture, {outside} outside")
            continue
        for col in ('content_latex', 'content_text'):
            key = (r['id'], col)
            text = texts.get(key, r.get(col))
            if not text:
                continue
            span = ld.run_span(text, f['sample'])
            if span:
                texts[key] = text[:span[0]].rstrip() + '\n\n' + text[span[1]:].lstrip()
        done.append(f"{r['title']}: {found}/{len(want)} lines found, all in its pictures")

    fixes = [{'id': qid, 'column': col, 'title': rows[qid]['title'], 'before': rows[qid][col], 'after': t}
             for (qid, col), t in texts.items() if t != rows[qid].get(col)]
    json.dump(fixes, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    for d in done:
        print('drop', d)
    for l in left:
        print('keep', l)
    print(f'dropped {len(done)} run(s); kept {len(left)}; {len(fixes)} column fix(es) -> {out}')


if __name__ == '__main__':
    main()
