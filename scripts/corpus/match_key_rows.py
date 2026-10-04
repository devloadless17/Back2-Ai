# -*- coding: utf-8 -*-
"""Which answer-key row answers which part — for the exercises the label rules could not bind.

    python scripts/corpus/match_key_rows.py --estimate          # cost only, no calls
    python scripts/corpus/match_key_rows.py --max-usd 1         # writes corpus/.mapping/key-row-matches.json

paper_parts.py binds a key's rows to an exercise's parts by label. Where the
key and the extracted parts number things differently ("B3" against B.1 a/b,
an exercise heading the reader missed, a part the extractor lost), the rows
are clean and the parts are right but no rule can pair them.

THE MODEL ONLY POINTS. It is shown the paper's exercises and parts and the
key's numbered rows, and returns, per row, the id of the part it answers or
null. What is stored is the row as the key prints it; paper_parts.py then
judges the pairing exactly as it judges its own: printed order, marks adding
up to the exercise's header, the answers reading like this exercise and no
other, the page's renderer.

Only papers with an exercise that split into parts but got no answers are
sent. Cached per paper and per the exact prompt, so a re-run costs nothing.
Spend is metered from the usage the API reports, and the run stops at the cap.
"""
import argparse
import hashlib
import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.stdout.reconfigure(encoding='utf-8')

import ocr_pdf  # noqa: E402
import paper_parts as pp  # noqa: E402

MODEL = 'gpt-4.1-mini'
PRICE_IN, PRICE_OUT = 0.40, 1.60  # USD per million tokens
CACHE = pp.ROOT / 'corpus' / 'key-row-match-cache'
TRY_AGAIN = {'orphan rows', 'out of order', 'marks disagree', 'no rows for exercise'}

SYSTEM = """You match the rows of a Lebanese Baccalaureate official answer key to the parts of the exam's exercises.

You get the exercises with their parts (each part has an id like "E2:1.3" and the start of its text), and the answer key's rows (numbered; each shows the label printed in the key, its marks, and the start of its answer).
For every row, give the id of the part it answers, or null when it answers none (a heading or title row, a row for another track's version, a row you cannot place).
Rules:
- A part may take several consecutive rows. A row answers at most one part.
- Use the key's printed labels, the order of the rows, and above all the content: an answer computes or states what its part asks.
- The key may number differently from the parts (letters for numbers, a missing section letter); content decides.
- Never invent an id. Reply with JSON only: {"rows": [{"row": 1, "part": "E1:1.1"}, ...]} covering every row."""


def plain(text, n):
    return re.sub(r'\s+', ' ', text or '').strip()[:n]


def prompt_for(exam, built, rows):
    lines = ['EXERCISES:']
    for rec in built:
        ex = next(e for e in exam['exercises'] if e['index'] == rec['index'])
        lines.append(f"Exercise E{rec['ordinal']} ({ex['marks']} points) {plain(ex.get('title'), 60)}")
        for p in rec.get('parts') or []:
            lines.append(f"  id E{rec['ordinal']}:{p['label']} | {plain(p['text'], 120)}")
        if not rec.get('parts'):
            lines.append('  (no parts)')
    lines.append('\nANSWER KEY ROWS:')
    for r in rows:
        mark = '' if r['marks'] is None else f"{r['marks']} pt"
        lines.append(f"row {r['rid'] + 1} | key label: {r['label'] or '-'} | {mark} | {plain(r['answer'], 160)}")
    return '\n'.join(lines)


