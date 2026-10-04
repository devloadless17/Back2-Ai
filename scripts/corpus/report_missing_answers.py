# -*- coding: utf-8 -*-
"""
Which past-paper parts of a track still show no official answer, and why.

    python scripts/corpus/report_missing_answers.py     # writes corpus/reports/gs-missing-answers.md
    python scripts/corpus/report_missing_answers.py --track ls   # ls-missing-answers.md

Read from the files the loader writes from (paper_parts.py, lang_parts.py,
crop_gs_key_cells.py), so it lists what the page will show after a load.
Two kinds of gap, kept apart because only one can be fixed:

  NOT IN THE ORIGINAL — the PDF has no answer to show. Checked by reading the
  PDFs (2026-10-03): no key pages at all, the wrong file, or a key cell that
  prints only the word "Figure".
  IN THE ORIGINAL, NOT SHOWN YET — the key has it; the readers could not
  place it on its part without doubt, so the part was left empty rather than
  given a guess.
"""
import argparse
import collections
import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
ROOT = Path(__file__).resolve().parents[2]
MAP = ROOT / 'corpus' / '.mapping'

# Read page by page on 2026-10-03.
# CRDP checked 2026-10-04: it publishes no GS chemistry for 2005 at all, the
# 2021-2 files without keys (the same bytes we hold), and for English 2006
# only the June paper, under both session labels. Students get the answer
# written on request (labelled) for these.
NOT_IN_ORIGINAL = {
    'gs/2005 1/gs chemistry_en 1.pdf': 'the PDF has the questions only, no key; CRDP has no GS chemistry 2005',
    'gs/2021 2/SG_Chim_2021_2_En.pdf': 'the PDF has the questions only, no key; CRDP publishes it without one',
    'gs/2021 2/SG_Chim_2021_2_Fr.pdf': 'the PDF has the questions only, no key; CRDP publishes it without one',
    'gs/2006 2/eng.pdf': ('wrong file: byte for byte the French 2006 session-1 paper; the August 2006 English '
                          'paper is not on CRDP either (both labels serve the June one)'),
    # LS, read 2026-10-04.
    'ls/2006 2/eng.pdf': 'wrong file: byte for byte the French 2006 session-1 paper (as gs/2006 2/eng.pdf)',
    'ls/2017 1/bio_en.pdf': ('no key in the PDF: its last two pages are exercises 3 and 4, which the extractor '
                             'took for a key, so those two exercises are not in the database either'),
    'ls/2017 1/bio_fr.pdf': 'no key in the PDF; as ls/2017 1/bio_en.pdf, exercises 3 and 4 were read as a key',
    'ls/2019 1/bio_en.pdf': 'the PDF has the questions only (4 pages), no key; the French key is a separate file',
}
NOTES = {
    'gs/2004 2/chem_en.pdf': 'the file is the key only, no questions',
    'gs/2011 2/eng.pdf': 'the database stored this paper\'s key as its question text; hidden for GS, shown split for LS',
    'gs/2004 1/2004 gs arabe 1.pdf': ('wrong file (a French paper; its rows are hidden). FIXED 2026-10-04: the real '
                                      'GS/LS paper, ls/2004 1/arabe_crdp.pdf, is filed for GS as gs/2004 1/arabe_crdp.pdf; '
                                      'its third "exercise" was the answer key and is hidden'),
    'gs/2006 2/tarbeya.pdf': 'the key\'s rows slid (part 3 shows question 1\'s answer): left as one block',
    'gs/2012 2/arabe.pdf': 'passage paragraphs and questions mixed, answers shifted by one: left as one block',
    'gs/2017 2/arabe.pdf': 'passage paragraphs and questions mixed: left as one block',
}
SUBJECT = [('chem', 'Chemistry'), ('chim', 'Chemistry'), ('phy', 'Physics'), ('math', 'Maths'), ('eng', 'English'), ('fr', 'French')]


def subject_of(paper):
    name = paper.rsplit('/', 1)[-1].lower()
    for key, label in SUBJECT:
        if key in name:
            return label
    return 'Other'


