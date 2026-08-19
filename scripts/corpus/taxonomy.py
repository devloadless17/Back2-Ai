# -*- coding: utf-8 -*-
"""Builds the unit/chapter taxonomy from each book's own table of contents.

    python scripts/corpus/taxonomy.py                 # every transcribed book
    python scripts/corpus/taxonomy.py --book math-gs-2-en__56566975
    python scripts/corpus/taxonomy.py --show math-gs-2-en__56566975

Writes corpus/taxonomy/<book>.json and corpus/taxonomy/chapters.csv.

Deliberately regex, not a model. A chapter list is the spine everything else
hangs off — every question and every chunk gets filed under one — so it has to
be reproducible and reviewable, not re-derived slightly differently each run.
Anything the parser cannot read is reported rather than guessed at.

Two page numbers matter and they are not the same:
  printed  the number on the page, as the table of contents gives it
  pdf      the page of the scan, which is what our page-NNN.md files are
The offset between them is measured per book, never assumed.
"""

import argparse
import csv
import json
import re
import unicodedata
from pathlib import Path
from statistics import median

ROOT = Path(__file__).resolve().parent.parent.parent
CORPUS = ROOT / "corpus"
TEXT = CORPUS / "text"
OUT = CORPUS / "taxonomy"
OVERRIDES = Path(__file__).resolve().parent / "toc-overrides"

CONTENTS_HEADING = re.compile(
    r"tables?\s+of\s+contents|tables?\s+des\s+mati|^\s*contents\s*$|sommaire|"
    r"فهرس|محتويات",
    re.I | re.M,
)
# A contents page is really a page full of dot leaders — "Chapter 3 ..... 29".
# That structure survives OCR mangling the heading ("TABLE OF CONTENIS"), the
# heading being plural, and the table sitting at the back of the book, all of
# which happen in this corpus. The heading is only a tie-breaker.
LEADER = re.compile(r"\.{2,}\s*\d{1,3}\b")

# "Chapter 3 : Continuous functions on an interval. ..... 29"
# "- Chapitre 4 Oscillations mécaniques ..... 60"
CHAPTER = re.compile(
    r"(?:chapt?e?r|chapitre)\s*(\d{1,2})\s*[:\-\u2013]?\s*(.{2,140}?)\s*\.{2,}\s*(\d{1,3})",
    re.I | re.S,
)
# "Unité 1 Mécanique"   "Part 2 Chemical Kinetics ..... 26"
UNIT = re.compile(
    r"(?m)^\s*(?:unit[ée]?s?|partie|part)\s*(\d{1,2})\s*[:\-\u2013]?\s*([^\n]{2,120}?)\s*(?:\.{2,}\s*(\d{1,3}))?\s*$",
    re.I,
)
# A contents table drawn as a LaTeX table:
#   \hline 3 & Position measures of a statistical data & 39 \
TABLE_ROW = re.compile(r"\\hline\s*(\d{1,2})\s*&\s*([^&\\]{4,140}?)\s*&\s*(\d{1,3})?\s*\\\\")
# "1. Systèmes linéaires. ..... 11"  and  "1 Measures of central tendency ..... 11"
# — numbered, with no word for "chapter", dot after the number optional.
# No DOTALL: the title must stay on its own line. With it, the title ran
# through the blank line and swallowed the next Part heading, turning
# chemistry's sixteen chapters into six mangled ones. The leader is allowed to
# sit on the following line, which is where OCR usually puts it.
NUMBERED = re.compile(
    r"(?m)^\s*(\d{1,2})\s*[.)]?\s+([^\n]{3,140}?)\s*(?:\n\s*)?\.{2,}\s*(\d{1,3})\s*$",
)
# Chemistry style: chapters listed under a Part with no page of their own.
BARE_CHAPTER = re.compile(r"(?m)^\s*\*?\s*(\d{1,2})\s+([^\n\d][^\n]{3,110})$")

# A contents page that is nothing but an image: Mathpix cropped the whole table
# as a figure, so there is no text to read. Needs a different route entirely,
# and saying so is more useful than reporting "no chapters found".
IMAGE_ONLY = re.compile(r"^\s*(?:\\section\*?\{[^}]*\}\s*)?(?:!\[\]\([^)]*\)\s*)+$")

NOISE = re.compile(r"^(pages?|introduction|sommaire|table)", re.I)

