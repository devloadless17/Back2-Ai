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

# Vulgar fractions, in both forms these PDFs emit them: the single character
# (½) and the digit-fraction-slash-digit sequence (1⁄2) that some fonts
# shed instead. A Lebanese paper writes half a mark either way.
FRACTION_VALUE = {
    "½": 0.5, "¼": 0.25, "¾": 0.75,
    "⅓": 1 / 3, "⅔": 2 / 3, "⅛": 0.125,
}
FRACTION = r"(?:[½¼¾⅓⅔⅛]|\d\s*[⁄/]\s*\d)"

# Ordered widest-first: "6 1⁄2" must match as six-and-a-half rather than as a
# bare 6 with the fraction left behind, which would silently halve the mark
# instead of failing loudly.
MARK = (
    r"(\d{1,2}\s*" + FRACTION + r"|" + FRACTION + r"|"
    r"\d{1,2}(?:[.,]\d{1,2})?|[٠-٩۰-۹]{1,2})"
)

# Arabic papers in the humanities write their marks as words, not digits:
# "(أربع علامات)" is four marks and "(علامتان)" is two. Every digit-based pattern
# here read those papers as carrying no marks at all, which is why history,
# civics, sociology and economics extracted nothing — not because they lack
# structure, but because their structure is spelled out rather than numbered.
AR_WORD_MARKS = {
    "ثلاث": 3, "أربع": 4, "اربع": 4, "خمس": 5, "ست": 6, "سبع": 7,
    "ثماني": 8, "ثمان": 8, "تسع": 9, "عشر": 10,
}
# And the fractions, which are how a literature paper splits a mark between the
# parts of one answer: "نصف علامة لتحديد المحور، ربع علامة لكلّ دليل" — half a
# mark for naming the theme, a quarter for each piece of evidence. The integers
# above cover an exercise header; these cover the criteria beneath it, and a
# paper that uses only fractions read as carrying no marks at all.
AR_FRACTION_MARKS = {
    "نصف": 0.5, "نصفا": 0.5, "ربع": 0.25, "ربعا": 0.25,
    "ثلث": 1 / 3, "ثلثا": 2 / 3, "ثلثي": 2 / 3, "واحدة": 1.0,
}
# The brackets are not required. RTL extraction reorders them — "(أربع علامات)"
# comes out as "()أربع علامات(" — so anchoring on them loses the note entirely.
# The phrase itself is distinctive enough.
AR_WORD_MARK = re.compile(
    r"(?:(علامتان|علامتين)|("
    + "|".join(AR_WORD_MARKS)
    + r")\s*علامات?|("
    + "|".join(AR_FRACTION_MARKS)
    + r")\s*(?:ال)?علامة)"
)

# "أولاً :" / "ثانياً :" — how these papers label their questions. There is no
# word for exercise; the ordinal alone carries it.
AR_ORDINAL_HEAD = re.compile(
    r"(?:^|\n)[ \t]*(أوّ?لاً|ثانياً|ثالثاً|رابعاً|خامساً|سادساً|سابعاً|ثامناً)\s*[:：]"
)


def word_marks(text: str) -> float:
    """Marks written as Arabic words, summed over one block."""
    total = 0.0
    for dual, count, fraction in AR_WORD_MARK.findall(text):
        if dual:
            total += 1 if dual == "علامة" else 2
        elif count:
            total += AR_WORD_MARKS.get(count.strip(), 0)
        else:
            total += AR_FRACTION_MARKS.get(fraction.strip(), 0)
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
    # `\s*`, not `\s+`. Arabic PDFs in this corpus routinely emit the heading
    # with the space between the noun and its ordinal missing —
    # "التمرينالثاني" rather than "التمرين الثاني" — because the shaping font
    # joins them and extraction never puts the space back. Requiring a space
    # meant those headings were not headings, and on gs/2016 1/phy_ar.pdf that
    # recovered two exercises of four. The ordinals are specific enough words
    # that allowing zero spaces cannot match anything else.
    rf"التمرين\s*(?P<ar_ord>الأول|الاول|الثاني|الثالث|الرابع|الخامس)|"
    rf"التمرين\s*(?P<ar_num>[\d٠-٩]{{1,2}})"
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

