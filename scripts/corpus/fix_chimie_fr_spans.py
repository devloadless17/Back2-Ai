# -*- coding: utf-8 -*-
"""Corrects the organic-chemistry spans in both chemistry books.

    python scripts/corpus/fix_chimie_fr_spans.py

Run AFTER `taxonomy.py`, which produces the other twelve chapters correctly.
This patches the file it wrote rather than replacing it, so a later improvement
to the parser is kept and only the four spans below are overridden.

THE PROBLEM. "Acides carboxyliques et dérivés" and "Amines et acides
alpha-aminés" were unplaced — no pages, no passages, in both GS and LS — and
"Aldéhydes et cétones" ran 247-304 and held all three chapters' material. The
chapter locator could not find either title because the book's own headings are
OCR-mangled past recognition:

    page 251   \\section*{ACIDES}  \\section*{CARROYVINGS}      = ACIDES CARBOXYLIQUES
    page 272   \\section*{ET}      \\section*{ACDES S.AMINES}   = AMINES ET ACIDES α-AMINÉS

No amount of matching on the title recovers those, because the words are not
there any more. What IS reliable is that each chapter opens on a page whose
first line is a heading and whose body is that chapter's subject, and those pages
were read by hand: 207 ALCOOLS, 232 ALDEHYDES ET CETONES, 251, 272, 305 Polymères.

WHY THIS MATTERS BEYOND FOUR SPANS. These are the alcohol -> aldehyde ->
carboxylic acid chapters the notes describe as one continuous exam topic. A
student revising carboxylic acids had a chapter with nothing in it, and the
questions filed there could be answered only out of the aldehyde chapter that had
swallowed the material.

THE ENGLISH EDITION CONFIRMS THE FRENCH SPANS AND SHARES THE DEFECT. The two
books are parallel printings — 393 pages against 394 — and their independently
parsed spans agree with the ones read by hand here:

    Alcohols   206-233   vs  Alcools    207-231
    Aldehydes  233-251   vs  Aldéhydes  232-250     confirms the 232 boundary
    Carboxylic 251-...   vs  Acides     251-...     confirms the 251 boundary

"Amines and α-amino acids" is unplaced in the English book too, with
"Carboxylic acids and their derivatives" running 251-307 and holding it. Its
chapter opens on page 273 — `\section*{AMINES AND} \section*{12}` — one page
after the French, which is exactly the two books' difference in length. Both are
corrected below.
"""

import io
import json
import pathlib
import sys

sys.stdout.reconfigure(encoding="utf-8")

ROOT = pathlib.Path(__file__).resolve().parents[2]

# book -> {title: (first page of the scan, last page)}, read off the openings.
BOOKS = {
    "chimie-fr__0ddf683b": {
        "Alcools": (207, 231),
        "Aldéhydes et cétones": (232, 250),
        "Acides carboxyliques et dérivés": (251, 271),
        "Amines et acides alpha-aminés": (272, 304),
    },
    "chemistry-en__852933a0": {
        "Carboxylic acids and their derivatives": (251, 272),
        "Amines and α-amino acids": (273, 307),
    },
}


def patch(book: str, spans: dict) -> int:
    path = ROOT / "corpus" / "taxonomy" / f"{book}.json"
    if not path.exists():
        print("  no taxonomy for %s — run taxonomy.py first" % book)
        return 0
    doc = json.loads(io.open(path, encoding="utf-8").read())

    fixed = 0
    SPANS = spans
    for chapter in doc.get("chapters", []):
        span = SPANS.get(chapter.get("title", "").strip())
        if not span:
            continue
        before = (chapter.get("pdfPage"), chapter.get("pdfPageEnd"))
        chapter["pdfPage"], chapter["pdfPageEnd"] = span
        chapter["located"] = True
        chapter["handAuthored"] = True
        fixed += 1
        print("  %-34s %s-%s -> %d-%d" % (chapter["title"][:34], before[0], before[1], span[0], span[1]))

    missing = [t for t in SPANS if not any(c.get("title", "").strip() == t for c in doc.get("chapters", []))]
    for title in missing:
        # Reported rather than invented: a title absent from the parse means the
        # contents page changed, and guessing an index would misorder the book.
        print("  NOT IN THE PARSE, span not applied: %s" % title)

    io.open(path, "w", encoding="utf-8", newline="\n").write(
        json.dumps(doc, ensure_ascii=False, indent=1))
    return fixed


def main() -> None:
    total = 0
    for book, spans in BOOKS.items():
        print("== %s" % book)
        total += patch(book, spans)
    print("\n  %d span(s) corrected across %d book(s)" % (total, len(BOOKS)))
    print("  Next: npm run db:seed:taxonomy && npm run corpus:chunks   (WHOLE, never --book)")


if __name__ == "__main__":
    main()