# Arabic textbooks are organised as وحدة (unit) -> درس (lesson), not chapters,
# and their contents pages are laid out as two columns: a column of page
# numbers beside a column of titles. OCR emits those as separate blocks, so
# pairing them by position is guesswork — geographie has 27 titles against 24
# numbers. The titles are taken from here and the pages found by locating each
# lesson in the book, which is reliable and needs no pairing.
AR_UNIT = re.compile(r"^\s*(?:الوحدة|المحور|القسم)\s+([^\n]{2,90})\s*$", re.M)
AR_LESSON = re.compile(r"^\s*الدرس\s+[^\n:：]{2,30}\s*[:：]\s*([^\n]{2,90})\s*$", re.M)
AR_ORDINAL = re.compile(r"^(الأولى?|الثانية?|الثالثة?|الرابعة?|الخامسة?|السادسة?|"
                        r"السابعة?|الثامنة?|التاسعة?|العاشرة?)\s*[:：]?\s*")

# Civics and the like label chapters الفصل الأول, not الدرس. Their contents page
# is an RTL two-column table, and OCR reading it left-to-right puts the label
# after its own title as often as before it — sometimes alone on a line with the
# title underneath. All three appear on one page of the civics book, so the
# label is matched anywhere on the line and the title is whatever is left.
AR_ORD = (r"(?:الأولى?|الثانية?|الثالثة?|الرابعة?|الخامسة?|السادسة?|السابعة?|"
          r"الثامنة?|التاسعة?|العاشرة?)")
AR_CHAP_LABEL = re.compile(rf"الفصل\s*{AR_ORD}\s*[:：]?")
AR_UNIT_LABEL = re.compile(rf"(?:المحور|الوحدة|القسم)\s*{AR_ORD}\s*[:：]?")
# "(١٥ حصة)" — the teaching-hours note printed beside every entry. OCR drops a
# stray bracket into the middle of it ("(٥) حصص)"), so the brackets are all
# optional and the digits may be Arabic-Indic in either of their two blocks.
AR_SESSIONS = re.compile(r"[(（]?\s*[\d٠-٩۰-۹]{0,3}\s*[)）]?\s*"
                         r"(?:حصص|حصة|حصتان|حصتين)\s*[)）]?")

# The English readers stack their contents: "Chapter 1" on one line, the title
# on the next, page numbers detached in a column at the end of the block. No dot
# leaders anywhere, so every leader-based pattern sees nothing at all.
EN_ORD = (r"\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve")
EN_STACK_CHAP = re.compile(rf"^\s*chapt?e?r\s*(?:{EN_ORD})\s*[:.\-–]?\s*$", re.I)
# The SE readers divide themselves into UNIT ONE .. UNIT NINE and never mention
# a chapter; the workbook prints the unit title on the same line after a colon,
# the textbook puts it underneath. Both forms are matched here.
EN_STACK_UNIT = re.compile(rf"^\s*(?:unit|part)\s*(?:{EN_ORD})\s*(?:[:.\-–]\s*(.{{3,80}}))?\s*$", re.I)
EN_STACK_SKIP = re.compile(rf"^\s*(?:\d{{1,3}}|part\s+(?:[a-z]|{EN_ORD})\b.*|table of contents)\s*$", re.I)


# An RTL contents table read left-to-right: the page number comes out in front
# of its own title, the dot leader trails behind it, and every entry on the page
# ends up concatenated onto one line —
#
#   ١٢ مدخل إلى المحور ......... ١٦ أبو العلاء المعرّي: غير مجد .........
#
# Every leader-based pattern here expects "title ..... number" and anchors on the
# end of a line, so all of them see nothing at all.
#
# The title must contain an Arabic letter. Without that guard this also matches
# a Latin contents line — "16 Chemical Kinetics ....." — and because this branch
# is tried before the Latin ones it quietly took them over: chemistry dropped
# from sixteen chapters to eight, and maths from twenty-three placed to two.
AR_LEADER_ENTRY = re.compile(
    r"(\d{1,3})\s+((?=[^\n.…]{0,90}?[؀-ۿ])[^\n.…]{3,90}?)\s*[.…]{3,}"
)


