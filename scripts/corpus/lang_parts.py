# -*- coding: utf-8 -*-
"""
English and French papers as their printed parts, each with the key's answer.

    python scripts/corpus/lang_parts.py                     # GS, writes corpus/.mapping/lang-parts.json
    python scripts/corpus/lang_parts.py --show "gs/2018 1/eng.pdf"

WHY A SECOND READER. paper_parts.py builds on the extractor's part labels and
on Mathpix's text; a language paper has neither to give. The extractor's
labels for these papers are unreliable (gs/2018 1/eng.pdf: A.1 … A.4, B.1 …
B.3, E.1 … E.4, E.1 — sections C, D and F lost), and Mathpix never read them.
But they are prose, and the PDF's own text layer is clean for prose (see the
2026-10-01 passage re-extraction). And their keys are ruled tables that
pdfplumber reads cell by cell: Q | Answer | Score (English), Partie de la Q. |
Eléments de réponse | Critères d'évaluation | Note (French).

So the paper is read here from the PDF: the passage, then the questions, each
labelled by the section, number and letter it prints ("A." "1." "a."), and
the key's rows are bound to them by those labels ("I-A-1", "I.3.a.").

Output is in paper_parts.py's shape, so load-paper-parts.ts writes it, with the
same stored-text check and render gate. Exercises are numbered as exams.json
numbers them, because that is how the database rows are keyed: the reading
part is exercise 1; the writing part is exercise 2 where the extractor made
one, and the last part of exercise 1 where it did not.
"""
import argparse
import collections
import json
import logging
import re
import sys
from pathlib import Path

import pdfplumber

logging.getLogger('pdfminer').setLevel(logging.ERROR)
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, str(Path(__file__).parent))

import paper_parts as pp  # noqa: E402

OUT = pp.ROOT / 'corpus' / '.mapping' / 'lang-parts.json'
ARABIC = re.compile(r'[؀-ۿﭐ-﷿ﹰ-﻿]')
PAGE_MARK = re.compile(r'^\s*(?:\d+\s*/\s*\d+|page\s*\d+.*|-\s*\d+\s*-)\s*$', re.I)
# A label at the start of a line: "A.", "B-", "1.", "2-", "3)", "a.", "b-".
# "4 a. Relevez …" (gs/2018 1/fr.pdf) prints its number with no mark when a
# sub-question follows on the same line.
# "2-a. Relevez …" (gs/2013 1/french.pdf) runs the number into its first letter.
LINE_LABEL = re.compile(
    r'^\s*(?:([A-F])|(\d{1,2})|([a-e]))\s*'
    r'(?:[.\-–)]\s+(?=\S)|[.\-–)](?=[A-ZÀ-Ý«])|[.\-–)]?\s*(?=[a-e]\s*[.\-)]\s*[A-ZÀ-Ý«\s]))')
# "5-Relevezles …", "4-a.Relevez …" (gs/2015 1/french.pdf): the text layer
# lost the space after the label; a capital after it still marks one.
QUESTIONS_HEAD = re.compile(
    r'^\s*(?:I\s*[-.–]?\s*Questions\b|Part\s+One\b|PART\s+ONE\b|I\s*[-.–]\s*(?:Compr|Reading)|Questions\s*\(|Questions\s*:?\s*$)', re.I)
WRITING_HEAD = re.compile(
    r'^\s*(?:II\s*[-.–]\s*(?:Production|Writing|Expression)|Part\s+Two\b|PART\s+TWO\b|II\s*[-.–]?\s*Production)', re.I)
ANSWER_HEAD = re.compile(r'^(?:answers?|expected answers?|éléments de réponses?|eléments de réponses?|corrigé|réponses?)', re.I)
MARK_HEAD = re.compile(r'^(?:score|marks?|note|notation|nota-? ?tion|grade|pts?|points?)$', re.I)
CRITERIA_HEAD = re.compile(r'^crit[èe]res?\b', re.I)
HEAD_WORDS = re.compile(
    r"^(?:\s*(?:[ée]l[ée]ments de r[ée]ponses?|crit[èe]res|d['’][ée]valuation|notation|nota|tion|note"
    r"|expected answers?|answers?|score|marks?)\b[\s:\-]*)+", re.I)
