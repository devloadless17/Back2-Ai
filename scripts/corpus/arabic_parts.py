# -*- coding: utf-8 -*-
"""
GS papers taught in Arabic — Arabic, civics, geography — as their printed
parts, each with the key's answer, in paper_parts.py's shape.

    python scripts/corpus/arabic_parts.py                 # writes corpus/.mapping/arabic-parts.json
    python scripts/corpus/arabic_parts.py --show "gs/2005 2/tarbeya.pdf"

The OCR extraction (exams-arabic.json, 2026-09-24) already split each
exercise into its numbered questions and attached the key's answer to each by
its number. The page showed none of that: one block of question text, one
block of solution. Here the same parts go out with their answers under them.

Left out on purpose: philosophy (the user: no answers added, and its
exercises are single essay questions anyway), history (no per-part key in
the extraction), the French/English editions, and the adapted papers.

An exercise's title is kept above the parts: the extractor filed some first
questions there (gs/2005 2/tarbeya.pdf: question 1, whose answer the key
never had), and dropping it would drop a question. The reading passage is
not repeated: the database stores it on the row and the page shows it.
"""
import argparse
import json
import re
import sys
import unicodedata
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, str(Path(__file__).parent))

import paper_parts as pp  # noqa: E402

ROOT = pp.ROOT
SOURCE = ROOT / 'corpus' / 'exams-arabic.json'
OUT = ROOT / 'corpus' / '.mapping' / 'arabic-parts.json'
SUBJECTS = [(re.compile(r'(?i)tarbeya|tarbia'), 'civics'), (re.compile(r'(?i)geo'), 'geography'),
            (re.compile(r'(?i)arab|/ar\.pdf$'), 'arabic')]
NOT_ARABIC = re.compile(r'(?i)_(?:fr|en)\b|_(?:fr|en)\.pdf$|falsafe|philo|tarekh|histo')


def subject(path):
    if NOT_ARABIC.search(path) or pp.ADAPTED.search(path.rsplit('/', 1)[-1]):
        return None
    return next((name for rx, name in SUBJECTS if rx.search(path)), None)


def squash(text):
    return re.sub(r'\s+', ' ', text or '').strip()


def tidy(text):
    """The OCR's table furniture out of a text: "<br>" inside a cell
    (gs/2018 1/tarbeya.pdf) is a line break, and a line holding only the
    table's "|" borders showed on the page as stray bars."""
    text = re.sub(r'\s*<br\s*/?>\s*', '\n', text or '', flags=re.I)
    text = re.sub(r'(?m)^[ \t|]*\|[ \t|]*$\n?', '', text)
    # The key's marks column, one figure per line ("١" — which reads as a bar
    # on the page, gs/2005 2/tarbeya.pdf): a marking note, not the answer.
    text = re.sub(r'(?m)^[ \t]*[0-9٠-٩][0-9٠-٩.,/½¼¾ ]{0,4}[ \t]*$\n?', '', text)
    return re.sub(r'\n{3,}', '\n\n', text).strip()


def intro_of(exercise):
    """The title, and whatever the statement prints before its first part."""
    statement = exercise.get('statement') or ''
    parts = exercise.get('parts') or []
    head = ''
    if parts and parts[0].get('text'):
        probe = squash(parts[0]['text'])[:30]
        flat = squash(statement)
        at = flat.find(probe) if probe else -1
        head = flat[:at].strip() if at > 0 else ''
    title = (exercise.get('title') or '').strip()
    if title and squash(title) in squash(head):
        title = ''
    return '\n\n'.join(t for t in (title, head) if t)


ARABIC_DIGITS = str.maketrans('٠١٢٣٤٥٦٧٨٩', '0123456789')
WORD = re.compile(r'[ء-ي]{3,}')
# Words every question and answer of these subjects shares; they say nothing
# about which question an answer is for.
COMMON = set('''الذي التي الذين هذا هذه ذلك تلك كان كانت يكون على إلى عن من في مع بين حول خلال كل كلّ
لكل بعض غير أكثر أقل علامة علامتان علامات العلامة نصف ثلاث ثلاثة أربع أربعة اثنتين اثنين فكرتين
النص النصّ الفقرة المستند المستندين المستندات رقم حدد حدّد أذكر اذكر استخرج استنتج أوضح وضح وضّح بين
علّل علل أجب إجابتك مستعينا مستعيناً بالاستناد الشواهد الكاتب الأولى الثانية الثالثة الرابعة الخامسة
لبنان اللبنانية اللبناني الدولة'''.split())


def words(text):
    return {w for w in WORD.findall(re.sub('[ً-ْـ]', '', text or '')) if w not in COMMON}