def parse_arabic_leader(text: str) -> list:
    """Contents entries where the page number is printed before the title.

    The numbers are read but deliberately discarded. In a table this mangled
    there is no way to tell a page number from a lesson's own ordinal — the
    grammar book prints "١- التفعيلة ..... ١١٥", where the leading digit is the
    lesson number and the trailing one is the page — and a wrong printed page
    poisons the offset vote for the whole book. Titles are located in the text
    instead, which needs no page number to be right.
    """
    entries = []
    index = 0
    for m in sorted([*AR_UNIT.finditer(text), *AR_LEADER_ENTRY.finditer(text)],
                    key=lambda m: m.start()):
        if m.re is AR_UNIT:
            title = AR_ORDINAL.sub("", re.sub(r"\s+", " ", m.group(1)).strip(" .:-：")).strip()
            if title:
                entries.append({"kind": "unit", "index": 0, "title": title, "printed": None})
            continue
        title = re.sub(r"\s+", " ", m.group(2)).strip(" .:-،؛…")
        title = re.sub(r"^\d{1,2}\s*[-–.)]\s*", "", title).strip()
        if len(title) < 3 or NOISE.match(title):
            continue
        index += 1
        entries.append({"kind": "chapter", "index": index, "title": title, "printed": None})
    return entries


def parse_arabic_labelled(text: str) -> list:
    """Contents entries labelled الفصل / المحور, in the order they are printed."""
    entries, index, awaiting = [], 0, None

    def tidy(s: str) -> str:
        s = AR_SESSIONS.sub(" ", s)
        s = re.sub(r"\s+", " ", s).strip(" .:-：()）（")
        return AR_ORDINAL.sub("", s).strip()

    for line in text.split("\n"):
        line = line.strip()
        if not line:
            continue
        unit, chap = AR_UNIT_LABEL.search(line), AR_CHAP_LABEL.search(line)
        if unit:
            title = tidy(AR_UNIT_LABEL.sub(" ", line))
            awaiting = None if title else "unit"
            if title:
                entries.append({"kind": "unit", "index": 0, "title": title, "printed": None})
        elif chap:
            title = tidy(AR_CHAP_LABEL.sub(" ", line))
            if title:
                index += 1
                entries.append({"kind": "chapter", "index": index, "title": title,
                                "printed": None})
                awaiting = None
            else:
                awaiting = "chapter"      # the title is on the line below
        elif awaiting:
            title = tidy(line)
            if title:
                if awaiting == "chapter":
                    index += 1
                entries.append({"kind": awaiting, "index": index if awaiting == "chapter" else 0,
                                "title": title, "printed": None})
            awaiting = None
    return entries


def parse_stacked(text: str) -> list:
    """Contents entries whose title sits on the line after "Chapter N"."""
    lines = [l.strip() for l in text.split("\n")]
    entries, index = [], 0

    def title_after(i: int) -> str:
        for line in lines[i + 1:i + 4]:
            if not line or EN_STACK_SKIP.match(line):
                continue
            if EN_STACK_CHAP.match(line) or EN_STACK_UNIT.match(line):
                return ""
            return re.sub(r"\s+", " ", line).strip(" .:-")
        return ""

    seen = set()
    for i, line in enumerate(lines):
        unit = EN_STACK_UNIT.match(line)
        kind = "unit" if unit else "chapter" if EN_STACK_CHAP.match(line) else None
        if not kind:
            continue
        # "Unit One: Historical Highlights" — the title is on the line itself.
        inline = unit.group(1) if unit and unit.group(1) else ""
        title = re.sub(r"\s+", " ", inline).strip(" .:-") if inline else title_after(i)
        # The same title twice means the span ran past the contents table into
        # the book, where each chapter opens with its own heading.
        if not title or normalise(title) in seen:
            continue
        seen.add(normalise(title))
        if kind == "chapter":
            index += 1
        entries.append({"kind": kind, "index": index if kind == "chapter" else 0,
                        "title": title, "printed": None})

    # A book divided into units and nothing else — the SE readers run UNIT ONE
    # to UNIT NINE and never say "chapter". The unit is the teaching division
    # there, so it is what a student's question has to retrieve against.
    units = [e for e in entries if e["kind"] == "unit"]
    if len([e for e in entries if e["kind"] == "chapter"]) < 3 and len(units) >= 3:
        return [{**u, "kind": "chapter", "index": i + 1} for i, u in enumerate(units)]
    return entries


def clean(text: str) -> str:
    text = re.sub(r"\\(?:sub)?section\*?\{([^}]*)\}", r"\1", text)
    text = re.sub(r"\\(?:item|hline|begin|end)\b\{?[^}\n]*\}?", " ", text)
    text = text.replace("[-]", " ")
    return re.sub(r"[ \t]+", " ", text)


