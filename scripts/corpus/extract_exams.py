# -*- coding: utf-8 -*-
"""Official past papers -> structured exercises, answers and barème.

    python scripts/corpus/extract_exams.py                 all of corpus/exams
    python scripts/corpus/extract_exams.py --limit 20      a sample, for checking
    python scripts/corpus/extract_exams.py --show gs/2015\\ 1/chem_en.pdf

Writes corpus/exams.json, which scripts/corpus/load-exams.ts reads into the
database.

No model is involved, and no OCR is paid for. Nearly every official paper from
2004 on is born-digital — 1,382 of 1,451 carry a real text layer — so the text
is simply read out of the PDF.

Three facts about these papers make rules workable where they usually are not:

  A paper announces its own structure. "This Exam Includes Three Exercises"
  and "First Exercise (6 points)" are printed on every one of them, so the
  exercise count and its marks are stated rather than inferred.

  The marking scheme is usually inside the same file. gs/2015/chem_en.pdf is
  eight pages: the four-page paper, then its own scheme with a
  Question/Answer/mark table. That is why a naive scan of these files finds
  forty marks in a twenty-mark exam — it is counting the paper and the scheme
  together. Splitting on the point where the page numbering restarts separates
  them.

  Sub-questions are labelled hierarchically (1.1, 1.2, 2.1) in both halves, so
  an answer and its mark can be attached to the exact part they belong to
  without any alignment guesswork.

Where the rules cannot find a structure they say so and the paper is skipped
rather than half-parsed: a question stored without its statement would be
retrieved and answered from, which is worse than not having it.
"""

import argparse
import hashlib
import json
import re
import sys
import unicodedata
from collections import Counter
from pathlib import Path

from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[2]
EXAMS = ROOT / "corpus" / "exams"
OUT = ROOT / "corpus" / "exams.json"

AR_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")

ORD_EN = {"first": 1, "second": 2, "third": 3, "fourth": 4, "fifth": 5, "sixth": 6,
          "1st": 1, "2nd": 2, "3rd": 3, "4th": 4, "5th": 5}
ORD_FR = {"premier": 1, "première": 1, "deuxième": 2, "deuxieme": 2, "troisième": 3,
          "troisieme": 3, "quatrième": 4, "quatrieme": 4, "cinquième": 5, "cinquieme": 5}
ORD_AR = {"الأول": 1, "الاول": 1, "الثاني": 2, "الثالث": 3, "الرابع": 4, "الخامس": 5,
          "الأولى": 1, "الثانية": 2, "الثالثة": 3, "الرابعة": 4}

MARK = r"(\d{1,2}(?:[.,]\d{1,2})?|[٠-٩۰-۹]{1,2})"

# Arabic papers in the humanities write their marks as words, not digits:
# "(أربع علامات)" is four marks and "(علامتان)" is two. Every digit-based pattern
# here read those papers as carrying no marks at all, which is why history,
# civics, sociology and economics extracted nothing — not because they lack
# structure, but because their structure is spelled out rather than numbered.
AR_WORD_MARKS = {
    "ثلاث": 3, "أربع": 4, "اربع": 4, "خمس": 5, "ست": 6, "سبع": 7,
    "ثماني": 8, "ثمان": 8, "تسع": 9, "عشر": 10,
}
# The brackets are not required. RTL extraction reorders them — "(أربع علامات)"
# comes out as "()أربع علامات(" — so anchoring on them loses the note entirely.
# The phrase itself is distinctive enough.
AR_WORD_MARK = re.compile(
    r"(?:(علامتان|علامتين)|("
    + "|".join(AR_WORD_MARKS)
    + r")\s*علامات?)"
)

# "أولاً :" / "ثانياً :" — how these papers label their questions. There is no
# word for exercise; the ordinal alone carries it.
AR_ORDINAL_HEAD = re.compile(
    r"(?:^|\n)[ \t]*(أوّ?لاً|ثانياً|ثالثاً|رابعاً|خامساً|سادساً|سابعاً|ثامناً)\s*[:：]"
)


def word_marks(text: str) -> float:
    """Marks written as Arabic words, summed over one block."""
    total = 0.0
    for dual, count in AR_WORD_MARK.findall(text):
        if dual:
            total += 1 if dual == "علامة" else 2
        else:
            total += AR_WORD_MARKS.get(count.strip(), 0)
    return total