def is_heading(parts, k):
    own = parts[k]['label']
    return any(j != k and p['label'].startswith(own + '.') for j, p in enumerate(parts))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--track', default='gs')
    track = ap.parse_args().track
    out = ROOT / 'corpus' / 'reports' / f'{track}-missing-answers.md'
    crops = {(c['paper'], c['index'], c['label'])
             for c in json.loads((ROOT / 'corpus' / f'{track}-key-cell-crops.json').read_text('utf-8'))}
    for name in ('science-answer-crops.json', 'official-answer-crops.json'):
        f = ROOT / 'corpus' / name
        if f.exists():
            crops |= {(c['paper'], c['index'], c['label']) for c in json.loads(f.read_text('utf-8'))}
    no_drawing = {(m['paper'], m['index'], m['label'])
                  for m in json.loads((MAP / f'{track}-key-no-drawing.json').read_text('utf-8'))}
    lang = MAP / ('lang-parts.json' if track == 'gs' else f'{track}-lang-parts.json')
    papers = json.loads((MAP / f'{track}-paper-parts.json').read_text('utf-8')) + \
        [p for p in json.loads(lang.read_text('utf-8')) if p['paper'].startswith(track + '/')]
    exams = {e['path'].replace('\\', '/'): e for e in json.loads((ROOT / 'corpus' / 'exams.json').read_text('utf-8'))}

    gone = collections.defaultdict(list)    # subject -> lines: not in the original
    unplaced = collections.defaultdict(list)  # subject -> lines: in the key, not shown
    totals = collections.Counter()
    seen = set()
    for p in papers:
        paper = p['paper']
        seen.add(paper)
        subj = subject_of(paper)
        if paper in NOT_IN_ORIGINAL:
            gone[subj].append(f'- {paper}: whole paper — {NOT_IN_ORIGINAL[paper]}')
            totals['papers not in the original'] += 1
            continue
        for e in p['exercises']:
            parts = e.get('parts') or []
            status = (e.get('answers') or {}).get('status') or e.get('status')
            if e.get('wholeKey'):
                totals['exercises shown as one whole key'] += 1
                continue
            if not parts:
                unplaced[subj].append(f'- {paper} — exercise {e["ordinal"]}: not split into parts ({status});'
                                      ' the page shows the older whole solution where one is stored')
                totals['exercises not split'] += 1
                continue
            missing, gone_here = [], []
            for k, part in enumerate(parts):
                if is_heading(parts, k) or part['label'] == 'II':
                    continue  # a heading; or a language paper's writing task, which the key marks by grid
                totals['parts'] += 1
                key = (paper, e['index'], part['label'])
                if (part.get('answer') and status == 'ok') or key in crops:
                    totals['parts answered'] += 1
                elif key in no_drawing:
                    gone_here.append(part['label'])
                else:
                    missing.append(part['label'])
            if gone_here:
                gone[subj].append(f'- {paper} — exercise {e["ordinal"]}, part {", ".join(gone_here)}:'
                                  ' the key prints only "Figure", no drawing')
                totals['parts not in the original'] += len(gone_here)
            if missing:
                why = '' if status == 'ok' else f' (whole exercise: {status})'
                unplaced[subj].append(f'- {paper} — exercise {e["ordinal"]}, part {", ".join(missing)}{why}')
                totals['parts in the key, not shown'] += len(missing)
    for paper, why in NOT_IN_ORIGINAL.items():
        if paper not in seen and paper.startswith(track + '/'):
            gone[subject_of(paper)].append(f'- {paper}: whole paper — {why}')
            totals['papers not in the original'] += 1

    lines = [f'# {track.upper()} past papers: answers still missing', '',
             'Made by scripts/corpus/report_missing_answers.py from the files the loader reads.',
             'Headings whose sub-parts carry the answers, and the writing tasks of the language papers,',
             'are not counted.', '',
             f"Parts counted: {totals['parts']}. Answered (text or a cut from the key): {totals['parts answered']}.", '',
             '## Not in the original paper', '',
             'Nothing can be shown: the PDF itself has no answer here.', '']
    for subj in sorted(gone):
        lines += [f'### {subj}', ''] + gone[subj] + ['']
    lines += ['## In the original key, not shown yet', '',
              'The key has these answers; the readers could not place them on their part without doubt.',
              'Each one needs a person to match it, or a better reader.', '']
    for subj in sorted(unplaced):
        lines += [f'### {subj} ({len(unplaced[subj])} exercises)', ''] + unplaced[subj] + ['']
    lines += ['## Notes', ''] + [f'- {k}: {v}' for k, v in NOTES.items() if k.startswith(track + '/')] + ['']
    lines += ['## Totals', ''] + [f'- {k}: {v}' for k, v in sorted(totals.items())] + ['']
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text('\n'.join(lines), encoding='utf-8')
    for k, v in sorted(totals.items()):
        print(f'{k}: {v}')
    print(f'wrote {out}')


if __name__ == '__main__':
    main()