# "Choose one of the following subjects" — a paper saying outright that its
# subjects are alternatives rather than sections. This is what separates a
# choice paper from a document-based one that happens to use the word "subject",
# and nothing is split on subject headings without it.
CHOICE_NOTICE = re.compile(
    r"choose\s+one|choisir\s+un|traitez?\s+un\s+seul|un\s+seul\s+sujet|"
    r"اختر\s+موضوع|أجب\s+عن\s+أحد|اختر\s+أحد",
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
# --- Per-subject extraction profiles -----------------------------------------
#
# One set of splitting rules for fifteen subjects does not work, and the corpus
# says so plainly: of the papers on disk, physics loses none and chemistry loses
# one, while English loses 76 of 112 and Arabic literature 83 of 186. The rules
# were built around the papers that dominate the corpus — maths, physics,
# chemistry, French — which all print "Exercise I (5 points)". The subjects that
# print something else are the subjects that fail.
#
# A profile only chooses which header rules are tried and in what order. A paper
# whose subject is not listed gets `None`, which is the cascade every paper got
# before profiles existed — so a subject that already works cannot be changed by
# adding a profile for one that does not.
SUBJECT_PROFILE = [
    # Matched against the filename only, and the ORDER is the whole of what makes
    # it correct: every subject examined IN a language must be claimed by its own
    # entry before the language patterns are reached. "chem_eng.pdf" is
    # chemistry, "ektesad_fr.pdf" is economics; both end in a language and
    # neither is a language paper. Leaving economics out of this list sent one
    # economics paper down the language profile, which is how this comment came
    # to be written.
    ("maths", re.compile(r"(?:^|[\s_-])(?:math|riyad)", re.I)),
    ("physics", re.compile(r"(?:^|[\s_-])(?:phys?|fizi)", re.I)),
    ("chemistry", re.compile(r"(?:^|[\s_-])(?:chem|chim|kimi)", re.I)),
    ("biology", re.compile(r"(?:^|[\s_-])(?:bio|svt|ahya)", re.I)),
    ("philosophy", re.compile(r"(?:^|[\s_-])(?:falsafe?|philo)", re.I)),
    ("civics", re.compile(r"(?:^|[\s_-])(?:tarbeya|tarbia)", re.I)),
    ("history", re.compile(r"(?:^|[\s_-])(?:tarekh|terekh|tarikh|history)", re.I)),
    ("geography", re.compile(r"(?:^|[\s_-])(?:geo|greo)", re.I)),
    ("economics", re.compile(r"(?:^|[\s_-])(?:ektesad|eqtesad|eco(?:no)?)", re.I)),
    ("sociology", re.compile(r"(?:^|[\s_-])(?:ejteme|ejtema|socio)", re.I)),
    ("arabic", re.compile(r"(?:^|[\s_-])(?:arabe|arabic|arabeye|ar)(?:[\s_.-]|$)", re.I)),
    ("language", re.compile(r"(?:^|[\s_-])(?:eng|english|emg|fr|french|francais)(?:[\s_.-]|$)", re.I)),
]


def profile_for(path: str) -> str | None:
    """Which extraction profile a paper's filename asks for, or None."""
    name = path.replace("\\", "/").split("/")[-1]
    for label, pattern in SUBJECT_PROFILE:
        if pattern.search(name):
            return label
    return None


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

# The same header, for a paper that pads its label out to the right margin.
#
# gs/2007 2/english.pdf prints "Part One: Reading" and then 143 characters of
# spaces before "(Score: 11/20)". PART_SCORE allows fifty, so it missed, the
# cascade fell through every other rule, and an ordinary paper was dropped as
# having no exercise headers. The padding is typography and varies by paper, so
# any fixed budget is arbitrary; this one is wide enough for the widest in the
# corpus and still cannot cross a line break.
#
# Derived from PART_SCORE's own pattern rather than retyped, so the two cannot
# drift apart. Only the language profile reaches it, and only once PART_SCORE
# itself has failed, so no paper that parses today can be re-read by it.
PART_SCORE_PADDED = re.compile(PART_SCORE.pattern.replace('{0,50}', '{0,200}')
                               .replace('{0,40}', '{0,200}'), re.I)

# "(9 pts)" printed against a part, which is where these papers put the barème.
INLINE_MARK = re.compile(
    rf"[(（]\s*{MARK}\s*(?:points?|pts?|علامات?|نقاط?|درجات?)\s*[)）]?", re.I)

# The hierarchy inside a sub-question label: "1.1", "2.3.1", and — because
# Lebanese papers write it both ways — "1-1" and "1–2".
#
# The dash form used to be unreadable. "1-1)" matched the leading 1 and took the
# dash for the terminator, so every sub-question in section 1 came back labelled
# "1": six distinct parts of gs/2017 2/phy_fr sharing one label, and with it one
# mark and one official answer. A dash only continues the label when a digit
# follows it, so "1- Identification du dipôle" still reads as part 1 with a
# heading, which is what it is.
LABEL = r"\d{1,2}(?:[.\-–]\d{1,2}){0,2}"

# "1.1-", "2.3.1)", "1-" at the start of a line: a sub-question label.
#
# The separator must be a dash or a bracket, or a full stop with a space after
# it. Allowing a bare full stop made "1.010-2 mol.L-1" — a concentration wrapped
# onto its own line — read as sub-question 1.
PART = re.compile(rf"(?m)^[ \t]*({LABEL})\s*(?:[-–)：:]|\.(?=\s))\s*(?=\S)")

# A marking-scheme row: label, the answer, then the mark alone at the end.
SCHEME_ROW = re.compile(rf"(?m)^[ \t]*({LABEL})\s+(.+?)\s+{MARK}\s*$")


def norm_label(label: str) -> str:
    """One spelling for a label, so the paper's half and the scheme's half meet.

    A paper may print "1-2" where its own marking scheme prints "1.2". They are
    the same sub-question and must key the same, or the answer is attached to
    nothing. Everything folds to the full stop.
    """
    return re.sub(r"[\-–]", ".", label)


# A section heading inside an exercise: "I- Dilution of a commercial acid",
# "II- Titration", "A- Etude du mouvement".
#
# An exercise is commonly divided into lettered or roman-numbered sections that
# each RESTART their numbering at 1, so the number alone does not identify a
# sub-question. gs/2004 1 chemistry exercise 1 runs 1, 2 under I- and then 1, 2,
# 3 under II-, and stored five parts under three labels.
#
# Alphabetic only. A digit here would swallow ordinary sub-questions, and the
# distinction is what lets `unqualified` tell a section prefix ("I.1") from a
# genuine numeric hierarchy ("1.1") later.
SECTION = re.compile(r"(?m)^[ \t]*([IVX]{1,5}|[A-E])\s*[-–.)]\s*(?=\S)")


def sections_in(text: str) -> list:
    """(position, name) for every section heading, in the order they appear."""
    return [(m.start(), m.group(1)) for m in SECTION.finditer(text)]


def qualify(label: str, pos: int, sections: list) -> str:
    """The label with the section it sits under, where there is one."""
    name = None
    for at, section in sections:
        if at > pos:
            break
        name = section
    return f"{name}.{label}" if name else label


def unqualified(label: str) -> str:
    """The label without its section, for papers whose scheme prints no sections.

    Only an alphabetic head is stripped. "I.1" is part 1 of section I and
    reduces to "1"; "1.1" is a numeric hierarchy the paper wrote itself and is
    left alone.
    """
    head = label.split(".", 1)
    return head[1] if len(head) == 2 and head[0][:1].isalpha() else label

# The header of a marking scheme, in any of the three languages.
#
# TWO PATTERNS, BECAUSE THE TWO CALLERS RISK DIFFERENT AMOUNTS.
#
# `split_paper_and_scheme` uses this one to decide, a page at a time, where the
# question paper ends and its answer key begins. A false positive there discards
# EVERY EXERCISE AFTER THAT PAGE. `without_scheme` uses SCHEME_IN_STATEMENT
# below to trim inside a statement already known to be an exercise, where a
# false positive costs part of one question and is bounded by the 40-character
# guard.
#
# Measured, not assumed. Widening this one pattern for both callers cost
# 29 papers, 157 exercises and 682 sub-questions against the full corpus, while
# recovering 67 answers — the same shape as the mark-column split that was
# reverted for costing 683 sub-questions to recover nothing. A signal good
# enough to TRIM on is not automatically good enough to SPLIT on.
#
# corrig[ée] is corrig[ée]s?\b in BOTH, so it cannot match the French
# IMPERATIVE. "indiquer les expressions correctes et corriger celles qui sont
# fausses" is an instruction to the candidate, not the header of an answer key.
# Over 4,225 statements, 23 carried corrig[ée] and ALL 23 were the verb; the
# noun "corrigé" does not occur once in this corpus. The alternative was
# recovering nothing and truncating twenty real questions mid-sentence.
SCHEME_HEAD = re.compile(
    r"أسس\s*ال?تصحيح|معايير\s*التصحيح|سلّ?م\s*ال?تصحيح|"
    r"ال[أإا]?جابة\s*ال?متوقعة|الجواب\s*ال?متوقع|"
    r"bar[eè]me|corrig[ée]s?\b|r[ée]ponses?\s*attendues?|[ée]l[ée]ments?\s*de\s*r[ée]ponse|"
    r"marking\s*scheme|answer\s*key|expected\s*answers?|"
    r"(?:question|part\s+of).{0,30}(?:answer|answers).{0,30}(?:mark|note)",
    re.I | re.S,
)

# The same thing, as it is printed INSIDE a statement. Only `without_scheme`
# may use this: see the blast-radius note above.
#
# The Arabic half of the original was mostly decorative. Counted against all
# 4,225 live statements in the database:
#
#     أسس\s*ال?تصحيح       13   `ال?` is "ا" followed by an OPTIONAL "ل", so the
#                               alef is mandatory and the form the papers
#                               actually print — أسس تصحيح مادة الفلسفة, with no
#                               article — never matched. As (?:ال)? it matches 70.
#     معايير\s*التصحيح      0   never fired on anything
#     سلّ?م\s*ال?تصحيح       0   never fired on anything
#     معيار التصحيح       135   ABSENT, and it is the most common header in this
#                               corpus: papers title the key مشروع معيار التصحيح.
#     عناصر الإجابة        60   ABSENT, though it is the exact Arabic of the
#                               éléments de réponse already listed in French.
#
# معيار and معايير stay separate alternatives: they are different words —
# criterion and criteria — and a pattern that blurs them is one nobody can check
# against a paper.
#
# The 201 statements this newly truncates were each verified: 156 carry a mark
# column or examiner instructions in the removed text — a signal independent of
# the pattern that made the cut — and the other 45 were read individually. All
# are marking schemes. Those 45 lacked automatic corroboration only because OCR
# damages the corroborating words themselves: العلامـة carrying a tatweel,
# العلاهة and الوقترحة with م read as ه.
SCHEME_IN_STATEMENT = re.compile(
    r"أسس\s*(?:ال)?تصحيح|معايير\s*(?:ال)?تصحيح|معيار\s*(?:ال)?تصحيح|سلّ?م\s*(?:ال)?تصحيح|"
    r"عناصر\s*(?:ال)?[أإا]?جابة|"
    r"ال[أإا]?جابة\s*ال?متوقعة|الجواب\s*ال?متوقع|"
    r"bar[eè]me|corrig[ée]s?\b|r[ée]ponses?\s*attendues?|[ée]l[ée]ments?\s*de\s*r[ée]ponse|"
    r"marking\s*scheme|answer\s*key|expected\s*answers?|"
    r"(?:question|part\s+of).{0,30}(?:answer|answers).{0,30}(?:mark|note)",
    re.I | re.S,
)

# A line that is nothing but a small number: one cell of a scheme's mark column.
#
# This is the signal SCHEME_HEAD is not. A scheme announces itself in words on
# most papers and on plenty of others it simply starts — gs/2019/math_en.pdf
# opens its scheme on "A3b" with no header anywhere in the file, and every
# header-based test declines. What no scheme can do without is the column of
# marks running down its right-hand edge, which PDF extraction flattens into
# exactly this: short lines holding a number and nothing else.
MARK_CELL = re.compile(r"(?m)^[ 	]*(?:0?[.,]\d{1,2}|[0-9]{1,2}(?:[.,]\d{1,2})?)[ 	]*$")

# The same cell, captured. Kept separate from MARK_CELL on purpose: that
# pattern is what the "not recovered" counters are measured with, and a
# detector that changes shape between runs makes its own history
# incomparable — which it did, moving both counters by fifteen when it was
# widened to capture.
MARK_VALUE = re.compile(r"(?m)^[ 	]*(0?[.,]\d{1,2}|[0-9]{1,2}(?:[.,]\d{1,2})?)[ 	]*$")

# How many such cells make a column rather than a coincidence.
#
# Five, measured against the false positive this has to survive: a maths
# question page carries bare numbers too — axis labels, a table of values, the
# right-hand side of a displayed equation broken onto its own line — but they
# come in ones and twos. A scheme's column runs the length of the page.
MARK_COLUMN = 5


def scheme_signal(text: str) -> int:
    """How strongly a page looks like it is awarding marks rather than asking for them."""
    return len(MARK_CELL.findall(text))


# "It Is Inscribed on Four Pages" — the paper stating its own length.
WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
         "eight": 8, "nine": 9, "ten": 10}