def normalise_indexed(title: str) -> tuple:
    """Normalise, and remember where each surviving character came from.

    The plain normaliser folds runs of punctuation and spacing into one space,
    so a position in its output says nothing about a position in the book's own
    text. Two chapters that begin on the same page can only be told apart by
    where on the page they begin, which needs that mapping back.

    Built one source character at a time rather than by normalising the whole
    string, because NFD decomposition changes lengths and would break the
    correspondence it exists to preserve.
    """
    out: list = []
    idx: list = []
    at_space = True
    for i, ch in enumerate(title):
        decomposed = unicodedata.normalize("NFD", ch.lower())
        decomposed = "".join(c for c in decomposed if unicodedata.category(c) != "Mn")
        for c in decomposed:
            if re.match(r"[a-z0-9؀-ۿ]", c):
                out.append(c)
                idx.append(i)
                at_space = False
            elif not at_space:
                out.append(" ")
                idx.append(i)
                at_space = True
    while out and out[-1] == " ":
        out.pop()
        idx.pop()
    return "".join(out), idx


def normalise(title: str) -> str:
    """For comparing a TOC entry against a heading inside the book.

    Arabic is kept: stripping to [a-z0-9] erased Arabic titles completely, so
    no Arabic chapter could ever be located in its own book. Combining marks
    are dropped, which also takes tashkeel off both sides of the comparison —
    a title vocalised in the contents but not in the text still matches.
    """
    return normalise_indexed(title)[0]


def find_contents_pages(pages: dict) -> list:
    """The page(s) holding the table of contents, found by structure.

    Scored on dot-leader density rather than on the heading, because in this
    corpus the heading is variously plural, OCR-mangled, absent, or the whole
    table sits at the back of the book (math-se-en has it on page 279 of 281).
    A contents table also spans more than one page in the longer books, so
    neighbouring pages that are still dense with leaders come along too.
    """
    scores = {n: len(LEADER.findall(t)) for n, t in pages.items()}
    best = max(scores, key=lambda n: (scores[n], -n)) if scores else None

    def stacked_hits(text: str) -> int:
        return sum(1 for l in text.split("\n")
                   if EN_STACK_CHAP.match(l.strip()) or EN_STACK_UNIT.match(l.strip()))

    def contents_like(text: str) -> bool:
        """A list of short lines, which is what a contents page is.

        The body of these books opens each chapter with "Chapter 1" over its
        title, and runs "UNIT 1" as a header on every page, so a stacked hit
        alone walks straight into the book and invents duplicate chapters. What
        separates the two is prose: a contents page has none. Measured as full
        lines rather than as an average, because one stray long line is common
        and a page of paragraphs is unmistakable.
        """
        lines = [l.strip() for l in text.split("\n") if l.strip()]
        if len(lines) < 6 or stacked_hits(text) < 2:
            return False
        return sum(1 for l in lines if len(l) >= 90) <= 1

    def span_from(first: int) -> list:
        """The contents pages, which need not sit next to one another.

        In the SE readers the table is split across pages 8, 9 and 11, with the
        national textbook foreword in between; in themes2 it is pages 3 and 9.
        A contiguous span misses most of the book either way, so every
        contents-shaped page early on is taken instead — the window keeps the
        body out, and duplicate titles are dropped when they are parsed.
        """
        limit = max(first + 8, min(40, len(pages)))
        found = [n for n in sorted(pages) if n >= first and n <= limit and contents_like(pages[n])]
        return found or [first]

    # An explicit list of الفصل entries beats leader density, and has to be
    # checked before it rather than after. The economics book prints its whole
    # syllabus outline over two unheaded pages with no leaders at all, while a
    # table deeper in the book carries four dot leaders and wins on score — so
    # the parser was handed a page of figures and called the book unreadable.
    for n in sorted(pages)[:30]:
        if len(AR_CHAP_LABEL.findall(pages[n])) >= 4:
            return span_from(n)


    if best is None or scores[best] < 4:
        # No leaders anywhere: fall back to a page that calls itself contents,
        # which is how an image-only table gets detected and reported.
        for n in sorted(pages):
            if CONTENTS_HEADING.search(pages[n]):
                return span_from(n)

        # Arabic books whose contents page says neither فهرس nor محتويات — the
        # civics book heads it الصفحة with columns of محور and درس titles. Find
        # it by structure instead: an early page listing several lessons.
        for n in sorted(pages)[:30]:
            if len(AR_LESSON.findall(pages[n])) >= 4:
                return [n]

        # Nothing announced itself as contents: take the first page early in the
        # book that is shaped like one.
        for n in sorted(pages)[:30]:
            if contents_like(pages[n]):
                return span_from(n)
        return []

    found = [best]
    for n in range(best + 1, best + 4):          # continuation pages
        if scores.get(n, 0) >= 3:
            found.append(n)
        else:
            break
    return found


