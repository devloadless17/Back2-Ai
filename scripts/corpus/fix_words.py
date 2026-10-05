# -*- coding: utf-8 -*-
r"""
Words cut by a space or run together, put back as the paper prints them.

    python scripts/corpus/fix_words.py <questions.jsonl> <words.json> <subject-ids.txt> <fixes.json> [--parts] [--write]

audit_words.py lists, per question, a word cut by a space ("d evelopment",
"الوق ائع") and two words run together ("theyield"). Each is taken back only
when the paper itself agrees:

  - a paper with a text layer (the Latin-script papers): the right form must
    be in it ("development" as one word, "the yield" as two) and the wrong one
    must not;
  - a scanned paper, which has none (the Arabic-taught subjects): a split word
    is joined on the corpus' word alone (30 of 30 right in the samples); a
    glued one is left, since Arabic glues its clitics.

Fixes go where the page reads the text, as {id, column, before, after} for
load-text-fixes.ts (<fixes.json>): the stored question and solution, and for
a question with parts its stored parts (column paper_parts). With --parts
--write the parts files are fixed too, where they still hold the broken
word, so a later parts load keeps the fix. Run it again after
    paper_parts.py, lang_parts.py or arabic_parts.py rebuild a file; a second
    run changes nothing.
"""
import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

import pdfplumber

sys.path.insert(0, str(Path(__file__).parent))
import paper_parts as pp  # noqa: E402

sys.stdout.reconfigure(encoding='utf-8')
ARABIC = re.compile(r'[ء-ي]')
MAPPING = pp.ROOT / 'corpus' / '.mapping'
TEXT_FIELDS = ('intro', 'passage', 'wholeKey', 'fullKey')
PART_FIELDS = ('text', 'answer')


def parts_files(folder=None):
    return sorted(p for p in Path(folder or MAPPING).glob('*parts.json') if not p.name.endswith('.bak'))


def papers_by_ref(subject_ids):
    """source_ref -> paper sha256, for every exercise in a parts file."""
    out = {}
    for path in parts_files():
        for p in json.load(open(path, encoding='utf-8')):
            for e in p.get('exercises') or []:
                for s in subject_ids:
                    ref = hashlib.sha256(f"{s}:{p['sha256']}:{e['index']}:{e['ordinal'] - 1}".encode()).hexdigest()
                    out[ref] = p['sha256']
    return out


_TEXT = {}


def paper_text(sha, paths):
    """The paper's own text layer, words separated by single spaces, lower case:
    read as usual, and read again with a tight gap between letters, which
    parts words the usual reading runs together ("fromthe", ls/2015 1/bio_en.pdf)."""
    if sha not in _TEXT:
        texts = ['', '']
        path = paths.get(sha)
        if path and (pp.ROOT / 'corpus' / 'exams' / path).exists():
            try:
                with pdfplumber.open(str(pp.ROOT / 'corpus' / 'exams' / path)) as pdf:
                    for i, tol in enumerate((3, 1)):
                        texts[i] = ' '.join(' '.join(w['text'] for w in page.extract_words(x_tolerance=tol))
                                            for page in pdf.pages)
            except Exception:
                texts = ['', '']
        _TEXT[sha] = tuple(' ' + re.sub(r'\s+', ' ', t).lower() + ' ' for t in texts)
    return _TEXT[sha]


def count_word(text, w):
    return len(re.findall(rf'(?<![^\W\d_]){re.escape(w)}(?![^\W\d_])', text))


def has_word(text, w):
    return re.search(rf'(?<![^\W\d_]){re.escape(w)}(?![^\W\d_])', text) is not None


_CHARS = {}