PAGE_COUNT = re.compile(
    r"inscribed\s+on\s+(\w+)\s+pages|comporte\s+(\w+|\d+)\s+pages?|"
    r"(?:من|في)\s+([\w٠-٩]+)\s+صفحات", re.I)


def to_number(raw: str) -> float:
    """The value of a mark as these papers write it.

    Widened alongside `MARK` to read fractions. A mixed number is whole plus
    part; a bare fraction is the part alone. Anything unreadable stays 0.0, so a
    pattern that matches something this cannot value fails closed rather than
    inventing a mark.
    """
    if raw is None:
        return 0.0
    text = str(raw).translate(AR_DIGITS).strip()

    # "1⁄2" or "1/2" written out.
    slashed = re.match(r"^(\d{1,2})?\s*(\d)\s*[⁄/]\s*(\d)$", text)
    if slashed:
        whole = float(slashed.group(1) or 0)
        num, den = float(slashed.group(2)), float(slashed.group(3))
        return whole + (num / den if den else 0.0)

    # "6½" or a bare "½".
    m = re.match(r"^(\d{1,2})?\s*([½¼¾⅓⅔⅛])$", text)
    if m:
        return float(m.group(1) or 0) + FRACTION_VALUE[m.group(2)]

    try:
        return float(text.replace(",", "."))
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

    Both tests are about WORDING, and that is their limit. Neither fires on a
    scheme that simply begins — gs/2019/math_en.pdf runs its answers down eight
    pages under the labels A3b, B1, C1 with a mark against each, and no word
    anywhere in the file says "barème". 859 papers are read here as having no
    scheme, and on a sample of them 38% carry a mark column.

    Splitting those out on the layout instead was tried and did not work: it
    moved `papers with a marking scheme` not at all, because finding the
    boundary is not the binding constraint. `parse_scheme` cannot read these
    layouts once it has them — the French papers print a four-column
    Questions/Réponses/Critères/Note table where it expects three, and the
    maths papers label rows `A3b` where the paper labels parts `3.2`, so every
    row is read and then matched to nothing. Fix the reader first; the split is
    downstream of it.

    The mark column is still computed, and reported on, so the size of this gap
    is visible in every run rather than being inferred from a suspicious zero.
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

    # Nothing said so. Ask the layout instead of the wording: cut at the first
    # page in the BACK HALF of the file that carries a mark column.
    #
    # A contiguous trailing run of mark-column pages was tried here instead, and
    # reverted. The argument for it was good — a scheme ends where the file ends,
    # so anchoring on the end is what the layout guarantees, and a run of pages
    # is harder to counterfeit than a single page — and on a 250-paper sample it
    # measured better. On the full corpus it measured worse on both counts that
    # matter:
    #
    #                                  back half   trailing run
    #     statements like a scheme           523            588
    #     answers attached to a part        1835           1815
    #
    # More contaminated statements AND fewer answers recovered. The sample had
    # flattered it because the rule fires rarely and the papers it fires wrongly
    # on are not evenly spread: a 250-paper slice caught the papers it helped and
    # almost none of the papers it hurt. Any rule this narrow has to be judged on
    # a full run — a sample can only fail to find its failures.
    #
    # Refused when the boundary would swallow the first exercise: a boundary
    # above the questions is not a boundary, and losing the paper costs more
    # than losing its barème.
    half = len(pages) // 2
    for i in range(half, len(pages)):
        if scheme_signal(pages[i]) >= MARK_COLUMN and i > (first_exercise or 0) + 1:
            return pages[:i], pages[i:]

    return pages, []