def parse_contents(raw: str) -> list:
    """Reads the table of contents into an ordered list of units and chapters."""
    entries = []

    # A contents table drawn as a LaTeX table is unambiguous, so it wins
    # outright — running the prose patterns over it as well would double-count
    # every row. Checked on the raw text, before clean() strips the markup.
    rows = TABLE_ROW.findall(raw)
    if len(rows) >= 3:
        for pos, (index, title, page) in enumerate(rows):
            title = re.sub(r"\s+", " ", title).strip(" .:-")
            if title and not NOISE.match(title):
                entries.append({"pos": pos, "kind": "chapter", "index": int(index),
                                "title": title, "printed": int(page) if page else None})
        return [{k: v for k, v in e.items() if k != "pos"} for e in entries]

    text = clean(raw)

    # Arabic: unit / lesson, taken in the order they appear in the contents.
    ar_lessons = list(AR_LESSON.finditer(text))
    if ar_lessons:
        index = 0
        for m in sorted([*AR_UNIT.finditer(text), *ar_lessons], key=lambda m: m.start()):
            title = re.sub(r"\s+", " ", m.group(1)).strip(" .:-：")
            title = AR_ORDINAL.sub("", title).strip()
            if not title:
                continue
            if m.re is AR_UNIT:
                entries.append({"pos": m.start(), "kind": "unit", "index": 0, "title": title,
                                "printed": None})
            else:
                index += 1
                entries.append({"pos": m.start(), "kind": "chapter", "index": index,
                                "title": title, "printed": None})
        entries.sort(key=lambda e: e["pos"])
        for e in entries:
            e.pop("pos")
        return entries

    # An RTL leader table, where the page number precedes its title. Checked
    # before the Latin leader patterns because those anchor on the end of a
    # line, which this layout never provides.
    if len(AR_LEADER_ENTRY.findall(text)) >= 4:
        leader = parse_arabic_leader(text)
        if sum(1 for e in leader if e["kind"] == "chapter") >= 4:
            return leader

    # Arabic labelled الفصل / المحور. Checked before the Latin patterns, which
    # would otherwise find nothing and report the page as unparseable.
    if len(AR_CHAP_LABEL.findall(text)) >= 3:
        labelled = parse_arabic_labelled(text)
        if sum(1 for e in labelled if e["kind"] == "chapter") >= 3:
            return labelled

    # A stacked contents page, tried before the numbered patterns rather than
    # after them: its continuation pages print the page number at the start of
    # the line ("30 Part E Expanding Your Point of View"), which BARE_CHAPTER
    # reads as chapter 30 titled "Part E ...". Only when there are no leaders,
    # so books with a real leader table keep using it.
    if len(LEADER.findall(text)) < 4:
        stacked = parse_stacked(text)
        if sum(1 for e in stacked if e["kind"] == "chapter") >= 3:
            return stacked

    for m in UNIT.finditer(text):
        title = re.sub(r"\s+", " ", m.group(2)).strip(" .:-")
        if title and not NOISE.match(title):
            entries.append({"pos": m.start(), "kind": "unit", "index": int(m.group(1)),
                            "title": title, "printed": int(m.group(3)) if m.group(3) else None})

    for m in CHAPTER.finditer(text):
        title = re.sub(r"\s+", " ", m.group(2)).strip(" .:-")
        if title and not NOISE.match(title):
            entries.append({"pos": m.start(), "kind": "chapter", "index": int(m.group(1)),
                            "title": title, "printed": int(m.group(3))})

    # Books that number chapters without saying "chapter".
    if not any(e["kind"] == "chapter" for e in entries):
        for m in NUMBERED.finditer(text):
            title = re.sub(r"\s+", " ", m.group(2)).strip(" .:-")
            if title and not NOISE.match(title):
                entries.append({"pos": m.start(), "kind": "chapter", "index": int(m.group(1)),
                                "title": title, "printed": int(m.group(3))})

    # Chemistry lists its parts with page numbers and its chapters without, so
    # the chapters are bare numbered lines. Allowed to run alongside units, but
    # never alongside chapters that already carry their own page.
    if not any(e["kind"] == "chapter" for e in entries):
        for m in BARE_CHAPTER.finditer(text):
            title = re.sub(r"\s+", " ", m.group(2)).strip(" .:-")
            if title and not NOISE.match(title) and len(title) > 4:
                entries.append({"pos": m.start(), "kind": "chapter", "index": int(m.group(1)),
                                "title": title, "printed": None})

    # Last resort: a stacked contents page, where nothing at all carries a
    # leader and the title is simply the line below "Chapter N".
    if not any(e["kind"] == "chapter" for e in entries):
        stacked = parse_stacked(text)
        if sum(1 for e in stacked if e["kind"] == "chapter") >= 2:
            return stacked

    entries.sort(key=lambda e: e["pos"])
    for e in entries:
        e.pop("pos")
    return entries