def ask(key, prompt):
    body = {
        'model': MODEL,
        'response_format': {'type': 'json_object'},
        'messages': [{'role': 'system', 'content': SYSTEM}, {'role': 'user', 'content': prompt}],
        'max_completion_tokens': 6000,
        'temperature': 0,
    }
    req = urllib.request.Request(ocr_pdf.OPENAI_API, data=json.dumps(body).encode(),
                                 headers={'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                payload = json.load(r)
            return json.loads(payload['choices'][0]['message']['content'] or '{}'), payload.get('usage', {})
        except (urllib.error.HTTPError, OSError, json.JSONDecodeError):
            if attempt == 3:
                raise
            time.sleep(10 * (attempt + 1))
    return {}, {}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--estimate', action='store_true')
    ap.add_argument('--max-usd', type=float, default=1.0)
    ap.add_argument('--track', default='gs')
    args = ap.parse_args()

    exams = json.loads(pp.EXAMS.read_text(encoding='utf-8'))
    display = {(d['sha256'], d['ordinal']): d['markdown']
               for d in json.loads(pp.DISPLAY.read_text(encoding='utf-8'))
               if d.get('verdict') == 'ok' and d.get('markdown')}
    display.update(pp.recover_display(display, {e['sha256']: e for e in exams}, args.track))

    # Placements are stored per PDF. A PDF another track also files
    # (ls/2004 2/math_en.pdf is gs/2004 2's) keeps the placements made for it there.
    placed = json.loads(pp.MATCHES.read_text(encoding='utf-8')) if pp.MATCHES.exists() else {}
    elsewhere = {e['sha256'] for e in exams if not e['path'].replace('\\', '/').startswith(args.track + '/')}

    jobs = []
    for exam in exams:
        path = exam['path'].replace('\\', '/')
        if not path.startswith(args.track + '/') or not pp.subject_of(exam['file']):
            continue
        if exam['sha256'] in placed and exam['sha256'] in elsewhere:
            continue
        if pp.ADAPTED.search(exam['file']) or pp.ARABIC_EDITION.search(exam['file']) or exam['language'] == 'ar':
            continue
        built = pp.build_paper(exam, display)
        if not any(r['status'] == 'split' and r['answers']['status'] in TRY_AGAIN and not r.get('matchedBy')
                   for r in built):
            continue
        rows, why = pp.paper_rows(exam)
        if why or not rows:
            continue
        jobs.append((exam, built, rows, prompt_for(exam, built, rows)))

    chars = sum(len(SYSTEM) + len(j[3]) for j in jobs)
    est = chars / 4 / 1e6 * PRICE_IN + len(jobs) * 1500 / 1e6 * PRICE_OUT
    print(f'papers to send: {len(jobs)}; estimated cost ${est:.2f}')
    if args.estimate:
        return

    CACHE.mkdir(parents=True, exist_ok=True)
    key = ocr_pdf.api_key(MODEL)
    out = json.loads(pp.MATCHES.read_text(encoding='utf-8')) if pp.MATCHES.exists() else {}
    spent = 0.0
    for exam, built, rows, prompt in jobs:
        h = hashlib.sha256((MODEL + SYSTEM + prompt).encode()).hexdigest()[:24]
        cached = CACHE / f'{h}.json'
        if cached.exists():
            reply = json.loads(cached.read_text(encoding='utf-8'))
        else:
            if spent >= args.max_usd:
                print(f'cap reached at ${spent:.3f}; stopping')
                break
            reply, usage = ask(key, prompt)
            spent += usage.get('prompt_tokens', 0) / 1e6 * PRICE_IN + usage.get('completion_tokens', 0) / 1e6 * PRICE_OUT
            cached.write_text(json.dumps(reply, ensure_ascii=False), encoding='utf-8')
        ids = {f"E{rec['ordinal']}:{p['label']}": (rec['ordinal'], p['label'])
               for rec in built for p in rec.get('parts') or []}
        paper = {}
        for item in reply.get('rows') or []:
            try:
                rid = int(item.get('row')) - 1
            except (TypeError, ValueError):
                continue
            part = ids.get(item.get('part') or '')
            if 0 <= rid < len(rows) and part:
                # The row's label and first words too: paper_parts finds the row
                # by them when a change to the key's reading moves its position.
                paper[str(rid)] = list(part) + [pp.row_print(rows[rid])]
        out[exam['sha256']] = paper
        print(f"  {exam['path'].replace(chr(92), '/')}: {len(paper)}/{len(rows)} rows placed  (spent ${spent:.3f})")
    pp.MATCHES.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding='utf-8')
    print(f'wrote {pp.MATCHES}; spent ${spent:.3f} this run')


if __name__ == '__main__':
    main()
