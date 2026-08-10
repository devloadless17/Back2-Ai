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
AR_UNIT = re.compile(r"^\s*(?:الوحدة|المحور)\s+([^\n]{2,90})\s*$", re.M)
AR_LESSON = re.compile(r"^\s*الدرس\s+[^\n:：]{2,30}\s*[:：]\s*([^\n]{2,90})\s*$", re.M)
AR_ORDINAL = re.compile(r"^(الأولى?|الثانية?|الثالثة?|الرابعة?|الخامسة?|السادسة?|"
                        r"السابعة?|الثامنة?|التاسعة?|العاشرة?)\s*[:：]?\s*")


def clean(text: str) -> str:
    text = re.sub(r"\\(?:sub)?section\*?\{([^}]*)\}", r"\1", text)
    text = re.sub(r"\\(?:item|hline|begin|end)\b\{?[^}\n]*\}?", " ", text)
    text = text.replace("[-]", " ")
    return re.sub(r"[ \t]+", " ", text)


def normalise(title: str) -> str:
    """For comparing a TOC entry against a heading inside the book.

    Arabic is kept: stripping to [a-z0-9] erased Arabic titles completely, so
    no Arabic chapter could ever be located in its own book. Combining marks
    are dropped, which also takes tashkeel off both sides of the comparison —
    a title vocalised in the contents but not in the text still matches.
    """
    t = unicodedata.normalize("NFD", title.lower())
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9؀-ۿ]+", " ", t).strip()


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

    if best is None or scores[best] < 4:
        # No leaders anywhere: fall back to a page that calls itself contents,
        # which is how an image-only table gets detected and reported.
        for n in sorted(pages):
            if CONTENTS_HEADING.search(pages[n]):
                return [n]

        # Arabic books whose contents page says neither فهرس nor محتويات — the
        # civics book heads it الصفحة with columns of محور and درس titles. Find
        # it by structure instead: an early page listing several lessons.
        for n in sorted(pages)[:30]:
            if len(AR_LESSON.findall(pages[n])) >= 4:
                return [n]
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

    entries.sort(key=lambda e: e["pos"])
    for e in entries:
        e.pop("pos")
    return entries


def occurrences(title: str, pages: dict) -> list:
    """Every page whose text contains this chapter title."""
    target = normalise(title)
    if len(target) < 6:
        return []
    return [n for n in sorted(pages) if target in normalise(pages[n])]


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
        found = occurrences(c["title"], pages)
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
        else:
            return {"book": book, "error": "toc-override.md parsed to no chapters", "chapters": []}
    else:
        contents_pages = find_contents_pages(pages)

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

    # Chapters run in order, so each starts at or after the one before it.
    # Without that, a title mentioned in an earlier summary drags its chapter
    # backwards and the page spans cross over each other.
    cursor = 0

    for c in chapters:
        if not c.get("printed") or offset is None:
            # A chapter with no page of its own: find its title in the book,
            # after wherever its part begins.
            # Never match the contents page itself — every title appears there,
            # which would put every chapter on the same page.
            floor = contents_page + 1 if contents_page < len(pages) / 2 else 1
            floor = max(floor, cursor + 1)
            u = c.get("unit")
            if u and unit_page.get(u) and offset is not None:
                floor = max(floor, unit_page[u] + offset)
            found = [n for n in occurrences(c["title"], pages) if n >= floor]
            c["pdfPage"] = found[0] if found else None
            if c["pdfPage"]:
                c["located"] = True
                cursor = c["pdfPage"]
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

    known = [c for c in chapters if c.get("pdfPage")]
    for i, c in enumerate(known):
        c["pdfPageEnd"] = (known[i + 1]["pdfPage"] - 1) if i + 1 < len(known) else max(pages)

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
