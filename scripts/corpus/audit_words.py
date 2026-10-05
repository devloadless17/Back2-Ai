# -*- coding: utf-8 -*-
r"""
Shattered words in what a student reads on a past-paper page.

    python scripts/corpus/audit_words.py <questions.jsonl> <report-dir>

The input is the same export as audit-rendered-text.tsx (one JSON row per
question). The texts are the ones the page shows: the parts (intro, each part,
each answer, the full key) when the question has them, otherwise the question
and its solution. Formulas, images and table rules are left out.

The corpus is its own dictionary: a word the papers print correctly appears in
many questions, a damaged one in one. Three kinds are counted:

  split    a word cut by a space ("cardiovas cular", "الوق ائع"): the two
           pieces joined are a common word, and one piece is not.
  glued    two words run together ("theyield"): a token seen once that the
           papers print elsewhere as those two words (Latin script only;
           Arabic glues its clitics).
  misread  a letter typed twice ("وععلينا"): a token seen once that, with one
           of the two taken out, is a common word. Other misreadings
           ("الواقائع") are not caught: dropping any letter also turns plurals
           and prefixed words into common ones, and that was nearly every hit.

No database, no network, no model. Writes <report-dir>/words.json and prints
counts per track and subject.
"""
import collections
import json
import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')

MATH = re.compile(r'\$\$[\s\S]*?\$\$|\$[^$\n]*\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]')
NOISE = re.compile(r'!\[[^\]]*\]\([^)]*\)|https?://\S+|\\[a-zA-Z]+|`[^`]*`')
DIACRITICS = re.compile(r'[ً-ْـ]')
TOKEN = re.compile(r"[A-Za-zÀ-ÖØ-öø-ÿœŒ]+|[ء-ي]+")
ARABIC = re.compile(r'[ء-ي]')


def texts_of(row):
    """(where, text) pairs the page shows for this question."""
    pp = row.get('paper_parts') or None
    out = []
    answered = False
    if pp and isinstance(pp, dict) and pp.get('parts') is not None:
        out.append(('intro', pp.get('intro') or ''))
        for i, p in enumerate(pp.get('parts') or []):
            label = p.get('label') or str(i + 1)
            out.append((f'part {label}', p.get('text') or ''))
            if p.get('answer'):
                out.append((f'answer {label}', p['answer']))
            answered = answered or bool(p.get('answer') or p.get('answerImage'))
        if pp.get('fullKey'):
            out.append(('full key', pp['fullKey']))
    else:
        out.append(('question', row.get('content_latex') or row.get('content_text') or ''))
    if not answered:
        out.append(('solution', row.get('official_solution_latex') or row.get('official_solution') or ''))
    return [(w, t) for w, t in out if t]


def lines_of(text):
    text = NOISE.sub(' ', MATH.sub(' ', text))
    for line in text.split('\n'):
        yield [DIACRITICS.sub('', t) for t in TOKEN.findall(line)]


def norm(tok):
    return tok if ARABIC.search(tok) else tok.lower()


# A word that starts with one of these is one word ("antithyroglobulin",
# "nonvaccinated", "deposition"), not two run together.
PREFIXES = {'anti', 'non', 'de', 'dé', 'in', 'im', 'un', 're', 'ré', 'pre', 'pré', 'over', 'under',
            'out', 'demi', 'mal', 'sur', 'sous', 'inter', 'trans', 'counter', 'contre', 'multi', 'semi'}
COMPOUNDS = {('turn', 'over'), ('week', 'end'), ('soya', 'bean'), ('mean', 'time'), ('time', 'line'),
             ('slow', 'down'), ('work', 'less')}


def doubled_by_mistake(t, k, arabic):
    """t[k] repeats t[k-1]. Arabic writes doubles at its prefixes ("للدعم",
    "تتابع", "ووقف", "اللانتماء") and in "-يين"; a double anywhere else is a
    slip ("وععلينا", "فهمما"). Latin doubles letters all the time; only a
    doubled first letter ("Aand") is a slip."""
    if not arabic:
        return k == 1
    if k <= 1 or t[k] == 'ي':
        return False
    if k == 2 and t[0] in 'وفبلك':
        return False  # و + a word that starts with و
    if t[k] == 'ل' and t[:k - 1].endswith('ا'):
        return False  # ال + a word that starts with ل
    return True