LABEL_HEAD = re.compile(r'^(?:q\.?|partie(?: de la q\.?)?|part(?: of the q\.?)?|question)$', re.I)
# A key's label cell: "I-A-1", "I-B-2-a", "I. 3. a.", "II-A", "I.4.b".
KEY_LABEL = re.compile(r'^(?:[IVX]{1,4}\s*[-.]\s*)?(?:[A-F]\s*[-.]?\s*)?(?:\d{1,2}\s*[-.]?\s*)?(?:[a-e]\s*[-.]?)?$')
# The French key's marking-criteria column: "Le candidat choisit la bonne réponse. ½ pt x4".
CRITERION = re.compile(r'^(?:le candidat|la candidate|the candidate)\b', re.I)
# The clean copy of that row drops the "II" (gs/2012 2/fr.pdf).
WRITING_ROW = re.compile(r'^(?:II\s*[-.]?\s*(?:Production|Expression|Writing)|(?:Production|Expression) écrite)', re.I)
MIXED = re.compile(r'(?<=\S)\s+(?:le candidat|la candidate|the candidate)\b', re.I)


def clean_line(line):
    return re.sub(r'\s{2,}', ' ', line).strip()


def paper_lines(pdf, pages, start=0):
    out = []
    for i in range(start, pages):
        for line in (pdf.pages[i].extract_text() or '').split('\n'):
            if not line.strip() or ARABIC.search(line) or PAGE_MARK.match(line):
                continue
            out.append(clean_line(line))
    return out


def paragraphs(lines):
    """Hard-wrapped lines joined into paragraphs; a short line ending a sentence ends one."""
    if not lines:
        return ''
    width = max(len(l) for l in lines)
    out, buf = [], []
    for l in lines:
        buf.append(l)
        if re.search(r'[.!?:»”"]\s*$', l) and len(l) < 0.85 * width:
            out.append(' '.join(buf))
            buf = []
    if buf:
        out.append(' '.join(buf))
    return '\n\n'.join(out)


def read_paper(exam):
    """(passage, [items], writing) read from the paper's own pages."""
    path = pp.ROOT / 'corpus' / 'exams' / exam['path'].replace('\\', '/')
    pages, _ = layout(exam)
    with pdfplumber.open(str(path)) as pdf:
        lines = paper_lines(pdf, pages)
    heads = [i for i, l in enumerate(lines) if QUESTIONS_HEAD.match(l)]
    writing = next((i for i, l in enumerate(lines) if WRITING_HEAD.match(l)), len(lines))
    # The questions start at the last questions heading before the first
    # labelled line that follows the passage (an English paper prints "Part
    # One" over the passage and again over the questions).
    first_label = next((i for i, l in enumerate(lines[:writing]) if LINE_LABEL.match(l)
                        and (LINE_LABEL.match(l).group(1) or LINE_LABEL.match(l).group(2))
                        and any(h < i for h in heads)), None)
    if first_label is not None:
        # The passage's own numbered paragraphs ("1. When Ramon Vasques
        # died …", gs/2004 2/eng.pdf) come before a "Questions" heading that
        # still stands above section A: the questions start after it.
        first_section = next((i for i in range(first_label, writing) if SECTION_ALONE.match(lines[i])
                              or (LINE_LABEL.match(lines[i]) and LINE_LABEL.match(lines[i]).group(1))), None)
        later = [h for h in heads if first_section is not None and first_label < h <= first_section]
        if later:
            first_label = next((i for i in range(later[-1], writing) if LINE_LABEL.match(lines[i])
                                or SECTION_ALONE.match(lines[i])), first_label)
        # The heading printed just above the questions ("I-Questions") is not passage.
        heads = [h for h in heads if h < first_label]
    if first_label is None:
        return None
    # The passage runs from the first heading to the first question; a
    # heading printed again over the questions is not part of it.
    # English prints its heading over the passage, French under it: either
    # way the passage is what stands before the first question.
    passage_lines = [l for l in lines[:first_label] if not QUESTIONS_HEAD.match(l)]
    items = labelled(lines[first_label:writing])
    # A blank box of a diagram to copy ("1. 1.", "2. 2.") is not a question.
    items = [it for it in items if not LABEL_ONLY.match(it['text'])]
    return paragraphs(passage_lines), in_print_order(items), paragraphs(lines[writing:])


