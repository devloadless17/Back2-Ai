# -*- coding: utf-8 -*-
"""States the chapter spans for the GS and LS maths revision-summary booklets.

    python scripts/corpus/taxonomy_math_summary_gsls.py

Source: corpus/extra_ref (a teacher-made revision summary, credited "Teacher:
Hussein Raad", not a CRDP textbook). Three pages: Probability, Logarithmic
Function, Exponential Function.

GS and LS study the SAME three topics but their real textbooks title the
logarithm chapter differently: math-gs-2-en__56566975 calls it "Natural
Logarithm", math-er__9de6de98 (LS) calls it "Logarithm functions". Chapter
identity in this corpus is matched by (subject, exact folded title,
occurrence count within the book) — see prisma/taxonomy-loader.ts — so one
taxonomy with one title could only fuse into one of the two tracks' books.
Hence two small books here, math-summary-gs-en and math-summary-ls-en, same
three pages of content (corpus/text/math-summary-{gs,ls}-en__850c80de),
differing only in the logarithm chapter's title. "Probability" maps to each
book's "Conditional probability" and "Exponential Function" to each book's
"Exponential functions" - those titles are identical in both books, so one
title list would have worked for them; the logarithm split forces the rest
to be duplicated too, which is a small price for exact fusion on all three.
"""

import io
import json
import pathlib
import sys

sys.stdout.reconfigure(encoding="utf-8")

ROOT = pathlib.Path(__file__).resolve().parents[2]

# (book, log-chapter title)
BOOKS = [
    ("math-summary-gs-en__850c80de", "Natural Logarithm"),
    ("math-summary-ls-en__08a572ca", "Logarithm functions"),
]

LAST_PAGE = 3


def build(book: str, log_title: str) -> None:
    chapters_spec = [
        ("Conditional probability", 1),
        (log_title, 2),
        ("Exponential functions", 3),
    ]
    chapters = []
    for i, (title, page) in enumerate(chapters_spec):
        nxt = chapters_spec[i + 1] if i + 1 < len(chapters_spec) else None
        c = {
            "index": i + 1, "title": title, "printed": None, "unit": None,
            "pdfPage": page, "pdfOffset": 0, "located": True,
        }
        c["pdfPageEnd"] = nxt[1] if nxt else LAST_PAGE
        chapters.append(c)
    doc = {"book": book, "contentsPage": None, "pageOffset": None,
           "unitCount": 0, "handAuthored": True, "chapters": chapters}
    path = ROOT / "corpus" / "taxonomy" / f"{book}.json"
    io.open(path, "w", encoding="utf-8", newline="\n").write(
        json.dumps(doc, ensure_ascii=False, indent=1))
    print(book + ":")
    for c in chapters:
        print("  page %d  %s" % (c["pdfPage"], c["title"]))


def main() -> None:
    for book, log_title in BOOKS:
        build(book, log_title)
    print("\nNext: npm run db:seed:taxonomy && npm run corpus:chunks   (WHOLE, never --book)")


if __name__ == "__main__":
    main()