def track_of(title):
    m = re.search(r' (GS|LS|SE|LH) ', title)
    return m.group(1) if m else '?'


def main():
    src, out_dir = sys.argv[1], Path(sys.argv[2])
    rows = [json.loads(l) for l in open(src, encoding='utf-8') if l.strip()]
    freq = collections.Counter()
    docs = collections.Counter()   # in how many questions a token appears
    pairs = collections.Counter()  # two words side by side, anywhere
    for row in rows:
        seen = set()
        for _, text in texts_of(row):
            for toks in lines_of(text):
                ns = [norm(t) for t in toks]
                for n in ns:
                    freq[n] += 1
                    seen.add(n)
                pairs.update(zip(ns, ns[1:]))
        docs.update(seen)

    def common(t, at_least=3):
        return docs[t] >= at_least

    findings = []
    counts = collections.defaultdict(lambda: collections.Counter())
    totals = collections.Counter()
    for row in rows:
        section = f"{track_of(row['title'])} | {row['subject']}"
        totals[section] += 1
        hit = set()
        for where, text in texts_of(row):
            for toks in lines_of(text):
                ns = [norm(t) for t in toks]
                for i, t in enumerate(ns):
                    arabic = bool(ARABIC.search(t))
                    # split: t + next is common, one of the two is not
                    if i + 1 < len(ns):
                        a, b = t, ns[i + 1]
                        joined = a + b
                        if (len(joined) >= 6 and common(joined, 3) and (docs[a] <= 1 or docs[b] <= 1)
                                and bool(ARABIC.search(b)) == arabic):
                            hit.add(('split', where, f'{toks[i]} {toks[i + 1]}', joined))
                    if docs[t] > 1:
                        continue
                    # glued: rare long Latin token that the papers print elsewhere
                    # as those two words side by side ("the yield")
                    if not arabic and len(t) >= 6:
                        for k in range(2, len(t) - 1):
                            if t[:k] in PREFIXES or (t[:k], t[k:]) in COMPOUNDS:
                                continue  # anti-, non-, in-: one word on its own
                            if pairs[(t[:k], t[k:])] >= 2:
                                hit.add(('glued', where, toks[i], f'{t[:k]} {t[k:]}'))
                                break
                    # misread: a letter typed twice ("وععلينا"); one of them out
                    # is a common word
                    if len(t) >= 4:
                        for k in range(1, len(t)):
                            if t[k] != t[k - 1] or not doubled_by_mistake(t, k, arabic):
                                continue
                            v = t[:k] + t[k + 1:]
                            if docs[v] >= 5:
                                hit.add(('misread', where, toks[i], v))
                                break
        for kind, where, word, fix in sorted(hit):
            counts[section][kind] += 1
            findings.append({'kind': kind, 'id': row['id'], 'cycle': row['cycle'], 'title': row['title'],
                             'subject': row['subject'], 'where': where, 'word': word, 'should_be': fix})

    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / 'words.json').write_text(json.dumps(findings, ensure_ascii=False, indent=1), encoding='utf-8')
    per_q = collections.defaultdict(lambda: collections.defaultdict(set))
    for f in findings:
        per_q[f"{track_of(f['title'])} | {f['subject']}"][f['kind']].add(f['id'])
    print(f"{'section':46} questions  split glued misread   (questions affected)")
    for section in sorted(totals):
        q = per_q[section]
        print(f"{section:46} {totals[section]:9} {len(q['split']):6} {len(q['glued']):5} {len(q['misread']):7}")
    print(f"\n{len(findings)} findings in {len({f['id'] for f in findings})} questions of {len(rows)}")


if __name__ == '__main__':
    main()