def labelled(lines):
    """Lines as items, each under the section, number and letter it prints."""
    items = []
    stack = [None, None, None]  # section letter, number, sub letter
    for line in (seg for l in lines for s in section_then_number(l) for seg in split_columns(s)):
        if SECTION_ALONE.match(line):
            stack = [SECTION_ALONE.match(line).group(1), None, None]
            items.append({'label': f'I.{stack[0]}', 'lines': [line]})
            continue
        m = LINE_LABEL.match(line)
        if m:
            sec, num, sub = m.groups()
            # "2- … A- … B- …" (gs/2017 2/fr.pdf): a capital after a number,
            # in a paper with no sections, is that question's choice.
            if sec and stack[0] is None and stack[1] is not None:
                sec, sub = None, sec.lower()
            if sec:
                stack = [sec, None, None]
            elif num:
                stack = [stack[0], num, None]
            else:
                stack = [stack[0], stack[1], sub]
            label = '.'.join(['I'] + [t.upper() for t in stack if t])
            items.append({'label': label, 'lines': [line]})
        elif items:
            items[-1]['lines'].append(line)
        else:
            items.append({'label': 'I', 'lines': [line]})
    for it in items:
        it['text'] = paragraphs(it.pop('lines'))
    return items


# "A. 1. The objective of …" (gs/2004 2/eng.pdf): a section's letter and its
# first question's number printed on one line.
SECTION_THEN_NUMBER = re.compile(r'^\s*([A-F])\s*[.\-)]\s+(?=\d{1,2}\s*[.\-)]\s)')


def section_then_number(line):
    m = SECTION_THEN_NUMBER.match(line)
    return [line[:m.end()].strip(), line[m.end():]] if m else [line]


# Where the key starts, read from the pages themselves: the recorded page
# count is 0 for keys printed in the same file (gs/2005 1/gs french 1.pdf).
# "barème de notation" is not a marker: the writing grid prints it.
KEY_PAGE = re.compile(r"answer key|marking scheme|expected answers|[ée]l[ée]ments de r[ée]ponses?"
                      r"|r[ée]ponses\s+crit[èe]res|crit[èe]res d['’]\s*[ée]valuation|partie de la q\b|\bcorrig[ée]\b", re.I)
_layouts = {}


def layout(exam):
    """(number of question pages, first key page or None)."""
    path = exam['path'].replace('\\', '/')
    if path not in _layouts:
        first = None
        with pdfplumber.open(str(pp.ROOT / 'corpus' / 'exams' / path)) as pdf:
            for i in range(1, len(pdf.pages)):
                if KEY_PAGE.search(pdf.pages[i].extract_text() or ''):
                    first = i
                    break
        n = exam.get('schemePages') or 0
        if first is None and n:
            first = exam['pages'] - n
        _layouts[path] = (first if first is not None else exam['pages'], first)
    return _layouts[path]


# "B." alone on its line, its questions below it (gs/2013 2/eng.pdf).
SECTION_ALONE = re.compile(r'^\s*([A-F])\s*[.\-)]\s*$')
LABEL_ONLY = re.compile(r'^\s*(?:(?:\d{1,2}|[a-eA-F])\s*[.\-)]\s*)+$')
# A second label further along the line: "1. it (Paragraph 6) 3. s/he (Paragraph 7)"
# is two questions printed in two columns. Only "." and "-" mark one here,
# since "(Paragraph 6) 3." closes a bracket on a number.
INLINE_LABEL = re.compile(r'(?<=\s)(\d{1,2}|[a-e])\s*[.\-]\s+(?=\S)')
NOT_A_LABEL_AFTER = re.compile(
    r'(?:paragraphs?|paragraphes?|lines?|lignes?|§|pages?)\s*$|\d\.?\s*(?:and|et|to|à|,|&)\s*$', re.I)