# A numbered Arabic question — "1- بالعودة الى المستند رقم(1) استخرج:" — with
# its marks printed against each lettered sub-part rather than in the header.
AR_NUM_HEAD = re.compile(r"(?:^|\n)[ \t]*(\d{1,2})\s*[-–]\s*(?=\S)")

# "(2/1 نقطة)" is half a point. The fraction is printed right to left, so the
# characters arrive as 2, /, 1 and the value is the second over the first —
# reading it left to right would score it as two.
AR_FRACTION_MARK = re.compile(r"(\d)\s*/\s*(\d)\s*(?:نقطة|نقاط|علامة|علامات)")
AR_DIGIT_MARK = re.compile(r"(\d{1,2}(?:[.,]\d)?)\s*(?:نقطة|نقاط|علامة|علامات)")
AR_BARE_POINT = re.compile(r"[(（]\s*(?:نقطة|علامة)\s*[)）]")


def arabic_marks(text: str) -> float:
    """Every form these papers write a mark in, summed over one block."""
    total = word_marks(text)
    for first, second in AR_FRACTION_MARK.findall(text):
        if int(first):
            total += int(second) / int(first)
    stripped = AR_FRACTION_MARK.sub(" ", text)
    for value in AR_DIGIT_MARK.findall(stripped):
        total += to_number(value)
    total += len(AR_BARE_POINT.findall(stripped))
    return total

# "First Exercise (6 points)" / "Exercise 1 (7 points)" / "Exercice II (5 points)"
EXERCISE = re.compile(
    rf"(?:^|\n)[ \t]*(?:"
    rf"(?P<en_ord>First|Second|Third|Fourth|Fifth|Sixth|1st|2nd|3rd|4th|5th)\s+Exercise|"
    rf"Exercise\s+(?P<en_num>\d{{1,2}}|[IVX]{{1,4}})|"
    rf"(?P<fr_ord>Premier|Première|Deuxi[èe]me|Troisi[èe]me|Quatri[èe]me|Cinqui[èe]me)\s+exercice|"
    rf"Exercice\s+(?P<fr_num>\d{{1,2}}|[IVX]{{1,4}})|"
    rf"التمرين\s+(?P<ar_ord>الأول|الاول|الثاني|الثالث|الرابع|الخامس)|"
    rf"التمرين\s+(?P<ar_num>[\d٠-٩]{{1,2}})"
    rf")\s*[:\-–]?\s*[(（]?\s*{MARK}\s*(?:points?|pts?|علامات?|نقاط?|درجات?)",
    re.I | re.M,
)

# Maths papers never write the word "exercise". They head each one with a bare
# roman numeral and its marks: "I-  ( 2 points)", "II- (4 points)".
# Maths papers never write the word "exercise". They head each one with a bare
# roman numeral and its marks: "I-  ( 2 points)", "II- (4 points)".
#
# The numeral and the marks may have a name between them — the French language
# papers write "I- Questions (13 pts)" and "II- Production écrite (7 pts)".
# Requiring the bracket to follow the dash immediately matched the maths papers
# and missed every French one.
EXERCISE_BARE = re.compile(
    rf"(?:^|\n)[ \t]*(?P<num>[IVX]{{1,4}}|\d{{1,2}})\s*[-–.)]\s*[^\n(（]{{0,40}}?[(（]\s*{MARK}\s*"
    rf"(?:points?|pts?|علامات?|نقاط?|درجات?)",
    re.I,
)

# Philosophy, literature and language papers offer a choice of subjects instead
# of exercises, and print the marks on each part rather than on the header.
SUBJECT_HEAD = re.compile(
    r"(?:^|\n)[ \t]*(?:"
    r"(?P<en>First|Second|Third|Fourth)\s+(?:subject|topic)|"
    r"(?P<fr>Premier|Deuxi[\u00e8e]me|Troisi[\u00e8e]me|Quatri[\u00e8e]me)\s+sujet|"
    # French papers number their subjects rather than spelling them out:
    # "1er sujet", "2ème sujet", "3e sujet". Philosophy is the whole of the
    # French unparsed set and every one of them uses this form.
    r"(?P<fr_num_subject>\d{1,2})\s*(?:er|ere|\u00e8re|eme|\u00e8me|e)\s+sujet|"
    r"الموضوع\s+(?P<ar>الأول|الاول|الثاني|الثالث|الرابع)"
    r")\s*[:：]?",
    re.I,
)