def visible_space(sha, paths, word, k):
    """Whether the printed page shows a space after the first k letters of
    `word`: the text layer of some papers has no space characters at all
    (ls/2015 1/bio_en.pdf "fromthe"), but the letters are placed with a gap.
    True when, at some place the paper prints the word, the gap at k is
    clearly wider than the gaps between its other letters."""
    if sha not in _CHARS:
        lines = []
        path = paths.get(sha)
        if path and (pp.ROOT / 'corpus' / 'exams' / path).exists():
            try:
                with pdfplumber.open(str(pp.ROOT / 'corpus' / 'exams' / path)) as pdf:
                    for page in pdf.pages:
                        rows = {}
                        for c in page.chars:
                            rows.setdefault(round(float(c['top'])), []).append(c)
                        for cs in rows.values():
                            cs.sort(key=lambda c: float(c['x0']))
                            lines.append(cs)
            except Exception:
                lines = []
        _CHARS[sha] = lines
    target = word.lower()
    for cs in _CHARS[sha]:
        text = ''.join(c['text'] for c in cs).lower()
        start = text.find(target)
        while start >= 0:
            run = cs[start:start + len(target)]
            gaps = [float(run[i]['x0']) - float(run[i - 1]['x1']) for i in range(1, len(run))]
            if len(gaps) >= 3:
                at = gaps[k - 1]
                others = sorted(g for i, g in enumerate(gaps) if i != k - 1)
                usual = others[len(others) // 2]
                if at >= 1.2 and at >= usual + 1.0 and at >= 3 * max(usual, 0.3):
                    return True
            start = text.find(target, start + 1)
    return False


def correction(f, texts, sha=None, paths=None):
    """(wrong, right) for one finding, or None when the paper does not agree."""
    text, tight = texts
    word = f['word']
    if f['kind'] == 'split':
        a, b = word.split(' ', 1)
        right = a + b
        if ARABIC.search(word):
            return word, right
        if text.strip() and has_word(text, right.lower()) and not has_word(text, word.lower()):
            return word, right
        return None
    if f['kind'] == 'glued' and not ARABIC.search(word):
        k = len(f['should_be'].split(' ', 1)[0])
        right = word[:k] + ' ' + word[k:]
        if text.strip() and has_word(text, right.lower()) and not has_word(text, word.lower()):
            return word, right
        if tight.strip() and has_word(tight, right.lower()) and not has_word(tight, word.lower()):
            return word, right
        if sha and visible_space(sha, paths, word, k):
            return word, right
        # Some text layers carry both ("from the" and "fromthe", ls/2015
        # 1/bio_en.pdf): the paper printing the two words somewhere is enough.
        # A real compound ("Hexanone", "runaway") has no such twin in its paper.
        # A word the paper itself prints three times or more is a word
        # ("runaway" in English SE 2009-1, "monoinsaturés"), not a slip.
        if text.strip() and has_word(text, right.lower()) and count_word(text, word.lower()) < 3:
            return word, right
    return None


MARKS = '[ً-ْٰـ]*'  # Arabic short vowels, shadda, tatweel
_GAP = r'[ \t   ​-‏]'
SEP = rf'(?:{_GAP}*-{_GAP}*|{_GAP}+)'  # "a b", "a- b", "a - b" ("inter - locuteurs")


def replace(s, wrong, right):
    """`wrong` replaced by `right` in `s`. The audit compares words without
    their Arabic vowel marks, and the two halves of a split word may stand
    apart by more than one space, so the match allows both; the marks are
    kept."""
    pattern = ''
    for c in wrong:
        # between the halves: spaces, a line-end hyphen ("expres- sion",
        # Francais SE 2013-1), or an invisible joiner or direction mark
        pattern += SEP if c == ' ' else re.escape(c) + MARKS
    pattern = rf'(?<![^\W\d_]){pattern}(?![^\W\d_])'
    if ' ' in wrong:  # split: the halves joined
        return re.sub(pattern, lambda m: re.sub(r'[-\s​-‏]', '', m.group(0)), s)
    k = right.index(' ')  # glued: a space after the first word's k letters

    def part(m):
        out, letters = '', 0
        for ch in m.group(0):
            if letters == k and not re.match(MARKS[:-1] + ']', ch):
                out += ' '
                letters = -1
            out += ch
            if letters >= 0 and not re.match(MARKS[:-1] + ']', ch):
                letters += 1
        return out
    return re.sub(pattern, part, s)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('questions')
    ap.add_argument('words')
    ap.add_argument('subject_ids')
    ap.add_argument('fixes')
    ap.add_argument('--parts', action='store_true', help='also fix the parts files')
    ap.add_argument('--write', action='store_true', help='write the parts files (else report)')
    ap.add_argument('--parts-dir', help='fix the parts files in this folder (default corpus/.mapping)')
    args = ap.parse_args()

    rows = {}
    for line in open(args.questions, encoding='utf-8'):
        r = json.loads(line)
        rows[r['id']] = r
    subject_ids = [l.strip() for l in open(args.subject_ids, encoding='utf-8') if l.strip()]
    sha_of = papers_by_ref(subject_ids)
    paths = {e['sha256']: e['path'].replace('\\', '/') for e in json.loads(pp.EXAMS.read_text(encoding='utf-8'))}

    accepted, refused = {}, []  # sha -> {wrong: right}
    per_row = {}  # id -> {wrong: right}
    for f in json.load(open(args.words, encoding='utf-8')):
        if f['kind'] not in ('split', 'glued'):
            continue
        r = rows.get(f['id'])
        if not r:
            continue
        sha = sha_of.get(r.get('source_ref') or '')
        texts = paper_text(sha, paths) if sha else ('', '')
        got = correction(f, texts, sha, paths)
        if not got:
            refused.append(f"{f['title']}: {f['word']!r} ({'no paper text' if not texts[0].strip() else 'the paper does not agree'})")
            continue
        per_row.setdefault(f['id'], {})[got[0]] = got[1]
        if sha:
            accepted.setdefault(sha, {})[got[0]] = got[1]

    # Questions stored as one text
    fixes = []
    for qid, pairs in per_row.items():
        r = rows[qid]
        pp_ = r.get('paper_parts')
        answered = bool(pp_) and any(p.get('answer') or p.get('answerImage') for p in pp_.get('parts') or [])
        columns = ['official_solution', 'official_solution_latex'] if not answered else []
        if not pp_:
            columns += ['content_text', 'content_latex']
        for col in columns:
            before = r.get(col)
            if not before:
                continue
            after = before
            for wrong, right in pairs.items():
                after = replace(after, wrong, right)
            if after != before:
                fixes.append({'id': qid, 'column': col, 'title': r['title'], 'before': before, 'after': after})
        # The stored parts: the database's own copy, so a row loaded from an
        # older parts file is fixed too. A later load from a fixed file writes
        # the same words.
        if pp_:
            new = json.loads(json.dumps(pp_))
            holders = [(new, k) for k in ('intro', 'fullKey')] + [(x, k) for x in new.get('parts') or [] for k in PART_FIELDS]
            for holder, key in holders:
                v = holder.get(key)
                if isinstance(v, str) and v:
                    for wrong, right in pairs.items():
                        v = replace(v, wrong, right)
                    holder[key] = v
            if new != pp_:
                fixes.append({'id': qid, 'column': 'paper_parts', 'title': r['title'], 'before': pp_, 'after': new})
    json.dump(fixes, open(args.fixes, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

    # Questions with parts: the parts files
    changed_files = {}
    if args.parts:
        for path in parts_files(args.parts_dir):
            papers = json.load(open(path, encoding='utf-8'))
            n = 0
            for p in papers:
                pairs = accepted.get(p['sha256'])
                if not pairs:
                    continue
                for e in p.get('exercises') or []:
                    holders = [(e, k) for k in TEXT_FIELDS] + [(x, k) for x in e.get('parts') or [] for k in PART_FIELDS]
                    for holder, key in holders:
                        v = holder.get(key)
                        if not isinstance(v, str) or not v:
                            continue
                        new = v
                        for wrong, right in pairs.items():
                            new = replace(new, wrong, right)
                        if new != v:
                            holder[key] = new
                            n += 1
            if n:
                changed_files[path.name] = n
                if args.write:
                    path.write_text(json.dumps(papers, ensure_ascii=False, indent=1), encoding='utf-8')

    print(f"accepted {sum(len(v) for v in per_row.values())} correction(s) in {len(per_row)} question(s); refused {len(refused)}")
    print(f"{len(fixes)} text column fix(es) -> {args.fixes}")
    for name, n in changed_files.items():
        print(f"  {'wrote' if args.write else 'would change'} {n} field(s) in {name}")
    for x in refused:
        print('  refused', x)


if __name__ == '__main__':
    main()