def split_columns(line):
    """One printed line as the questions on it: "1. yield to 3. an article of
    trade" is questions 1 and 3, each with its own answer in the key. A label
    counts only as the next few of its own kind (a number after a number, a
    letter after a letter), so "Paragraphs 2 and 13." does not split."""
    m = LINE_LABEL.match(line)
    if not m or m.group(1):
        return [line]
    own = m.group(2) or m.group(3)
    cuts = []
    for x in INLINE_LABEL.finditer(line, m.end()):
        tok, prev = x.group(1), line[:x.start()]
        if NOT_A_LABEL_AFTER.search(prev):
            continue
        last = cuts[-1][1] if cuts else own
        if own.isdigit() and tok.isdigit() and 0 < int(tok) - int(last) <= 3 \
                or own.isalpha() and tok.isalpha() and 0 < ord(tok) - ord(last) <= 3:
            cuts.append((x.start(), tok))
    if not cuts:
        return [line]
    edges = [0] + [c for c, _ in cuts] + [len(line)]
    return [line[a:b].strip() for a, b in zip(edges, edges[1:])]


def in_print_order(items):
    """Two columns read across ("1. … 3. …" then "2. … 4. …") put back as 1, 2, 3, 4."""
    def key(it):
        toks = it['label'].split('.')
        last = toks[-1]
        return '.'.join(toks[:-1]), int(last) if last.isdigit() else ord(last)
    out, k = [], 0
    while k < len(items):
        j = k + 1
        while j < len(items) and key(items[j])[0] == key(items[k])[0] and items[j]['label'] != items[k]['label']:
            j += 1
        out.extend(sorted(items[k:j], key=lambda it: key(it)[1]))
        k = j
    return out


def key_rows(exam):
    """The key's rows: {tokens, label, answer, criteria, marks}, read as table cells."""
    _, first = layout(exam)
    if first is None:
        return []
    path = pp.ROOT / 'corpus' / 'exams' / exam['path'].replace('\\', '/')
    # Read row by row, by shape: the columns move between pages (thirteen
    # cells on one page, four on the next) and a French header is split over
    # two rows, the second of which is also question I.1's row.
    rows, started = [], False
    # A heading is a short cell: "Réponse par vrai ou faux et justification …"
    # (gs/2019/fr.pdf) is question I.2's answer, not the column's name.
    header = lambda c: len(c) <= 40 and bool(  # noqa: E731
        ANSWER_HEAD.match(c) or MARK_HEAD.match(c) or CRITERIA_HEAD.match(c) or LABEL_HEAD.match(c))
    with pdfplumber.open(str(path)) as pdf:
        for i in range(first, exam['pages']):
            for table in pdf.pages[i].extract_tables():
                for raw in table:
                    cells = [re.sub(r'\s+', ' ', c or '').strip() for c in raw]
                    filled = [c for c in cells if c]
                    if not filled or any(ARABIC.search(c) for c in filled):
                        continue
                    if any(header(c) for c in filled):
                        started = True
                    # The heading run into a row's cell ("Eléments de réponse
                    # Critères Nota- d'évaluation tion Le mot …", gs/2008 2/fr.pdf)
                    # is the whole row read as one, its columns' lines
                    # alternating: a mixed cell, read only to find its clean twin.
                    glued = [c for c in filled if not header(c) and HEAD_WORDS.match(c)
                             and len(HEAD_WORDS.match(c).group().split()) >= 2]
                    if glued:
                        started = True
                        filled = [HEAD_WORDS.sub('', c) if c in glued else c for c in filled]
                        glued = {HEAD_WORDS.sub('', c) for c in glued}
                        filled = [c for c in filled if c]
                        if not filled:
                            continue
                    if not started:
                        continue
                    # "I.1. -" (gs/2019/fr.pdf): a dash left after the label.
                    head = re.sub(r'[\s\-–]+$', '', filled[0])
                    label = head if KEY_LABEL.match(head) and pp.label_tokens(head) else ''
                    # "II Production écrite - Introduction : 1pt ½ …" (gs/2012 2/fr.pdf)
                    # starts the writing part's rows; it must not join the last question.
                    if not label and WRITING_ROW.match(' '.join(filled[:2])):
                        rows.append({'tokens': ('II',), 'label': 'II', 'answer': '', 'criteria': '', 'marks': None})
                        continue
                    rest = filled[1:] if label else filled
                    mark_cell = rest[-1] if rest and pp.parse_mark(rest[-1]) is not None else ''
                    if mark_cell:
                        rest = rest[:-1]
                    rest = [c for c in rest if not header(c)]
                    criteria = ' '.join(c for c in rest if CRITERION.match(c))
                    # "… Le candidat répond -oui positivement -Michel Fize …"
                    # (gs/2017 1/fr.pdf): the answer and criteria columns read
                    # as one cell, line by line. Only the criteria are kept.
                    is_mixed = lambda c: c in glued or bool(MIXED.search(c))  # noqa: E731
                    answer = ' '.join(c for c in rest if not CRITERION.match(c) and not is_mixed(c))
                    mixed = ' '.join(c for c in rest if not CRITERION.match(c) and is_mixed(c))
                    if label:
                        rows.append({'tokens': pp.label_tokens(label), 'label': label, 'answer': answer,
                                     'criteria': criteria, 'marks': pp.parse_mark(mark_cell),
                                     **({'mixed': word_set(mixed)} if mixed else {})})
                    elif rows and (answer or criteria):
                        r = mixed_twin(rows, answer + ' ' + criteria) or rows[-1]
                        r['answer'] = (r['answer'] + ' ' + answer).strip()
                        if criteria:
                            r['criteria'] = (r['criteria'] + ' ' + criteria).strip()
    for r in rows:
        r.pop('mixed', None)
    # "3 | Critère d'évaluation" (gs/2009 2/fr.pdf): a heading row with a
    # number in its first cell, still empty once its continuations are read.
    rows = [r for r in rows if r['answer'] or r['criteria'] or r['marks'] is not None or r['label'] == 'II']
    return rows or text_key_rows(exam, first)