# Language papers split into parts and score them out of twenty:
# "Part One : Reading (Score: 11/20)".
# Language papers split into scored sections. Two shapes, and the second is why
# every French paper failed: the English ones write "Part One : Reading (Score:
# 11/20)", the French ones write "Questions (13 pts)" or "Production écrite
# (7 pts)" — a section named by what it asks for rather than numbered.
PART_SCORE = re.compile(
    rf"(?:^|\n)[ \t]*(?:"
    rf"(?P<num>Part|Partie)\s+(?:One|Two|Three|Four|Une|Deux|Trois|[IVX]{{1,3}}|\d)"
    rf"[^\n]{{0,50}}?|"
    rf"(?P<named>Questions?|Compr[ée]hension|Production|Expression|R[ée]daction|Essai)"
    rf"[^\n]{{0,40}}?"
    rf")[(（]\s*(?:Score|Note|Points?)?\s*[:：]?\s*{MARK}\s*"
    rf"(?:/\s*\d{{1,2}})?\s*(?:pts?|points?)?",
    re.I,
)

# "(9 pts)" printed against a part, which is where these papers put the barème.
INLINE_MARK = re.compile(
    rf"[(（]\s*{MARK}\s*(?:points?|pts?|علامات?|نقاط?|درجات?)\s*[)）]?", re.I)

# "1.1-", "2.3.1)", "1-" at the start of a line: a sub-question label.
#
# The separator must be a dash or a bracket, or a full stop with a space after
# it. Allowing a bare full stop made "1.010-2 mol.L-1" — a concentration wrapped
# onto its own line — read as sub-question 1.
PART = re.compile(r"(?m)^[ \t]*(\d{1,2}(?:\.\d{1,2}){0,2})\s*(?:[-–)：:]|\.(?=\s))\s*(?=\S)")

# A marking-scheme row: label, the answer, then the mark alone at the end.
SCHEME_ROW = re.compile(rf"(?m)^[ \t]*(\d{{1,2}}(?:\.\d{{1,2}}){{0,2}})\s+(.+?)\s+{MARK}\s*$")

# The header of a marking scheme, in any of the three languages.
SCHEME_HEAD = re.compile(
    r"أسس\s*ال?تصحيح|معايير\s*التصحيح|سلّ?م\s*ال?تصحيح|"
    r"ال[أإا]?جابة\s*ال?متوقعة|الجواب\s*ال?متوقع|"
    r"bar[eè]me|corrig[ée]|r[ée]ponses?\s*attendues?|[ée]l[ée]ments?\s*de\s*r[ée]ponse|"
    r"marking\s*scheme|answer\s*key|expected\s*answers?|"
    r"(?:question|part\s+of).{0,30}(?:answer|answers).{0,30}(?:mark|note)",
    re.I | re.S,
)

# "It Is Inscribed on Four Pages" — the paper stating its own length.
WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
         "eight": 8, "nine": 9, "ten": 10}
PAGE_COUNT = re.compile(
    r"inscribed\s+on\s+(\w+)\s+pages|comporte\s+(\w+|\d+)\s+pages?|"
    r"(?:من|في)\s+([\w٠-٩]+)\s+صفحات", re.I)


def to_number(raw: str) -> float:
    try:
        return float(raw.translate(AR_DIGITS).replace(",", "."))
    except (ValueError, AttributeError):
        return 0.0


def exercise_index(m: re.Match) -> int:
    for group, table in (("en_ord", ORD_EN), ("fr_ord", ORD_FR), ("ar_ord", ORD_AR)):
        value = m.group(group)
        if value:
            return table.get(value.lower() if group != "ar_ord" else value, 0)
    for group in ("en_num", "fr_num", "ar_num"):
        value = m.group(group)
        if value:
            roman = {"i": 1, "ii": 2, "iii": 3, "iv": 4, "v": 5}.get(value.lower())
            return roman if roman else int(to_number(value))
    return 0


def split_paper_and_scheme(pages: list) -> tuple:
    """Where the paper stops and its marking scheme begins.

    Most of these files hold both. The scheme announces itself, and it also
    restarts the page numbering, so the first page that either carries a scheme
    header or repeats the opening exercise is the boundary.
    """
    first_exercise = None
    for i, text in enumerate(pages):
        if EXERCISE.search(text):
            first_exercise = i
            break

    for i, text in enumerate(pages):
        if i <= (first_exercise or 0):
            continue
        if SCHEME_HEAD.search(text[:600]):
            return pages[:i], pages[i:]
        # The scheme repeats the first exercise's header, which the paper does
        # only once.
        if first_exercise is not None and i > first_exercise:
            here = EXERCISE.search(text)
            there = EXERCISE.search(pages[first_exercise])
            if here and there and exercise_index(here) == 1 and exercise_index(there) == 1:
                return pages[:i], pages[i:]

    return pages, []


