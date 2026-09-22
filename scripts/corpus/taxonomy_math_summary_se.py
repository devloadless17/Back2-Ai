# -*- coding: utf-8 -*-
"""States the chapter spans for the SE maths revision-summary booklet.

    python scripts/corpus/taxonomy_math_summary_se.py

Source: corpus/extra_ref/ES (a revision summary, not a CRDP textbook; ES in
that folder's own naming is this corpus's SE track). Five pages: bivariate
statistics, general function-study techniques, economic functions,
logarithmic functions, exponential functions.

Three chapters are titled to match math-se-en__de339ba1's own titles
character for character - "Distributions in two variables", "Functions of
economics and social sciences", "Logarithmic functions", "Exponential and
power functions" - so they fuse into the real textbook's chapter rows (see
prisma/taxonomy-loader.ts: matched on subject + exact folded title +
occurrence count within the book). "General Study of Functions" (domain,
limits, derivative rules, symmetry, unique-root arguments) is generic
technique that spans several of that book's chapters rather than belonging
to one, so it is filed as its own new chapter instead of force-fit anywhere.
"""

import io
import json
import pathlib
import sys

sys.stdout.reconfigure(encoding="utf-8")

ROOT = pathlib.Path(__file__).resolve().parents[2]
BOOK = "math-summary-se-en__adbb564e"

CHAPTERS = [
    ("Distributions in two variables", 1),
    ("General Study of Functions", 2),
    ("Functions of economics and social sciences", 3),
    ("Logarithmic functions", 4),
    ("Exponential and power functions", 5),
]

LAST_PAGE = 5


def main() -> None:
    chapters = []
    for i, (title, page) in enumerate(CHAPTERS):
        nxt = CHAPTERS[i + 1] if i + 1 < len(CHAPTERS) else None
        c = {
            "index": i + 1, "title": title, "printed": None, "unit": None,
            "pdfPage": page, "pdfOffset": 0, "located": True,
        }
        c["pdfPageEnd"] = nxt[1] if nxt else LAST_PAGE
        chapters.append(c)
    doc = {"book": BOOK, "contentsPage": None, "pageOffset": None,
           "unitCount": 0, "handAuthored": True, "chapters": chapters}
    path = ROOT / "corpus" / "taxonomy" / f"{BOOK}.json"
    io.open(path, "w", encoding="utf-8", newline="\n").write(
        json.dumps(doc, ensure_ascii=False, indent=1))
    for c in chapters:
        print("  page %d  %s" % (c["pdfPage"], c["title"]))
    print("\n  %d chapters -> corpus/taxonomy/%s.json" % (len(chapters), BOOK))
    print("  Next: npm run db:seed:taxonomy && npm run corpus:chunks   (WHOLE, never --book)")


if __name__ == "__main__":
    main()