SCORE = re.compile(r'\(\s*(?:score|note)\s*:?\s*(\d+(?:[.,]\d+)?)?\s*([½¼¾])?\s*(?:pts?)?\s*\)', re.I)
FRACTION = {'½': 0.5, '¼': 0.25, '¾': 0.75}


def text_key_rows(exam, first):
    """A key printed as text, not a table (gs/2004 2/eng.pdf: "A. 1. The
    objective … (Score: 01)"): its lines labelled as the questions are."""
    path = pp.ROOT / 'corpus' / 'exams' / exam['path'].replace('\\', '/')
    with pdfplumber.open(str(path)) as pdf:
        lines = paper_lines(pdf, exam['pages'], first)
    writing = next((i for i, l in enumerate(lines) if WRITING_HEAD.match(l)), len(lines))
    rows = []
    for it in labelled(lines[:writing]):
        if it['label'] == 'I':
            continue  # the key's title and competencies
        text = re.sub(r'^\s*(?:[A-F]|\d{1,2}|[a-e])\s*[.\-)]\s*', '', it['text'])
        marks = [float((a or '0').replace(',', '.')) + FRACTION.get(b, 0) for a, b in SCORE.findall(text)]
        text = SCORE.sub('', text).strip()
        rows.append({'tokens': pp.label_tokens(it['label']), 'label': it['label'], 'answer': text,
                     'criteria': '', 'marks': round(sum(marks), 2) if marks else None})
    return rows

def word_set(text):
    return {w for w in re.findall(r'\w+', text.lower()) if len(w) >= 3}


def mixed_twin(rows, text):
    """The labelled row whose mixed cell this clean, unlabelled row repeats.

    pdfplumber reads some French keys twice (gs/2007 2/fr.pdf): an outer
    table whose labelled cells hold the answer and criteria columns line by
    line, then an inner one with the same cells clean and no labels. A clean
    row belongs to the row whose mixed cell holds its words, not to whichever
    labelled row came last."""
    words = word_set(text)
    if len(words) < 3:
        return None
    best, score = None, 0.8
    for r in rows:
        if 'mixed' in r:
            s = len(words & r['mixed']) / len(words)
            if s > score:
                best, score = r, s
    return best


def bind(items, rows):
    """Rows to items by label; (bound {item index: [rows]}, orphans)."""
    itoks = [pp.label_tokens(it['label']) for it in items]
    bound, orphans = collections.defaultdict(list), []
    last = None
    for r in rows:
        toks = r['tokens'] if r['tokens'][:1] in (('I',), ('II',)) else ('I',) + r['tokens']
        best = None
        for k, t in enumerate(itoks):
            if toks[:len(t)] == t and (best is None or len(t) > len(itoks[best])):
                best = k
        # "D-3" falling back to D after D-2 answered: D-3 is printed on D-2's
        # line ("2. … 3. … 4. …"), so it belongs with the part that holds it.
        if best is not None and last is not None and last > best \
                and itoks[last][:len(itoks[best])] == itoks[best] and len(toks) > len(itoks[best]):
            best = last
        if best is None or best == 0 and itoks[0] == ('I',) and len(toks) > 1:
            orphans.append(r)
        else:
            bound[best].append(r)
            last = best
    return bound, orphans