ROMAN = {"i": 1, "ii": 2, "iii": 3, "iv": 4, "v": 5, "vi": 6}


def find_headers(text: str) -> tuple:
    """The exercise headers, whichever of the three forms this paper uses.

    Tried in order of how much they assert. A header naming itself an exercise
    is unambiguous; a bare "II- (4 points)" is only an exercise because of the
    marks beside it; a "First subject" carries no marks at all and its total has
    to be added up from its parts. Taking them in that order stops a maths
    paper's roman numerals being read out of a chemistry paper that has already
    parsed properly.
    """
    found = list(EXERCISE.finditer(text))
    if found:
        return found, "exercise"
    found = list(EXERCISE_BARE.finditer(text))
    if found:
        return found, "bare"
    found = list(PART_SCORE.finditer(text))
    if found:
        return found, "part"
    # Arabic humanities papers: ordinal headings, marks spelled out in words.
    found = list(AR_ORDINAL_HEAD.finditer(text))
    if len(found) >= 2:
        return found, "arabic-ordinal"
    # Document-based papers: numbered questions, marks against the sub-parts.
    if len(AR_DIGIT_MARK.findall(text)) + len(AR_BARE_POINT.findall(text)) >= 2:
        found = list(AR_NUM_HEAD.finditer(text))
        if len(found) >= 2:
            return found, "arabic-numbered"
    return list(SUBJECT_HEAD.finditer(text)), "subject"


def header_index(m: re.Match, kind: str, fallback: int) -> int:
    if kind == "exercise":
        return exercise_index(m) or fallback
    if kind == "arabic-numbered":
        return int(to_number(m.group(1))) or fallback
    if kind == "arabic-ordinal":
        ordinals = ["أول", "ثاني", "ثالث", "رابع", "خامس", "سادس", "سابع", "ثامن"]
        raw = m.group(1)
        for index, word in enumerate(ordinals, start=1):
            if raw.startswith(word):
                return index
        return fallback
    if kind == "part" and not m.group("num"):
        # A section named rather than numbered ("Questions", "Production").
        return fallback
    if kind in ("bare", "part"):
        raw = m.group("num")
        return (ROMAN.get(raw.lower(), 0) or ORD_EN.get(raw.lower(), 0)
                or {"une": 1, "deux": 2, "trois": 3}.get(raw.lower(), 0)
                or int(to_number(raw)) or fallback)
    numbered = m.groupdict().get("fr_num_subject")
    if numbered:
        return int(to_number(numbered)) or fallback
    for group, table in (("en", ORD_EN), ("fr", ORD_FR), ("ar", ORD_AR)):
        value = m.group(group)
        if value:
            return table.get(value if group == "ar" else value.lower(), fallback)
    return fallback


def without_scheme(statement: str) -> str:
    """The statement up to where its marking scheme starts.

    `split_paper_and_scheme` divides the file a page at a time, which is the
    right granularity for the common layout — scheme on its own pages, after the
    paper. Plenty of papers do not do that: the scheme begins partway down the
    last page of the exercise, and the whole of it then ends up inside the
    statement.

    That is worse than losing the question. A statement carrying "Réponse
    attendue — Note 1. C'est une réaction de fusion nucléaire car..." is shown
    to the student as the thing they are being asked, with the answer already in
    it. 93 questions were stored that way.

    Only cut where something is left to keep. A statement that is scheme from
    its first line is not an exercise at all, and is better handed back whole so
    the length check downstream discards it, than truncated to nothing here.
    """
    hit = SCHEME_HEAD.search(statement)
    if not hit or hit.start() < 40:
        return statement
    return statement[: hit.start()].rstrip()