def in_passage(text, passage):
    """A paragraph of the reading passage taken for a question (gs/2006 2/arabe.pdf
    numbers its paragraphs ٢ … ٨, and the extractor read them as questions)."""
    probe = squash(re.sub('[ً-ْـ]', '', re.sub(r'^\s*[\d٠-٩]+\s*[-–.)]\s*', '', text)))[:60]
    flat = squash(re.sub('[ً-ْـ]', '', passage or ''))
    return len(probe) >= 30 and probe in flat


ITEM = re.compile(r'(?:^|[\s|(])([0-9٠-٩]{1,2})\s?[-–.)]')


def block_answer(parts):
    """One answer listing every item ("1- تشيلي 2- الولايات المتحدة 3- نستله …",
    gs/2018 2/geo.pdf): the key answers the section as a whole, so it is
    shown once for the exercise rather than under one of its items."""
    labels = {p['label'].translate(ARABIC_DIGITS) for p in parts if p['label']}
    for p in parts:
        listed = {m.translate(ARABIC_DIGITS) for m in ITEM.findall(p.get('answer') or '')}
        if len(labels) >= 3 and len(listed & labels) >= 3:
            return True
    # Or the same block copied under several items (gs/2021 2/SVSG_Geo_2021_2.pdf III).
    texts = [squash(p['answer']) for p in parts if p.get('answer')]
    if len(texts) >= 2 and len(set(texts)) < len(texts):
        return True
    # Or listed by letter, the only answer among three items or more
    # ("أ- باكستان. ب- أستراليا والسويد. ج- …", gs/2021 2/SVSG_Geo_2021_2.pdf).
    answered = [p for p in parts if p.get('answer')]
    if len(parts) >= 3 and len(answered) == 1:
        letters = set(LETTER_ITEM.findall(answered[0]['answer']))
        return len(letters) >= 3 or len(ITEM.findall(answered[0]['answer'])) >= 3
    return False


LETTER_ITEM = re.compile(r'(?:^|[\s|(])(أ|ب|ج|د|هـ)\s?[-–.)]')


# The key's presentation of documents: "النوع: نص - المصدر: … - المسألة: …".
PRESENTS_DOCUMENTS = re.compile(r'النوع\s*:.*?المصدر', re.S)
ASKS_PRESENTATION = re.compile(r'نوعه|مصدره')


def misplaced(parts, intro):
    """An answer presenting the documents (type, source, issue) under a part
    that does not ask for it: gs/2006 2/tarbeya.pdf part 3 showed question
    1's answer, the key's rows having slid. A general test by shared words
    refused 17 right answers of 26 (the questions of one exercise share their
    vocabulary: "the documents", "the text"), so only this sign is read."""
    # NFKC: some papers' text is in Arabic presentation forms ("ﻧﻮﻋﻪ" for "نوعه").
    plain = lambda t: unicodedata.normalize('NFKC', t or '')  # noqa: E731
    for p in parts:
        if PRESENTS_DOCUMENTS.search(plain(p.get('answer'))) and not ASKS_PRESENTATION.search(plain(p['text'])):
            return f"{p['label']}: shows the documents' type and source, which it does not ask"
    return None


# What a question of these papers opens with; a passage paragraph opens with none.
# Verbs open a word (with و or ف before them at most): "تقدّم" holds "قدّم".
ASKING = re.compile(r'(?:^|(?<=[\s(\-–.،:]))[وف]?(?:حدّ?د|اذكر|أذكر|لخّ?ص|بيّ?ن|وضّ?ح|اضبط|عيّ?ن|عرّ?ف|استخرج|'
                    r'استخلص|استنتج|أوضح|اشرح|علّ?ل|قدّ?م|اختر|أكمل|أشطب|اشطب|ارصد|أشر|سمّ|صنّ?ف|قارن|ناقش|أبد)|'
                    r'\b(?:هل|ما|ماذا|كيف|لماذا|أين|متى)\b|'
                    r'من خلال|بالاعتماد|استناد|ورد في|يشير|في الفقرة|في النص|تتقاطع|يتضمّ?ن')
MARKS = re.compile(r'علام|\(\s*[0-9٠-٩]')


def passage_paragraph(text, passage):
    """A paragraph of the reading passage taken for a question: found in the
    passage, or prose that carries no marks and asks nothing (gs/2012 2/arabe.pdf
    "2- انظرْ إلى العالم من داخل تكنْ فناناً …", worded unlike the stored passage)."""
    if in_passage(text, passage):
        return True
    body = re.sub(r'^\s*[\d٠-٩]+\s*[-–.)]\s*', '', text or '')
    return len(body) > 120 and not MARKS.search(body) and not ASKING.search(body[:200]) and '؟' not in body