LETTER_ANSWER = re.compile(r'(?<=\s)([a-h])\s?[-.)]\s')


def letter_lines(text):
    """"… a- Le personnage … b- Sur les lieux …" as one line per letter, when
    the letters run a, b, c in order; any other letter is part of the prose."""
    cuts, want = [], 'a'
    for m in LETTER_ANSWER.finditer(' ' + text):
        if m.group(1) == want:
            cuts.append(m.start() - 1)
            want = chr(ord(want) + 1)
    if len(cuts) < 2:
        return text
    edges = [0] + cuts + [len(text)]
    return '\n\n'.join(p for p in (text[x:y].strip() for x, y in zip(edges, edges[1:])) if p)


def answer_text(item, rs):
    """The rows bound to one item, each under the part of its label beyond the item's."""
    base = len(pp.label_tokens(item['label']))
    chunks = []
    for r in rs:
        toks = r['tokens'] if r['tokens'][:1] in (('I',), ('II',)) else ('I',) + r['tokens']
        sub = '.'.join(toks[base:]).lower()
        body = letter_lines(r['answer'])
        if r['criteria']:
            body += f"\n\n*{r['criteria']}*"
        body = body.strip()
        if not body:
            continue
        chunks.append(f'**{sub})** {body}' if sub else body)
    return '\n\n'.join(chunks)


def written_in(text):
    """'en' or 'fr', by the commonest small words."""
    words = re.findall(r"[a-zà-ÿ]+", text.lower())
    en = sum(w in EN_WORDS for w in words)
    fr = sum(w in FR_WORDS for w in words)
    return 'en' if en > fr else 'fr'


EN_WORDS = {'the', 'and', 'of', 'is', 'to', 'in', 'that', 'are', 'with', 'for'}
FR_WORDS = {'le', 'la', 'les', 'des', 'du', 'est', 'une', 'dans', 'et', 'que'}


def reading_rows(rows):
    """The key's rows for the reading part. The writing part's rows are
    labelled II, or (gs/2017 1/eng.pdf) "I-A, I-B, I-C" again after I-E: a
    section letter going back means the writing grid has begun."""
    out, top = [], ''
    for r in rows:
        toks = r['tokens'][1:] if r['tokens'][:1] == ('I',) else r['tokens']
        if r['tokens'][:1] == ('II',):
            break
        sec = toks[0] if toks and re.fullmatch(r'[A-F]', toks[0]) else ''
        if sec and top and sec < top:
            break
        top = max(top, sec)
        out.append(r)
    return out