def parse_exercises(text: str) -> list:
    """Each exercise's number, marks, title and statement, in order."""
    found, kind = find_headers(text)
    out = []
    for n, m in enumerate(found):
        body = text[m.end():found[n + 1].start() if n + 1 < len(found) else len(text)]
        # The title sits on the rest of the header line.
        rest = body.split("\n", 1)
        title = re.sub(r"\s+", " ", rest[0]).strip(" :-–)")
        statement = without_scheme((rest[1] if len(rest) > 1 else "").strip())
        index = header_index(m, kind, n + 1)
        parts = [{"label": p.group(1), "at": p.start()} for p in PART.finditer(statement)]
        for i, part in enumerate(parts):
            end = parts[i + 1]["at"] if i + 1 < len(parts) else len(statement)
            part["text"] = re.sub(r"\s+", " ", statement[part["at"]:end]).strip()
            del part["at"]
            # Papers that print the marks against the part rather than in the
            # header — the barème is there, just in a different place.
            inline = INLINE_MARK.search(part["text"])
            if inline:
                part["marks"] = to_number(inline.group(1))

        parts = [p for p in parts if len(p["text"]) > 8]

        if kind in ("arabic-ordinal", "arabic-numbered"):
            # The marks are inside the block, beside each part, in any of the
            # several forms these papers use.
            marks = arabic_marks(statement)
        elif kind == "subject":
            # No marks in the header; the paper's total is its parts added up.
            marks = sum(p.get("marks", 0) for p in parts)
        else:
            marks = to_number(m.group(m.lastindex))

        out.append({
            "index": index,
            "marks": marks,
            "title": title[:200],
            "statement": re.sub(r"[ \t]+", " ", statement).strip(),
            "parts": parts,
        })
    return out


def parse_scheme(text: str) -> dict:
    """{exercise number: {label: {answer, marks}}} from the marking scheme.

    Scoped per exercise rather than flat. Sub-question labels restart at 1.1 in
    every exercise, so a single map hands exercise 2's answers to exercise 1 —
    which is not a wrong answer, it is a confidently wrong one attached to the
    wrong question.
    """
    headers = list(EXERCISE.finditer(text))
    if not headers:
        blocks = [(0, text)]
    else:
        blocks = []
        for n, m in enumerate(headers):
            end = headers[n + 1].start() if n + 1 < len(headers) else len(text)
            blocks.append((exercise_index(m) or (n + 1), text[m.end():end]))

    scheme = {}
    for index, block in blocks:
        answers = scheme.setdefault(index, {})
        for m in SCHEME_ROW.finditer(block):
            label = m.group(1)
            answer = re.sub(r"\s+", " ", m.group(2)).strip()
            if len(answer) < 3:
                continue
            if label in answers:                  # a row wrapped over two lines
                answers[label]["answer"] += " " + answer
            else:
                answers[label] = {"answer": answer, "marks": to_number(m.group(3))}
    return scheme


# Words that only appear in one of the three languages a paper can be set in.
# Short function words rather than subject vocabulary, so this works on a maths
# paper that is mostly notation as well as on a prose one.
FRENCH_WORDS = re.compile(
    r"\b(?:les|des|dans|pour|avec|est|sont|une|cette|calculer|montrer|d[ée]duire|soit|on donne|justifier)\b", re.I)
ENGLISH_WORDS = re.compile(
    r"\b(?:the|and|with|for|are|this|each|show that|calculate|deduce|given|determine|answer)\b", re.I)


def language_of(text: str) -> str:
    """Which language a paper is set in, read from the paper itself.

    The filename is the usual source and it is often silent — "phy_dr.pdf"
    says nothing, and roughly eighty papers carry no language marker at all.
    The paper does know, so it is asked.

    Arabic is decided by script. French and English share an alphabet, so they
    are separated on function words, which appear in any paper long enough to
    matter and do not depend on the subject.
    """
    sample = text[:20000]
    arabic = len(re.findall(r"[؀-ۿ]", sample))
    if arabic > len(re.sub(r"\s", "", sample)) * 0.25:
        return "ar"
    french = len(FRENCH_WORDS.findall(sample))
    english = len(ENGLISH_WORDS.findall(sample))
    if french == 0 and english == 0:
        return ""
    return "fr" if french > english else "en"


def stated_page_count(text: str) -> int | None:
    m = PAGE_COUNT.search(text)
    if not m:
        return None
    raw = next((g for g in m.groups() if g), "")
    return WORDS.get(raw.lower()) or int(to_number(raw)) or None