ROMAN = {"i": 1, "ii": 2, "iii": 3, "iv": 4, "v": 5, "vi": 6}

# The most one alternative of a choice paper can be worth. A candidate answers
# one subject and is marked out of twenty; a little headroom above that, and
# anything beyond it is a number read off the page by mistake.
MAX_SUBJECT_MARKS = 25


# The verbs a paper uses to set work, in the three languages of instruction.
ASSIGNMENT = re.compile(
    r"(?:^|[\s(\-–—])(?:"
    + r"حدّ?د|اشرح|بيّ?ن|استخرج|استخلص|استنتج|عدّ?د|علّ?ل|اذكر|صنّ?ف|قارن|ناقش|اكتب|أعط|اعط|ضع|أبرز|ابرز|لخّ?ص|عرّ?ف|أجب|اجب"
    + r"|" + r"d[ée]gagez|expliquez|montrez|justifiez|relevez|analysez|comparez|d[ée]finissez|citez|r[ée]digez|commentez|pr[ée]cisez"
    + r"|" + r"explain|describe|discuss|justify|compare|define|analyse|analyze|comment|outline|state briefly"
    + r")(?=[\s:.,،]|$)",
    re.I | re.M,
)


def find_headers(text: str, allow_subject_split: bool = True, profile: str | None = None) -> tuple:
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
    # A language paper only, and only once every rule above has found nothing.
    if profile == "language":
        found = list(PART_SCORE_PADDED.finditer(text))
        if found:
            return found, "part"
    # A paper that SAYS it offers a choice of subjects is split on them.
    #
    # Philosophy and literature papers print "First Subject: / Second Subject: /
    # Third Subject:" and the candidate answers ONE; each is a complete
    # alternative worth the whole paper. Reaching the subject test only at the
    # very end meant lh/2018 1/falsafe_en.pdf — three subjects of 9 + 7 + 4 —
    # was read as a single exercise with eight parts summing to 51 marks on a
    # paper marked out of 20.
    #
    # Gated on the paper announcing the choice in words, and that gate is the
    # whole of what makes this safe. Subject headings alone are not enough:
    # se/2018 1/arabe.pdf mentions الموضوع in its prose, and splitting on that
    # took a correctly-parsed document paper of twelve sub-questions down to
    # one, losing four thousand characters of statement. It says nothing about
    # choosing, so it is left to the branches below that were already reading
    # it properly.
    if allow_subject_split and len(SUBJECT_HEAD.findall(text)) >= 2 and CHOICE_NOTICE.search(text):
        return list(SUBJECT_HEAD.finditer(text)), "subject"

    # Arabic humanities papers: ordinal headings, marks spelled out in words.
    found = list(AR_ORDINAL_HEAD.finditer(text))
    if len(found) >= 2:
        return found, "arabic-ordinal"
    # Document-based papers: numbered questions, marks against the sub-parts.
    #
    # Spelled marks deliberately do NOT open this gate. Counting them was tried
    # and measured: it let the numbered rule fire on the paragraph numbers of a
    # reading passage, so 97 papers that parsed correctly were split into
    # nonsense and rejected, and 135 more changed. The gate is not asking "does
    # this paper award marks" — `word_marks` answers that, for totals. It is
    # asking "are the numbers in this text question numbers rather than
    # paragraph numbers", and a digit beside a mark is the only evidence of that
    # which does not also appear inside a passage.
    if len(AR_DIGIT_MARK.findall(text)) + len(AR_BARE_POINT.findall(text)) >= 2:
        found = list(AR_NUM_HEAD.finditer(text))
        if len(found) >= 2:
            return found, "arabic-numbered"

    # Essay and document papers, which is how the humanities are examined.
    #
    # A geography or civics paper prints a source — a passage, a map, a table —
    # and asks the candidate to work from it. Its questions are numbered, but
    # they carry no marks: the marks are in the scheme at the end of the file,
    # which is split off before this runs. Every branch above needs a mark
    # beside a header to believe it is looking at an exercise, so all of them
    # decline, and 646 of the 2,090 papers we hold were dropped whole for it.
    # Geography parsed at 7%, civics at 15%, against physics at 100%.
    #
    # What marks an assignment here is the instruction rather than the number:
    # حدّد، استنتج، dégagez, explain. Two of those plus numbered questions is a
    # paper setting work, and nothing else in a corpus of exam papers looks like
    # that. The marks are recovered from the scheme where it parses, and left at
    # zero where it does not — an exercise with no barème is still practice.
    if len(ASSIGNMENT.findall(text)) >= 2:
        found = list(AR_NUM_HEAD.finditer(text))
        if len(found) >= 2:
            # One exercise, not thirteen. These papers set a single piece of
            # work — read this source, then answer about it — and the numbers
            # running down the page are its questions, not separate exercises.
            # Treating each as its own exercise produced "13 exercises, 10
            # marks" and the plausibility gate threw the paper out, which is the
            # gate doing its job on a bad reading. Everything from the first
            # numbered question to the end is the assignment, and `parse_exercises`
            # splits the questions out of it as parts.
            return found[:1], "arabic-numbered"

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

    Cutting on the mark column as well was tried and reverted. A maths
    statement breaks equations onto short numeric lines, so the first "mark
    cell" lands in the middle of the question: on 250 papers it removed 683
    sub-questions and 45 answers to recover none. The column is a good enough
    signal to REPORT on and not good enough to CUT on, and those are different
    bars.
    """
    hit = SCHEME_IN_STATEMENT.search(statement)
    if not hit or hit.start() < 40:
        return statement
    return statement[: hit.start()].rstrip()


# The ministry's letterhead, printed across the top of every official paper:
# the two directorates, the examinations office, the session, the branch, the
# duration, and the blank name and number the candidate fills in.
#
# It lands in the middle of a statement often enough to matter — 438 stored
# questions carry it — because a two-column or multi-page exercise puts the
# header of the next page inside the text of the current part. It is not the
# question, it is identical on every paper of that session, and inside an
# embedding it is 200 characters of noise that every paper shares.
# Several letters are unreliable in these scans: م comes back as ه, ن or و, and
# ي as ى. "وزارة التربية والتعلين العالي" and "الوديرية العاهة" are the same
# banner as everywhere else, and matching them literally missed every paper
# whose OCR was poor — which is disproportionately the ones that need the help.
M = "[مهنو]"
Y = "[يى]"
MINISTRY_BANNER = re.compile("|".join([
    rf"وزارة\s*التربية(\s*والتعلي{M}\s*العالي)?",
    rf"ال{M}ديرية\s*العا{M}ّ?ة?\s*للتربية",
    rf"دائرة\s*الا{M}تحانات(\s*الرس{M}ي{Y}?\s*ة?)?",
    rf"ا{M}تحانات\s*الشهادة\s*الثان{Y}?و?{Y}?ة\s*العا{M}ة",
    rf"{M}سابقة\s*في",
    r"المدة\s*:\s*\S+",
    r"الاسم\s*:", r"الرقم\s*:",
    r"دورة\s*ال?\u0640?(عام|سنة)\s*\d{0,4}",
    rf"فرع[اي]?\s*:?\s*ال[إا]?جت{M}اع",
    rf"العلو{M}\s*العا{M}ة",
    r"ال[إا]?ستثنائية",
    r"العادية\s*المعدلة",
    rf"الآداب\s*وال[إا]نسانيات",
]))

# Two markers closer together than this are one letterhead with connective
# words between them; further apart and they are separate occurrences.
BANNER_GAP = 90
# What makes a run a letterhead: the banner names two offices and a session, so
# two markers standing together is the signature, and one phrase alone is not.
#
# This counts MARKERS rather than characters. A character floor rejected
# "وزارة التربية والتعليم العالي" followed by "المديرية العامة للتربية" — the
# ministry and its directorate, unmistakably the banner — for spanning 54
# characters against a floor of 55.
BANNER_MIN_MARKERS = 2
# One marker is still enough when it is the banner's own long form, which
# appears nowhere else on a paper.
BANNER_ALONE = re.compile(
    rf"وزارة\s*التربية\s*والتعلي{M}\s*العالي|"
    rf"ا{M}تحانات\s*الشهادة\s*الثان{Y}?و?{Y}?ة\s*العا{M}ة"
)


def without_letterhead(statement: str) -> str:
    """The statement with the ministry's header cut out of it.

    Excised as a block rather than truncated at the first marker, because 170
    of these carry real content AFTER the header — a paper whose second page
    begins mid-exercise — and truncating would throw the question away to
    remove its banner.

    Every cut runs from one marker to another marker. An earlier version ended
    each pattern with a greedy `[^\\n]{0,60}` tail to sweep up the connective
    words, and that tail ran past the header into the question: "Doc. 1" came
    out as "oc. 1" and "Heat from the Sun" as "eat from the Sun". Merging
    nearby markers into a run does the same job and cannot eat the text on
    either side of it.
    """
    matches = [(m.start(), m.end()) for m in MINISTRY_BANNER.finditer(statement)]
    if not matches:
        return statement

    runs = [[matches[0][0], matches[0][1], 1]]
    for start, end in matches[1:]:
        if start - runs[-1][1] <= BANNER_GAP:
            runs[-1][1] = max(runs[-1][1], end)
            runs[-1][2] += 1
        else:
            runs.append([start, end, 1])

    out = statement
    for start, end, markers in reversed(runs):
        if markers < BANNER_MIN_MARKERS and not BANNER_ALONE.search(statement[start:end]):
            continue
        # Rejoined with a NEWLINE, not spaces. `PART` is anchored to the start
        # of a line, so closing the gap with spaces pulled the sub-question that
        # followed the banner into the middle of a line and it stopped being a
        # sub-question at all: "1- Specify the threshold intensity of fiber F1."
        # vanished from lh/2018 1/bio_makfufin_en.pdf that way.
        out = out[:start].rstrip() + chr(10) + out[end:].lstrip()

    out = re.sub(r"[ \t]{3,}", "  ", out).strip()
    # A statement that was nothing but letterhead is not an exercise. Handed
    # back whole so the length check downstream discards it, rather than being
    # stored as a stub — the same rule `without_scheme` follows.
    return out if len(out) > 40 else statement


# The block every Lebanese paper opens with: ministry, directorate, examinations
# department, session, subject, duration, and two blank fields for the
# candidate's name and number. Fixed wording, and the only part of the preamble
# that is never the passage.
LETTERHEAD = re.compile(
    r"وزارة\s*التربية|المديرية\s*العامة|دائرة\s*الامتحانات|امتحانات\s*شهادة|"
    r"مسابقة\s*في|المدة\s*:?\s*ساعة|المدة\s*ساعت|الاسم\s*:|الرقم\s*:|"
    r"ministry\s+of\s+education|general\s+directorate|name\s*:|number\s*:|duration\s*:",
    re.I,
)

# Shorter than this and it is a heading, not a text to be examined on.
PASSAGE_MIN = 400


def paper_passage(preamble: str) -> str:
    """The text printed on the paper for the candidate to work from.

    A comprehension question — "identifiez le référent du pronom « on » dans les
    deux premiers paragraphes du texte de Lamennais" — is answerable only
    against a passage that exists on the exam paper and in no chapter of any
    book. `parse_exercises` starts reading at the first exercise header, so on
    a French or Arabic literature paper everything before that header is
    dropped, and the passage is exactly what is before that header: 3,580
    characters of it on gs/2005 1/gs french 1.pdf alone.

    Retrieval has been refusing these and asking the student to paste the text
    in. It was in the file the whole time.

    What is cut is the letterhead and nothing else. Cutting more — the line
    number gutter, the vocabulary glosses printed under the extract — would be
    guessing at layout, and a passage with some furniture around it still
    answers the question, where a passage trimmed into is a wrong answer.
    """
    lines = preamble.splitlines()
    last_header = -1
    for i, line in enumerate(lines):
        if LETTERHEAD.search(line):
            last_header = i
    body = chr(10).join(lines[last_header + 1:]).strip()

    # Letters, not characters: a page of line numbers and whitespace is not a
    # passage however long it runs.
    letters = sum(1 for ch in body if ch.isalpha())
    return body if letters >= PASSAGE_MIN else ""


def parse_exercises(text: str, allow_subject_split: bool = True, profile: str | None = None) -> list:
    """Each exercise's number, marks, title and statement, in order.

    `allow_subject_split=False` forbids the choice-of-subjects reading, so the
    same paper can be parsed both ways and the two compared. See `read`.
    """
    found, kind = find_headers(text, allow_subject_split, profile)
    out = []
    for n, m in enumerate(found):
        body = text[m.end():found[n + 1].start() if n + 1 < len(found) else len(text)]
        # The title sits on the rest of the header line.
        rest = body.split("\n", 1)
        title = re.sub(r"\s+", " ", rest[0]).strip(" :-–)")
        statement = without_letterhead(without_scheme((rest[1] if len(rest) > 1 else "").strip()))
        index = header_index(m, kind, n + 1)
        sections = sections_in(statement)
        parts = [{"label": qualify(norm_label(p.group(1)), p.start(), sections), "at": p.start()}
                 for p in PART.finditer(statement)]
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


def subject_answers(text: str) -> dict:
    """{subject number: the whole expected answer} from an essay scheme.

    Philosophy is not marked with a table. Its scheme runs "الموضوع الأول :" and
    then the essay the examiner expects — introduction, explanation, discussion,
    conclusion — with the marks written in words inside the prose. There are no
    labelled rows to read, and the paper it belongs to has no sub-parts either:
    a philosophy question is one instruction and one essay.

    So the answer is the block, whole. That is what an official solution is for
    this subject, and refusing to store it because it is not a table left 764
    philosophy questions — the largest bank in the corpus — with none.
    """
    heads = list(SUBJECT_HEAD.finditer(text))
    blocks = {}
    for n, m in enumerate(heads):
        end = heads[n + 1].start() if n + 1 < len(heads) else len(text)
        body = re.sub(r"[ 	]+", " ", text[m.end():end]).strip()
        if len(body) < 60:
            continue
        blocks[header_index(m, "subject", n + 1)] = body
    return blocks


def scheme_mark_column(text: str) -> dict:
    """{exercise number: the marks down its scheme's right-hand column, in order}

    The other half of a marking scheme, and the half that is recoverable.

    `parse_scheme` wants a label, an answer and a mark on one line, which is how
    a Question/Answer/Note table extracts when it extracts well. On 599 papers
    it does not: the label sits on its own line, the answer wraps over five, and
    the marks come out as a column of bare numbers detached from the rows they
    belong to. Those rows cannot be matched to a part by label, because the
    scheme labels them `A3b` where the paper labels them `3.2`.

    Matching them by POSITION would be guesswork, and the wrong kind: an answer
    key attached to the wrong sub-question is a confident wrong answer shown to
    a student, which is the failure this whole file is arranged to avoid. So the
    answers are left alone.

    The marks are different. A barème is {criterion, points}, the criterion is
    the paper's own words for that part — already correct, already stored — and
    only the points are missing. Aligning those by position risks a part being
    marked out of 2 when it was out of 1.5, which is worth having against not
    being able to mark the question at all. And it is checkable: the exercise
    header states its own total, so an alignment whose marks do not add up to it
    is rejected. See `read` for that gate.
    """
    headers = list(EXERCISE.finditer(text))
    if not headers:
        blocks = [(0, text)]
    else:
        blocks = []
        for n, m in enumerate(headers):
            end = headers[n + 1].start() if n + 1 < len(headers) else len(text)
            blocks.append((exercise_index(m) or (n + 1), text[m.end():end]))

    out = {}
    for index, block in blocks:
        marks = [to_number(cell.strip()) for cell in MARK_VALUE.findall(block)]
        # A mark of zero is a page number or a stray digit, not an award.
        out[index] = [m for m in marks if m > 0]
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
        sections = sections_in(block)
        for m in SCHEME_ROW.finditer(block):
            label = qualify(norm_label(m.group(1)), m.start(), sections)
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


# The scheme read from the page's own ruling. Optional: a deployment without
# pdfplumber loses this source and keeps every other one.
try:
    from scheme_table import scheme_from_tables, group_to_parts
except ImportError:  # pragma: no cover
    scheme_from_tables = None


# What a scheme's total may legitimately be, as a multiple of what the paper
# says it is worth. 1 is the obvious one; 2 is real and common — gs/2005 1
# prints 2.5/2/2/3/3.5/7 on the paper and marks 5/4/4/6/7/14, totalling 40 for
# a paper out of 20. Anything else means the two readings do not describe the
# same paper, and the marks are refused rather than rescaled by a number nobody
# recognises.
SCALES = (1.0, 2.0)

# Set from --no-tables. Module-level so `read()` stays a one-argument function
# that `--show` and the batch loop can both call.
NO_TABLES = False

# Counted across the run and printed, so the size of what this refuses is
# visible instead of being inferred from a number that did not move.
TABLE_STATS = Counter()


def table_marks(pdf: Path, exercises: list) -> dict:
    """{exercise: {part label: marks}} from the ruled scheme table, or {}.

    Three things stand between a recovered table and a stored mark, and all
    three are checks the paper performs on itself rather than judgements made
    here.

    ATTRIBUTION. Only 6.7% of papers with a table name the exercise each one
    marks ("Q 1"); the rest are numbered by the order they appear. That is an
    assumption, so it is only accepted when the number of scheme tables equals
    the number of exercises parsed off the question paper.

    SCALE. The scheme is often not on the paper's scale — see SCALES. The ratio
    is measured per exercise and every exercise must agree, which is the real
    check: a misread row changes one exercise's sum and breaks the agreement.
    gs/2018 2/math_fr.pdf comes back [2.0, 2.4] and is refused whole.

    GRANULARITY. A scheme writes 2a, 2b, 2c where the paper has one part
    numbered 2, so rows are folded onto the paper's numbering and their marks
    summed. See `group_to_parts`.

    Answers are deliberately not returned. They are the half that cannot be
    made safe by a sum check.
    """
    if scheme_from_tables is None or not exercises:
        return {}
    read = scheme_from_tables(pdf)
    tables = read["tables"]
    if not tables:
        return {}
    TABLE_STATS["papers with a scheme table"] += 1

    if read["attribution"] == "positional" and tables != len(exercises):
        TABLE_STATS["refused: table count != exercise count"] += 1
        return {}

    grouped = {ex: group_to_parts(rows) for ex, rows in read["by_exercise"].items()}
    stated = {e["index"]: e["marks"] for e in exercises}

    ratios = {}
    for index, parts in grouped.items():
        total = sum(p["marks"] for p in parts.values() if p["marks"] is not None)
        want = stated.get(index) or 0
        if total > 0 and want > 0:
            ratios[index] = total / want
    if not ratios:
        TABLE_STATS["refused: paper states no exercise totals"] += 1
        return {}

    # The scale the exercises agree on, not the scale the first one happens to
    # show. Requiring unanimity made this a whole-paper veto: gs/2015 2/math_en
    # reads exercises 1-5 at exactly x2 and exercise 6 at x1.357, and all six
    # were discarded to punish the one. The agreement is still the detector —
    # nothing else catches a misread row — but it is applied per exercise, so a
    # bad exercise costs its own marks instead of the paper's.
    #
    # Two agreeing exercises are needed to establish a scale, because one
    # exercise agreeing with itself is not evidence of anything. A paper with a
    # single measurable exercise is the exception: there is no second opinion to
    # be had, and refusing it would drop marks that are accepted today.
    scale, agreeing = None, ()
    for candidate in SCALES:
        matched = tuple(i for i, r in ratios.items() if abs(r - candidate) < 0.02)
        if len(matched) > len(agreeing):
            scale, agreeing = candidate, matched
    if scale is None:
        shown = sorted(ratios.values())[len(ratios) // 2]
        TABLE_STATS[f"refused: unrecognised scale x{shown:.2f}"] += 1
        return {}
    if len(agreeing) < 2 and len(ratios) > 1:
        # A recognised scale, but only one exercise showing it while others
        # disagree. Counted separately: calling this an unrecognised scale
        # would have read as "the paper is on some other scale" when what
        # happened is that nothing corroborated the scale it is on.
        TABLE_STATS[f"refused: only 1 of {len(ratios)} exercises at x{scale:g}"] += 1
        return {}

    dissenting = set(ratios) - set(agreeing)
    TABLE_STATS[f"accepted at scale x{scale:g}"] += 1
    if dissenting:
        TABLE_STATS["exercises dropped for disagreeing on the scale"] += len(dissenting)

    # An exercise the paper states no total for cannot be checked against the
    # scale either way. It is kept only when nothing on the paper dissented —
    # which is exactly the condition under which it was kept before — so this
    # change adds recovered exercises without quietly widening what an
    # unverifiable one is worth.
    return {
        index: {label: part["marks"] / scale
                for label, part in parts.items() if part["marks"] is not None}
        for index, parts in grouped.items()
        if index in agreeing or (index not in ratios and not dissenting)
    }


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

    # Which subject's rules this paper is read with, decided from its filename
    # and used nowhere else. A subject without a profile gets exactly the
    # cascade it got before profiles existed.
    profile = profile_for(str(pdf))
    exercises = parse_exercises(paper, profile=profile)

    # Splitting a choice paper must not cost it its questions.
    #
    # Cutting at the subject headings is right when each subject really is a
    # self-contained alternative, and on ten philosophy papers it was not: the
    # sub-questions did not fall inside the subject blocks, and the split took
    # lh/2006 2/falsafe_en.pdf from twelve parts to two, dropping 3,900
    # characters and all fifteen of its marks. In aggregate the change was a
    # clear gain — +124 exercises, +101 sub-questions, +100 marks — which is
    # exactly how this kind of damage stays hidden.
    #
    # So the paper is read BOTH ways and the readings are compared on what they
    # recovered. More sub-questions wins, and marks break the tie. A split that
    # cannot beat leaving the paper whole is not a split worth having, and this
    # needs no rule about which papers are the awkward ones.
    split_into_subjects = bool(exercises) and find_headers(paper, profile=profile)[1] == "subject"
    if split_into_subjects:
        whole = parse_exercises(paper, allow_subject_split=False, profile=profile)

        def yield_of(rows):
            return (sum(len(e["parts"]) for e in rows),
                    sum(e["marks"] for e in rows))

        if whole and yield_of(whole) > yield_of(exercises):
            exercises = whole
            # And it is no longer a choice paper as far as everything below is
            # concerned. Leaving the flag set applied the per-subject mark cap
            # to a whole-paper reading and zeroed gs/2005 2/falsafe_en.pdf's
            # fifty marks, because fifty is implausible for one subject and
            # entirely normal for a paper.
            split_into_subjects = False
    if not exercises:
        return {"path": str(pdf.relative_to(EXAMS)), "error": "no exercise headers"}

    # Everything before the first exercise header. On a science paper this is
    # the letterhead and nothing else; on a comprehension paper it is the text
    # the whole exam is about. `paper_passage` tells them apart by length.
    headers, _kind = find_headers(paper, profile=profile)
    passage = paper_passage(paper[: headers[0].start()]) if headers else ""

    # A Lebanese paper is marked out of twenty. One offering a choice prints more
    # — three subjects worth twenty each — but nothing prints a hundred, and no
    # paper sets sixteen exercises. A total that far out means the headers matched
    # prose rather than questions, and the parse is wrong in a way that reading
    # the output would not reveal.
    #
    # Reported, not stored: a question saved without its real marks would be used
    # to score a student.
    # A choice paper is not worth the sum of its alternatives. Six subjects of
    # twenty is a candidate scoring out of twenty, not out of 120, and summing
    # them tripped the plausibility gate and threw the whole paper away.
    #
    # An alternative that reads as worth more than a whole paper is a misread
    # mark, not a subject: lh/2004 2/falsafe_ar.pdf comes out as 0, 0 and 120.
    # Its marks are dropped to unknown rather than the paper being rejected,
    # because the STRUCTURE is right — three subjects, correctly found — and
    # losing three real questions over one bad number is the worse trade. An
    # exercise with no marks simply gets no barème.
    if split_into_subjects:
        for e in exercises:
            if e["marks"] > MAX_SUBJECT_MARKS:
                e["marks"] = 0
        total_marks = max((e["marks"] for e in exercises), default=0)
    else:
        total_marks = sum(e["marks"] for e in exercises)
    if len(exercises) > 10 or total_marks > 70:
        return {
            "path": str(pdf.relative_to(EXAMS)).replace(chr(92), "/"),
            "error": f"implausible parse ({len(exercises)} exercises, {total_marks:g} marks)",
        }

    scheme = parse_scheme(scheme_text) if scheme_text else {}
    mark_columns = scheme_mark_column(scheme_text) if scheme_text else {}
    essays = subject_answers(scheme_text) if scheme_text else {}
    # Read from the page's ruling rather than from its flattened text. Read for
    # the whole file, not for `scheme_pages`: the geometric reader finds the
    # scheme by the shape of its table, so it does not depend on the text-based
    # split having found the boundary — which for these papers it often has not.
    from_tables = {} if NO_TABLES else table_marks(pdf, exercises)
    for ex in exercises:
        # An essay paper's answer belongs to the exercise, not to a part it does
        # not have. Carried on a part with no label because that is the shape
        # the loader reads solutions out of.
        if not ex["parts"] and ex["index"] in essays:
            ex["parts"].append({
                "label": "",
                "text": ex["title"][:200],
                "answer": essays[ex["index"]],
                "marks": arabic_marks(essays[ex["index"]]),
            })
        answers = scheme.get(ex["index"], {})

        # Both halves are read for sections, but they do not always agree: a
        # paper divided into I- and II- may be marked by a scheme that numbers
        # its rows straight through. Qualified labels then match nothing, and
        # the answers would be lost to a change meant to place them better. So
        # the section is dropped from both sides and matched again — which is
        # exactly what happened before sections were read at all, and no worse.
        keys = [part["label"] for part in ex["parts"]]
        if answers and not any(k in answers for k in keys):
            answers = {unqualified(k): v for k, v in answers.items()}
            keys = [unqualified(k) for k in keys]

        for part, key in zip(ex["parts"], keys):
            found = answers.get(key)
            if found:
                part["answer"] = found["answer"]
                part["marks"] = found["marks"]

        # The table's marks, attached only where the label-matched scheme left
        # a part without one. Ordered this way deliberately: a mark that came
        # with its own answer text is the better evidence, and this must be
        # able to fill gaps without ever overwriting one.
        for part in ex["parts"]:
            if part.get("marks") is None or "marks" not in part:
                mark = from_tables.get(ex["index"], {}).get(part["label"])
                if mark is not None:
                    part["marks"] = mark

        # The barème, from a scheme whose rows could not be matched by label.
        #
        # Only when no part got marks any other way, only when there is exactly
        # one mark per part, and only when those marks add up to the total the
        # exercise header states about itself. That last condition is what makes
        # this a reading rather than a guess: a column of numbers that happens
        # to have the right length will not also happen to sum to the right
        # total, and if it does, the alignment is right.
        column = mark_columns.get(ex["index"], [])
        stated = ex["marks"]
        if (
            ex["parts"]
            and not any("marks" in q for q in ex["parts"])
            and len(column) == len(ex["parts"])
            and stated > 0
            and abs(sum(column) - stated) < 0.01
        ):
            for part, mark in zip(ex["parts"], column):
                part["marks"] = mark

    rel = pdf.relative_to(EXAMS)
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
        "passage": passage,
        # The same figure the plausibility gate judged, so a paper is never
        # reported as worth something other than what it was accepted for.
        "totalMarks": total_marks,
        "answersFound": sum(1 for e in exercises for p in e["parts"] if "answer" in p),
        "marksFound": sum(1 for e in exercises for p in e["parts"] if "marks" in p),
        # Evidence that this file HOLDS a scheme, independent of whether we
        # managed to read one. The gap between these two is the thing that was
        # invisible: a paper can carry a mark column on three pages and still
        # come out of here with no barème and nothing saying so.
        "schemeSuspected": any(scheme_signal(page) >= MARK_COLUMN for page in pages[1:]),
        # An exercise whose statement is itself a marking scheme. Reported
        # rather than quietly stored: a student practising one of these is
        # shown the correction key as the question.
        "schemeInStatement": sum(
            1 for e in exercises if scheme_signal(e["statement"]) >= MARK_COLUMN
        ),
        "exercises": exercises,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--show", default=None)
    # Where the run lands. Defaults to the file the loader reads; comparison
    # runs pass a scratch path, because a --limit run written to corpus/exams.json
    # and then loaded would retire every question from the papers it did not see.
    ap.add_argument("--out", default=None, type=Path)
    ap.add_argument("--no-tables", action="store_true",
                    help="skip the geometric scheme reader (about 3x faster)")
    args = ap.parse_args()
    global NO_TABLES
    NO_TABLES = args.no_tables

    if args.show:
        result = read(EXAMS / args.show)
        print(json.dumps(result, ensure_ascii=False, indent=1)[:4000])
        return

    seen, results = set(), []
    files = sorted(EXAMS.rglob("*.pdf"))
    if args.limit:
        files = files[:args.limit]

    # One paper, sat by two tracks, is two entries.
    #
    # GS and LS sit the SAME Arabic, geography, history and civics exams, and the
    # corpus keeps a copy under each track's folder. Skipping a repeated hash
    # outright read the GS copy and dropped every LS one — 62 of the 65 LS
    # humanities papers are byte-identical to a GS paper — so LS had no past
    # questions at all in six subjects while GS, LH and SE had them. The parser
    # was never the problem for those; they had simply already been read under
    # somebody else's track.
    #
    # The parse is still done once. What is repeated is the entry, with this
    # path and this track, because the exercise belongs to both students and the
    # loader keys questions per subject so neither track's copy collides with
    # the other's.
    parsed: dict = {}
    for pdf in files:
        digest = hashlib.sha256(pdf.read_bytes()).hexdigest()
        if digest in seen:
            first = parsed.get(digest)
            if first and "error" not in first:
                rel = pdf.relative_to(EXAMS)
                results.append({**first, "path": str(rel), "file": pdf.name,
                                "track": rel.parts[0].upper() if rel.parts else first.get("track")})
            continue
        seen.add(digest)
        row = read(pdf)
        if row:
            parsed[digest] = row
            results.append(row)

    good = [r for r in results if "error" not in r]
    out_path = args.out or OUT
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(good, ensure_ascii=False), encoding="utf-8")

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
    print(f"  marks attached to a part       {sum(r['marksFound'] for r in good)}")
    with_passage = [r for r in good if r.get("passage")]
    print(f"  papers carrying a passage      {len(with_passage)}"
          f"   ({sum(len(r['passage']) for r in with_passage) // max(1, len(with_passage))} chars each on average)")


    """
    What was left on the floor, said out loud.

    Every number above counts something that worked. A pipeline that only
    reports its successes will report them just as cheerfully on the day it
    starts dropping half its input, which is what happened here: 859 papers
    came out with no marking scheme and the summary called that a clean run,
    because "no scheme found" and "no scheme present" printed identically.
    They are not the same claim and only one of them was true.

    So the two gaps get their own lines, and they are gaps by construction:
    each counts papers where the evidence says there is something to read and
    we did not read it. A number that will not go to zero — some schemes are
    scanned images with no text layer — but one that must never quietly grow.
    """
    missed = [r for r in good if r["schemeSuspected"] and not r["answersFound"]]
    contaminated = sum(r["schemeInStatement"] for r in good)
    print()
    print("  NOT RECOVERED — evidence of a scheme we failed to read:")
    print(f"    papers carrying a mark column, no answers extracted  {len(missed)}")
    print(f"    statements that still look like a marking scheme     {contaminated}")
    if missed:
        by_subject = Counter()
        for r in missed:
            name = r["file"].lower()
            by_subject[next((t for t in (
                "math", "riyad", "phys", "fizi", "chem", "chim", "kimi", "bio", "svt",
                "ahya", "philo", "falsafe", "geo", "socio", "ejtem", "econ", "tarbe",
                "tarikh", "tarekh", "hist", "eng", "fr", "ar") if t in name), "other")] += 1
        print("    worst: " + ", ".join(f"{t} {n}" for t, n in by_subject.most_common(5)))
    print()
    if TABLE_STATS:
        print()
        print("  the scheme's own table, read geometrically:")
        for reason, count in TABLE_STATS.most_common():
            print(f"    {reason:44} {count}")

    print(f"-> {out_path}")


if __name__ == "__main__":
    sys.exit(main())