def build(exam):
    got = read_paper(exam)
    if not got:
        return {'status': 'questions not found'}
    passage, items, writing = got
    # gs/2006 2/eng.pdf is the French 2006 session-1 paper, byte for byte.
    named = 'en' if re.match(r'(?:gs\s+)?eng', Path(exam['path']).name, re.I) else 'fr'
    if written_in(passage + ' '.join(it['text'] for it in items)) != named:
        return {'status': 'wrong file: not in its language'}
    rows = reading_rows(key_rows(exam))
    rec = {'passage': passage, 'items': items, 'writing': writing, 'rows': len(rows)}
    if not items:
        return {**rec, 'status': 'no questions'}
    # Two parts under one label is a heading the reader missed, and the key
    # cannot be bound by label to either of them.
    repeated = [k for k, n in collections.Counter(it['label'] for it in items).items() if n > 1]
    if repeated:
        return {**rec, 'status': 'repeated labels', 'orphans': repeated[:6]}
    if not rows:
        return {**rec, 'status': 'no key'}
    bound, orphans = bind(items, rows)
    order = [k for r in rows for k, rs in bound.items() if r in rs]
    if any(b < a for a, b in zip(order, order[1:])):
        return {**rec, 'status': 'out of order'}
    if len(orphans) > max(1, len(rows) // 5):
        return {**rec, 'status': 'orphan rows', 'orphans': [r['label'] for r in orphans][:6]}
    for k, rs in bound.items():
        items[k]['answer'] = answer_text(items[k], rs)
        marks = [r['marks'] for r in rs]
        if all(m is not None for m in marks):
            items[k]['marks'] = round(sum(marks), 2)
    return {**rec, 'items': fold_options(items), 'status': 'ok', 'orphans': [r['label'] for r in orphans]}


def fold_options(items):
    """A question's lettered options ("a. Hélie de Saint-Marc est …") join it
    when the key answers the question as a whole, so its answer sits under
    the options it chooses between rather than above them."""
    out = []
    for it in items:
        parent = out[-1] if out else None
        if parent and not it.get('answer') and it['label'].startswith(parent['label'] + '.') \
                and re.fullmatch(r'[A-E]', it['label'].rsplit('.', 1)[-1]) and parent.get('answer'):
            parent['text'] += '\n\n' + it['text']
            continue
        out.append(it)
    return out


def prose(text):
    """Markdown for the page: a dollar here is money, not the start of maths."""
    return text.replace('$', chr(92) + '$')


def to_paper_parts(exam, rec):
    """paper_parts.py's shape, numbered as exams.json numbers the exercises."""
    exercises = []
    reading = exam['exercises'][0] if exam['exercises'] else None
    if not reading or rec.get('status') not in ('ok', 'no key', 'orphan rows', 'out of order'):
        return exercises
    parts = [{'label': it['label'], 'text': prose(it['text']),
              **({'answer': prose(it['answer'])} if it.get('answer') and rec['status'] == 'ok' else {}),
              **({'marks': it['marks']} if it.get('marks') is not None and rec['status'] == 'ok' else {})}
             for it in rec['items']]
    if len(exam['exercises']) == 1 and rec['writing']:
        parts.append({'label': 'II', 'text': prose(rec['writing'])})
    exercises.append({
        'ordinal': 1, 'index': reading['index'], 'marks': reading.get('marks'), 'status': 'split',
        'intro': '', 'passage': prose(rec['passage']), 'parts': parts,
        'answers': {'status': 'ok' if rec['status'] == 'ok' and any(p.get('answer') for p in parts)
                    else rec['status']},
    })
    return exercises


LANG = re.compile(r'^(?:eng|english|en\b|en\.|fr\b|fr\.|french|.*\bfrench\b)', re.I)


def language_papers(track):
    for exam in json.loads(pp.EXAMS.read_text(encoding='utf-8')):
        path = exam['path'].replace('\\', '/')
        name = Path(path).name.lower()
        if not path.startswith(track + '/') or pp.ADAPTED.search(name):
            continue
        if any(s in name for s in ('falsafe', 'chem', 'math', 'phy', 'bio', 'geo', 'tarekh', 'tarbeya', 'arabe')):
            continue
        if not LANG.match(name) or exam['language'] not in ('en', 'fr'):
            continue
        yield exam


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--track', default='gs')
    ap.add_argument('--show')
    args = ap.parse_args()
    if args.show:
        exam = next(e for e in language_papers(args.track) if e['path'].replace('\\', '/') == args.show)
        rec = build(exam)
        print('status', rec['status'], rec.get('orphans'), 'rows', rec.get('rows'))
        print('PASSAGE', re.sub(r'\s+', ' ', rec.get('passage') or '')[:300])
        flat = lambda s: re.sub(r'\s+', ' ', s or '')  # noqa: E731
        for it in rec.get('items') or []:
            print(f"  {it['label']:8} {it.get('marks', '')!s:5} | {flat(it['text'])[:80]}")
            if it.get('answer'):
                print(f"           A: {flat(it['answer'])[:110]}")
        print('WRITING', re.sub(r'\s+', ' ', rec.get('writing') or '')[:200])
        return
    papers, tally = [], collections.Counter()
    for exam in language_papers(args.track):
        rec = build(exam)
        tally[(exam['language'], rec['status'])] += 1
        exercises = to_paper_parts(exam, rec)
        if exercises:
            papers.append({'paper': exam['path'].replace('\\', '/'), 'sha256': exam['sha256'],
                           'subject': 'language', 'language': exam['language'], 'exercises': exercises})
    OUT.write_text(json.dumps(papers, ensure_ascii=False, indent=1), encoding='utf-8')
    for k, v in sorted(tally.items()):
        print(k, v)
    print(f'wrote {OUT}: {len(papers)} papers')


if __name__ == '__main__':
    main()