# Shortest run of text that can be a section rather than a line in a list.
MIN_SECTION = 400


def occurrences(title: str, pages: dict, floor: tuple = (0, -1), skip: frozenset = frozenset()) -> list:
    """Where this chapter title appears, as (page, offset within that page).

    The offset is what allows two chapters to start on one page. Books set
    short sections several to a page — the Tagore unit prints his views on the
    Creator, on mysticism, on society and on politics across five pages — and a
    page-level cursor can only ever place the first of them. The rest were left
    unplaced, which read downstream as "this chapter has no material".

    A literature anthology lists its contents as "author: work" — "أبو العلاء
    المعرّي: غير مجد" — but prints the two apart inside the book, the author above
    the poem, so the composite string appears only in the contents table itself.
    Where a title carries a colon, the work's own name is tried as well.

    `floor` is applied here rather than by the caller, and that is the whole
    point: filtering afterwards meant the composite title "found" the contents
    page, the fallback was never reached, and the entry went unplaced. A
    candidate only counts as found if it lands somewhere usable.

    It is a (page, offset) pair and the comparison is strict, so a chapter must
    begin after the one before it — the ordering the contents page already
    fixes. That is the guard that makes tolerant matching safe: a title located
    somewhere that breaks the book's own sequence is a wrong match, and is
    rejected without any judgement about how similar the strings look.
    """
    candidates = [title]
    if ":" in title or "：" in title:
        head, _, tail = title.replace("：", ":").partition(":")
        candidates += [tail.strip(), head.strip()]

    for candidate in candidates:
        target = normalise(candidate)
        # Short titles were once excluded outright, because a four-letter string
        # matches half a book. Two guards now stand between a match and a
        # placement — it must fall after the previous chapter, and it must have
        # a section's worth of text after it — so the length bar only has to
        # exclude the genuinely meaningless. "الحال" is four letters and a real
        # chapter of the grammar book.
        if len(target) < 4:
            continue
        found = []
        for n in sorted(pages):
            # Every title appears on the contents page, in the right order, so
            # the contents page satisfies the ordering guard perfectly and would
            # collect the entire book. It is excluded outright rather than
            # ranked against.
            if n < floor[0] or n in skip:
                continue
            text, idx = normalise_indexed(pages[n])
            at = text.find(target)
            while at != -1:
                where = (n, idx[at])
                if where > floor:
                    found.append(where)
                    break
                # Same page, but before the floor: the previous chapter's own
                # heading, or a mention inside it. Keep looking further down.
                at = text.find(target, at + 1)
        # Every occurrence, not just the first: `measure_offset` needs them all
        # to vote, and placement takes the earliest.
        if found:
            return found
    return []


def measure_offset(chapters: list, pages: dict) -> tuple:
    """The single offset between printed page numbers and scan page numbers.

    Taking the first occurrence of each title is not good enough: a chapter
    name also appears in the contents table, in cross-references and in
    end-of-book answers, and one bad match drags a median far enough to put
    chapter 1 on page 109 of a 281-page book.

    Instead every occurrence votes for an offset, and the offset with the most
    votes wins. A real offset is shared by every chapter in the book, so the
    correct value is the one that keeps agreeing; spurious matches scatter.
    """
    last_page = max(pages)
    votes = {}
    hits = {}

    for c in chapters:
        if not c.get("printed"):
            continue
        found = [n for n, _ in occurrences(c["title"], pages)]
        hits[c["index"]] = found
        for n in found:
            offset = n - c["printed"]
            if 0 <= c["printed"] + offset <= last_page and -5 <= offset <= 60:
                votes[offset] = votes.get(offset, 0) + 1

    if not votes:
        return None, hits
    best = max(votes, key=lambda o: (votes[o], -abs(o)))
    return best, hits