def build(exam):
    exercises = []
    passage = exam.get('passage') or ''
    # Only an Arabic paper has a reading passage whose paragraphs could pass
    # for questions; a geography item carries no marks and may open with a
    # country's name ("1- دولة من عالم الشمال …"), so there only an exact
    # match with the passage counts.
    reading = subject(exam['path'].replace('\\', '/')) == 'arabic'
    paragraph = passage_paragraph if reading else in_passage
    for order, e in enumerate(exam['exercises'], 1):
        parts = [p for p in e.get('parts') or [] if (p.get('text') or '').strip()]
        dropped = [p for p in parts if paragraph(p['text'], passage)]
        if reading:
            # The numbering starting again at ١ is where the questions begin
            # (gs/2006 2/arabe.pdf: paragraphs ٢ … ٨, then questions ١ … ٦):
            # what stands before it, carrying no marks, is the passage.
            # Starting again at 2 counts too: gs/2012 2/arabe.pdf filed question 1
            # above its parts. Brackets with a year are not marks; marks say علامة.
            nums = [int(n) if n.isdigit() else None
                    for n in ((p.get('label') or '').translate(ARABIC_DIGITS) for p in parts)]
            restart = next((k for k in range(1, len(nums)) if nums[k] is not None
                            and any(n is not None and n > nums[k] for n in nums[:k])), None)
            if restart and not any('علام' in p['text'] for p in parts[:restart]):
                dropped += [p for p in parts[:restart] if p not in dropped]
        parts = [p for p in parts if p not in dropped]
        if not parts:
            continue
        intro = intro_of({**e, 'parts': parts})
        if in_passage(intro, passage):
            intro = (e.get('title') or '').strip() if not in_passage(e.get('title') or '', passage) else ''
        rec = {
            'ordinal': order, 'index': e['index'], 'marks': e.get('marks'), 'status': 'split',
            'intro': tidy(intro),
            'parts': [{'label': p.get('label') or '', 'text': tidy(p['text']),
                       **({'marks': p['marks']} if isinstance(p.get('marks'), (int, float)) else {}),
                       **({'answer': tidy(p['answer'])} if tidy(p.get('answer')) else {})}
                      for p in parts],
            **({'passageParagraphsDropped': len(dropped)} if dropped else {}),
        }
        answered = any(p.get('answer') for p in rec['parts'])
        why = misplaced(rec['parts'], intro) if answered else None
        if reading and not why:
            # Still stepping back after the passage is taken out: paragraphs
            # and questions stay mixed (gs/2012 2/arabe.pdf, whose question 2
            # also showed question 1's answer). Left as it was.
            nums = [int(n) if n.isdigit() else None
                    for n in ((p['label'] or '').translate(ARABIC_DIGITS) for p in rec['parts'])]
            seen = [n for n in nums if n is not None]
            if any(b <= a for a, b in zip(seen, seen[1:])):
                why = 'its numbering still steps back: passage and questions mixed'
        # An Arabic answer lists its points "1- … 2- … 3-": only geography and
        # civics answer a set of short items in one block.
        if answered and not reading and block_answer(rec['parts']):
            seen, block = set(), []
            for p in rec['parts']:
                a = p.pop('answer', None)
                if a and a not in seen:
                    seen.add(a)
                    block.append(a)
            rec['wholeKey'] = '\n\n'.join(block)
            rec['answers'] = {'status': 'answered as a whole'}
        elif why:
            # Left as it was: one block of question text, one of solution.
            rec.update(status='refused', reason=why)
        else:
            rec['answers'] = {'status': 'ok' if answered else 'no key'}
        exercises.append(rec)
    return exercises


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--show')
    args = ap.parse_args()
    papers = []
    for exam in json.loads(SOURCE.read_text(encoding='utf-8')):
        path = exam['path'].replace('\\', '/')
        if not path.startswith('gs/') or not subject(path):
            continue
        if args.show and path != args.show:
            continue
        # gs/2004 1/2004 gs arabe 1.pdf holds a French paper: a file filed
        # under these subjects must be written in Arabic.
        text = ' '.join(p.get('text') or '' for e in exam['exercises'] for p in e.get('parts') or [])
        arabic = len(re.findall(r'[ء-ي]', text))
        latin = len(re.findall(r'[A-Za-zÀ-ÿ]', text))
        if latin > arabic:
            print(f'wrong file, not in Arabic: {path}')
            continue
        exercises = build(exam)
        if args.show:
            for e in exercises:
                print(f"== exercise {e['ordinal']} (index {e['index']}) intro: {squash(e['intro'])[:120]}")
                for p in e['parts']:
                    print(f"   {p['label']:4} {p.get('marks', '')!s:5} Q: {squash(p['text'])[:110]}")
                    print(f"        A: {squash(p.get('answer'))[:150]}")
            return
        papers.append({'paper': path, 'sha256': exam['sha256'], 'exercises': exercises})
    OUT.write_text(json.dumps(papers, ensure_ascii=False, indent=1), encoding='utf-8')
    n = sum(len(p['exercises']) for p in papers)
    print(f'wrote {OUT}: {len(papers)} papers, {n} exercises')


if __name__ == '__main__':
    main()
