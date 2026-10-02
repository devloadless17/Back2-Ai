# -*- coding: utf-8 -*-
"""Every exam paper we hold, and whether we can read it.

    python scripts/corpus/audit_exams.py

`extract_exams.py` reports totals. This reports the losses, grouped the way a
decision gets made about them: by subject, because a parser is written for a
paper layout and a layout belongs to a subject, and by track, because a gap in
one track is a gap in one student's practice however healthy the total looks.

Nothing is written. It re-reads the PDFs and counts.
"""

import re
import sys
from collections import Counter, defaultdict

sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent))
import extract_exams as E

# Keep this in the same order as load-exams.ts: a suffix such as ``_ar`` or
# ``_en`` is the edition of a science paper, while the same token on its own is
# an Arabic or English paper.  The old substring list missed the corpus' real
# spellings (tarekh/terekh, phy, ejteme and Fran), falsely reporting 298 papers
# as unidentified even though the loader classified most of them correctly.
SUBJECT_HINTS = [
    ('Maths',      re.compile(r'(?:^|[\s_-])(?:math|riyad)', re.I)),
    ('Physics',    re.compile(r'(?:^|[\s_-])(?:phys?|fizi)', re.I)),
    ('Chemistry',  re.compile(r'(?:^|[\s_-])(?:chem|chim|kimi)', re.I)),
    ('Biology',    re.compile(r'(?:^|[\s_-])(?:bio|svt|ahya|svsg)', re.I)),
    ('Philosophy', re.compile(r'(?:^|[\s_-])(?:falsafe?|philo)', re.I)),
    ('Geography',  re.compile(r'(?:^|[\s_-])(?:geo|greo|joghraf)', re.I)),
    ('Sociology',  re.compile(r'(?:^|[\s_-])(?:ejteme|ejtema|socio)', re.I)),
    ('Economics',  re.compile(r'(?:^|[\s_-])(?:ektesad|eqtesad|eco(?:no)?)', re.I)),
    ('Civics',     re.compile(r'(?:^|[\s_-])(?:civ|tarbeya|tarbia)', re.I)),
    ('History',    re.compile(r'(?:^|[\s_-])(?:tarekh|terekh|tarikh|history|hsitory)', re.I)),
    ('English',    re.compile(r'(?:^|[\s_-])(?:eng|english|emg)|(?:^|[\s_-])en(?:[\s_.-]|$)', re.I)),
    ('French',     re.compile(r'(?:^|[\s_-])(?:fr|fran|french|francais|français)(?:[\s_.-]|$)', re.I)),
    ('Arabic',     re.compile(r'(?:^|[\s_-])(?:arabe|arabic|arabeye|ar|ra)(?:[\s_.-]|$)', re.I)),
]


def subject_of(name: str) -> str:
    for label, pattern in SUBJECT_HINTS:
        if pattern.search(name):
            return label
    return 'unidentified'


def reason_of(result: dict) -> str:
    error = result.get('error')
    if not error:
        return 'parsed'
    if 'no exercise headers' in error:
        return 'no exercise headers'
    if 'implausible' in error:
        return 'implausible parse'
    if 'no text' in error or 'image' in error:
        return 'no text layer (scan)'
    return re.sub(r'\(.*?\)', '', error).strip()[:40]


def main() -> None:
    by_subject = defaultdict(Counter)
    by_track = defaultdict(Counter)
    reasons = Counter()
    total = 0

    for track in ('gs', 'ls', 'lh', 'se'):
        for pdf in sorted(E.EXAMS.glob(f'{track}/*/*.pdf')):
            total += 1
            try:
                result = E.read(pdf)
            except Exception as exc:                       # noqa: BLE001
                result = {'error': f'crashed: {type(exc).__name__}'}
            reason = reason_of(result)
            subject = subject_of(pdf.name)
            by_subject[subject][reason] += 1
            by_track[track][reason] += 1
            reasons[reason] += 1
            if total % 250 == 0:
                print(f'  … {total} papers read', flush=True)

    print(f'\n{total} papers on disk\n')
    print('  reason                        papers   share')
    for reason, n in reasons.most_common():
        print(f'  {reason[:28]:<30}{n:>6}   {n / total * 100:4.1f}%')

    print('\n  by subject:')
    print(f'  {"subject":<16}{"papers":>7}{"parsed":>8}{"rate":>7}   biggest failure')
    for subject in sorted(by_subject, key=lambda s: -sum(by_subject[s].values())):
        counts = by_subject[subject]
        n = sum(counts.values())
        ok = counts.get('parsed', 0)
        worst = next((f'{r} ({c})' for r, c in counts.most_common() if r != 'parsed'), '—')
        print(f'  {subject:<16}{n:>7}{ok:>8}{ok / n * 100:6.0f}%   {worst[:40]}')

    print('\n  by track:')
    for track in ('gs', 'ls', 'lh', 'se'):
        counts = by_track[track]
        n = sum(counts.values())
        ok = counts.get('parsed', 0)
        if n:
            print(f'  {track:<6}{n:>6} papers{ok:>6} parsed{ok / n * 100:6.0f}%')


if __name__ == '__main__':
    main()
