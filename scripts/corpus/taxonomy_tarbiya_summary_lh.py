# -*- coding: utf-8 -*-
"""States the chapter spans for the LH Civics (تربية وطنية) revision guide.

    python scripts/corpus/taxonomy_tarbiya_summary_lh.py

Source: corpus/extra_ref/LH/تربية الوطنية.../التلخيص الموسع
(Tarbiya_3H_Study_Guide.pdf) - an "Expanded Study Guide" explicitly built
from the CRDP core-content list, and explicit on its own first page that it
is NOT a verbatim copy of the official textbook and does not invent details
the CRDP summary omits.

All 9 titles are copied verbatim from tarbiya__164689a6 (the 229-page real
textbook already in the corpus). Chapter identity is matched by (subject,
exact folded title, occurrence count within the book) - see
prisma/taxonomy-loader.ts - so these fuse into that book's existing chapter
rows. Only 9 of that book's ~29 chapters are covered (media/public-opinion,
then elections); the environment and national-service/associations units are
untouched by this guide.
"""

import io
import json
import pathlib
import sys

sys.stdout.reconfigure(encoding="utf-8")

ROOT = pathlib.Path(__file__).resolve().parents[2]
BOOK = "tarbiya-summary-lh-ar__30268b5f"

# (title, page) - titles copied verbatim from tarbiya__164689a6
CHAPTERS = [
    ("الإعلام ودوره في تكوين الرأي العام", 1),
    ("الإعلام والحياة الديمقراطية", 2),
    ("الخلقية الإعلامية", 3),
    ("حرية الإعلام", 4),
    ("المغتربون والوطن الأم", 5),
    ("الديمقراطية والانتخابات", 6),
    ("الانتخابات النيابية", 7),
    ("الانتخابات البلدية والاختيارية، وانتخابات الجمعيات والنقابات والأحزاب", 8),
    ("أنظمة الانتخاب", 9),
]

LAST_PAGE = 9


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