def build(book: str) -> dict | None:
    d = TEXT / book
    pages = {}
    for f in d.glob("page-*.md"):
        pages[int(re.search(r"(\d+)", f.name).group(1))] = f.read_text(encoding="utf-8")
    if not pages:
        return None

    # A hand-entered or separately transcribed contents list replaces the page.
    #
    # Kept under scripts/, not under corpus/: corpus/ is gitignored because it
    # holds gigabytes of derived pages and figures, and these files are the
    # opposite — small, entered by hand from the printed book, and impossible
    # to regenerate. The in-corpus location is still read as a fallback.
    override = OVERRIDES / f"{book}.md"
    if not override.exists():
        override = d / "toc-override.md"
    if override.exists():
        entries = parse_contents(override.read_text(encoding="utf-8"))
        chapters = [e for e in entries if e["kind"] == "chapter"]
        if chapters:
            contents_pages = [0]
            pages_for_search = pages
            # The override supplies the entries, but the book still HAS a
            # contents page, and every title on it appears there in the right
            # order. Left in the search it would satisfy the ordering guard
            # perfectly and swallow the whole book onto one page — which is
            # exactly what it did. Found here purely so it can be excluded.
            skip_pages = frozenset(find_contents_pages(pages))
        else:
            return {"book": book, "error": "toc-override.md parsed to no chapters", "chapters": []}
    else:
        contents_pages = find_contents_pages(pages)
        skip_pages = frozenset(contents_pages)

    if not contents_pages:
        return {"book": book, "error": "no table of contents found", "chapters": []}

    contents_page = contents_pages[0]

    if contents_page != 0:            # 0 means the override supplied the entries
        if all(IMAGE_ONLY.match(pages[n].strip()) for n in contents_pages):
            return {"book": book, "error": "contents page is an image, not text",
                    "contentsPage": contents_page, "chapters": []}

        entries = parse_contents("\n".join(pages[n] for n in contents_pages))
        chapters = [e for e in entries if e["kind"] == "chapter"]
        if not chapters:
            return {"book": book, "error": "contents page found but no chapters parsed",
                    "contentsPage": contents_page, "chapters": []}

    # Attach each chapter to the unit that precedes it, if the book has units.
    #
    # Unit numbers are printed inside coloured shapes, so OCR either loses them
    # or leaves a stray numeral glued to the label ("1 Aspects de la Lumière",
    # "V Atome, Noyau et Univers" for units III and IV). The label is what goes
    # in the database, so the leading numeral is stripped and the units are
    # renumbered by the order they appear in — which is what they mean anyway.
    unit = None
    unit_no = 0
    for e in entries:
        if e["kind"] == "unit":
            unit_no += 1
            e["index"] = unit_no
            e["title"] = re.sub(r"^[IVXLivxl\d]+[\s.:\-–]+", "", e["title"]).strip()
            unit = e["title"]
        else:
            e["unit"] = unit

    # Some books (chemistry) print a page against each Part and none against
    # the chapters inside it. The first chapter of a part starts where the part
    # starts, which gives the offset something to measure against.
    unit_page = {u["title"]: u.get("printed") for u in entries if u["kind"] == "unit"}
    first_of_unit = set()
    seen_units = set()
    for c in chapters:
        u = c.get("unit")
        if u and u not in seen_units:
            seen_units.add(u)
            first_of_unit.add(c["index"])
            if not c.get("printed") and unit_page.get(u):
                c["printed"] = unit_page[u]
                c["fromUnit"] = True

    offset, hits = measure_offset(chapters, pages)
    last_page = max(pages)

    # Chapters run in order, so each starts after the one before it. Without
    # that, a title mentioned in an earlier summary drags its chapter backwards
    # and the page spans cross over each other.
    #
    # A (page, offset) pair rather than a page. Requiring the next chapter to
    # start on a LATER page meant a book that prints two sections on one page
    # could only ever place the first, and the second was reported as having no
    # material at all.
    cursor = (0, -1)

    for c in chapters:
        if not c.get("printed") or offset is None:
            # A chapter with no page of its own: find its title in the book,
            # after wherever its part begins.
            # Never match the contents page itself — every title appears there,
            # which would put every chapter on the same page.
            first = contents_page + 1 if contents_page < len(pages) / 2 else 1
            floor = max((first, -1), cursor)
            u = c.get("unit")
            if u and unit_page.get(u) and offset is not None:
                floor = max(floor, (unit_page[u] + offset, -1))
            found = occurrences(c["title"], pages, floor, skip=skip_pages)
            if found:
                c["pdfPage"], c["pdfOffset"] = found[0]
                c["located"] = True
                # The next chapter must begin at least a section's worth of text
                # later. Units open by listing their own contents — "أوَّلاً:
                # الهند في عصر طاغور / ثانيًا: حياة طاغور" — and those entries sit
                # a couple of dozen characters apart, so without this the first
                # three chapters of a unit are placed on its index instead of on
                # their sections. Nothing in this corpus teaches a chapter in
                # under four hundred characters.
                cursor = (found[0][0], found[0][1] + MIN_SECTION)
            else:
                c["pdfPage"] = None
            continue
        expected = c["printed"] + offset
        # Prefer a real match at the expected place; a page either side covers
        # a chapter that opens on the back of the previous one.
        near = [n for n in hits.get(c["index"], []) if abs(n - expected) <= 1]
        if near:
            c["pdfPage"] = near[0]
        elif 1 <= expected <= last_page:
            c["pdfPage"] = expected
            c["inferred"] = True
        else:
            c["pdfPage"] = None

    # A chapter runs until the next one starts.
    #
    # Where the next chapter was located by position, that boundary is a point
    # inside a page rather than a page break, and both numbers are recorded so
    # the chunker can cut there. Ending at "the page before the next chapter"
    # is right only when the next chapter opens its own page; used everywhere it
    # gave one chapter the whole rest of the book whenever the chapters after it
    # went unplaced, and gave two chapters the same page whenever they shared
    # one.
    known = [c for c in chapters if c.get("pdfPage")]
    for i, c in enumerate(known):
        nxt = known[i + 1] if i + 1 < len(known) else None
        if nxt is None:
            c["pdfPageEnd"] = max(pages)
        elif nxt.get("pdfOffset") is not None:
            c["pdfPageEnd"] = nxt["pdfPage"]
            c["pdfEndOffset"] = nxt["pdfOffset"]
        else:
            c["pdfPageEnd"] = max(c["pdfPage"], nxt["pdfPage"] - 1)

    return {
        "book": book,
        "contentsPage": contents_page,
        "pageOffset": offset,
        "unitCount": len({c.get("unit") for c in chapters if c.get("unit")}),
        "chapters": [
            {k: v for k, v in c.items() if k != "kind"} for c in chapters
        ],
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--book")
    ap.add_argument("--show", help="print one book's chapters and stop")
    args = ap.parse_args()

    if args.show:
        result = build(args.show)
        print(json.dumps(result, ensure_ascii=False, indent=2)[:6000])
        return

    books = [args.book] if args.book else [d.name for d in sorted(TEXT.iterdir()) if d.is_dir()]
    OUT.mkdir(parents=True, exist_ok=True)

    rows, problems = [], []
    print(f"{'book':<34}{'chapters':>9}{'units':>7}{'offset':>8}  note")
    print("-" * 78)

    for book in books:
        result = build(book)
        if result is None:
            continue
        (OUT / f"{book}.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

        note = result.get("error", "")
        if not note:
            missing = sum(1 for c in result["chapters"] if not c.get("pdfPage"))
            inferred = sum(1 for c in result["chapters"] if c.get("inferred"))
            bits = []
            if inferred:
                bits.append(f"{inferred} page(s) inferred")
            if missing:
                bits.append(f"{missing} unplaced")
            note = ", ".join(bits)
        else:
            problems.append(book)

        print(f"{book:<34}{len(result['chapters']):>9}{result.get('unitCount', 0):>7}"
              f"{str(result.get('pageOffset', '-')):>8}  {note}")

        for c in result["chapters"]:
            rows.append({
                "book": book, "unit": c.get("unit") or "", "index": c["index"],
                "chapter": c["title"], "printedPage": c.get("printed") or "",
                "pdfPage": c.get("pdfPage") or "", "pdfPageEnd": c.get("pdfPageEnd") or "",
                "inferred": "yes" if c.get("inferred") else "",
            })

    csv_path = OUT / "chapters.csv"
    with csv_path.open("w", newline="", encoding="utf-8-sig") as fh:
        w = csv.DictWriter(fh, fieldnames=["book", "unit", "index", "chapter",
                                           "printedPage", "pdfPage", "pdfPageEnd", "inferred"])
        w.writeheader()
        w.writerows(rows)

    print("-" * 78)
    print(f"{len(rows)} chapters across {len(books)} book(s)")
    print(f"review: {csv_path}")
    if problems:
        print(f"\nneeds a human: {', '.join(problems)}")


if __name__ == "__main__":
    main()