def read(pdf: Path) -> dict | None:
    try:
        reader = PdfReader(pdf)
        pages = [(p.extract_text() or "") for p in reader.pages]
    except Exception as exc:
        return {"path": str(pdf.relative_to(EXAMS)), "error": type(exc).__name__}

    # Normalised before anything is matched against it.
    #
    # A PDF written with an Arabic-shaping font emits presentation forms —
    # U+FB50 to U+FEFF, the ligature glyphs — rather than the letters a
    # keyboard produces. They look identical on screen and share no code
    # point, so every Arabic pattern in this file was being compared against
    # characters it could never match. That, not a lack of structure, is why
    # the history, civics, sociology and economics papers extracted nothing:
    # "أولاً" in the file was not the "أولاً" in the regex.
    #
    # NFKC maps them back to ordinary letters. It also normalises the Arabic
    # digits and compatibility forms, which the mark patterns need anyway.
    # Some of these fonts also emit Persian letter forms in Arabic text: yeh as
    # U+06CC and kaf as U+06A9. Visually identical, different code points, so
    # "ثانياً" written with a Persian yeh matches nothing.
    PERSIAN = str.maketrans({"ی": "ي", "ک": "ك", "ۀ": "ه", "ﻻ": "لا"})
    pages = [unicodedata.normalize("NFKC", page).translate(PERSIAN) for page in pages]
    joined = "".join(pages)
    if len(joined.strip()) < 300:
        return {"path": str(pdf.relative_to(EXAMS)), "error": "no text layer"}

    paper_pages, scheme_pages = split_paper_and_scheme(pages)
    paper, scheme_text = "\n".join(paper_pages), "\n".join(scheme_pages)

    exercises = parse_exercises(paper)
    if not exercises:
        return {"path": str(pdf.relative_to(EXAMS)), "error": "no exercise headers"}

    # A Lebanese paper is marked out of twenty. One offering a choice prints more
    # — three subjects worth twenty each — but nothing prints a hundred, and no
    # paper sets sixteen exercises. A total that far out means the headers matched
    # prose rather than questions, and the parse is wrong in a way that reading
    # the output would not reveal.
    #
    # Reported, not stored: a question saved without its real marks would be used
    # to score a student.
    total_marks = sum(e["marks"] for e in exercises)
    if len(exercises) > 10 or total_marks > 70:
        return {
            "path": str(pdf.relative_to(EXAMS)).replace(chr(92), "/"),
            "error": f"implausible parse ({len(exercises)} exercises, {total_marks:g} marks)",
        }

    scheme = parse_scheme(scheme_text) if scheme_text else {}
    for ex in exercises:
        answers = scheme.get(ex["index"], {})
        for part in ex["parts"]:
            found = answers.get(part["label"])
            if found:
                part["answer"] = found["answer"]
                part["marks"] = found["marks"]

    rel = pdf.relative_to(EXAMS)
    total = sum(e["marks"] for e in exercises)
    return {
        "path": str(rel).replace("\\", "/"),
        "sha256": hashlib.sha256(pdf.read_bytes()).hexdigest(),
        "track": rel.parts[0].upper(),
        "session": rel.parent.name,
        "file": pdf.stem,
        "pages": len(pages),
        "paperPages": len(paper_pages),
        "schemePages": len(scheme_pages),
        "statedPages": stated_page_count(paper[:1200]),
        "language": language_of(paper),
        "totalMarks": total,
        "answersFound": sum(1 for e in exercises for p in e["parts"] if "answer" in p),
        "exercises": exercises,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--show", default=None)
    args = ap.parse_args()

    if args.show:
        result = read(EXAMS / args.show)
        print(json.dumps(result, ensure_ascii=False, indent=1)[:4000])
        return

    seen, results = set(), []
    files = sorted(EXAMS.rglob("*.pdf"))
    if args.limit:
        files = files[:args.limit]

    for pdf in files:
        digest = hashlib.sha256(pdf.read_bytes()).hexdigest()
        if digest in seen:
            continue
        seen.add(digest)
        row = read(pdf)
        if row:
            results.append(row)

    good = [r for r in results if "error" not in r]
    OUT.write_text(json.dumps(good, ensure_ascii=False), encoding="utf-8")

    errors = Counter(r["error"] for r in results if "error" in r)
    marks = [r["totalMarks"] for r in good]
    plausible = sum(1 for m in marks if 18 <= m <= 22)
    with_answers = sum(1 for r in good if r["answersFound"])

    print(f"{len(results)} unique papers")
    print(f"  parsed into exercises        {len(good)}")
    for reason, count in errors.most_common():
        print(f"  skipped, {reason:<22} {count}")
    print()
    print(f"  exercises found              {sum(len(r['exercises']) for r in good)}")
    print(f"  sub-questions                {sum(len(e['parts']) for r in good for e in r['exercises'])}")
    print(f"  papers whose marks total 18-22 {plausible} of {len(good)}")
    print(f"  papers with a marking scheme   {with_answers}")
    print(f"  answers attached to a part     {sum(r['answersFound'] for r in good)}")
    print()
    print(f"-> {OUT}")


if __name__ == "__main__":
    sys.exit(main())
