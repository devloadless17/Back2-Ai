# -*- coding: utf-8 -*-
"""States the chapter spans for the GS/LS English reader, from its re-scan.

    python scripts/corpus/taxonomy_themes_gsls_en.py

THEMES, Secondary Education Third Year, General Sciences / Life Sciences.
139 pages, three units of three chapters.

WHY THIS BOOK NEEDED A RE-SCAN. The previous scan (sha c6e87a91) had its pages
physically out of order — scan page 50 carried printed 56 while scan page 52
carried printed 29, and inside a single chapter Part D sat on page 49 with Part C
on page 50. The taxonomy measures ONE offset per book between the printed number
and the scan page, and this file had no such number: most pages ran +1 to +4, one
ran -6, and a block ran +23. Three software routes were tried and reverted —
better contents detection, parsing entries inline, and sorting the contents
sheets into reading order, which made all three English books worse. The book was
recorded as unfixable in code and it was.

The new scan (a301fec1) is in order. Verified before spending anything on it:
scan pages 50-53 read Chapter 3 Part D, Part D, Part E, then Chapter 1 Part A —
a clean unit boundary — where the old scan had Technology's printed 56 sitting
before Natural Phenomena's printed 29.

WHAT IT COST THE CORPUS UNTIL NOW. Three chapters for a 139-page book, with
"Current Concerns" holding 219 of the subject's 236 passages because it ran from
page 15 to the end. Its neighbours held 4 and 14. Two subjects, GS and LS
English, and English is sat by every track.

THE TITLES ARE QUALIFIED BY UNIT, DELIBERATELY. This book repeats the same three
chapter names — The World Within Us, The World Around Us, New Worlds — once in
each of its three thematic units, which `looksUnparsed` in prisma/taxonomy-loader
records as the book's actual design. Stored bare they would be three names listed
three times over with nothing to tell them apart, which is the duplicate-chapter
complaint this work began from.

Spans are pages OF THE SCAN, read off the "Part A" heading that opens every
chapter, so the offset is zero by construction.
"""

import io
import json
import pathlib
import sys

sys.stdout.reconfigure(encoding="utf-8")

ROOT = pathlib.Path(__file__).resolve().parents[2]
BOOK = "themes-gsls-en__a301fec1"
LAST_PAGE = 139

CHAPTERS = [
    ("Natural Phenomena — The World Within Us", 18),
    ("Natural Phenomena — The World Around Us", 32),
    ("Natural Phenomena — New Worlds", 42),
    ("Technology — The World Within Us", 53),
    ("Technology — The World Around Us", 69),
    ("Technology — New Worlds", 79),
    ("Current Concerns — The World Within Us", 88),
    ("Current Concerns — The World Around Us", 103),
    ("Current Concerns — New Worlds", 117),
]


def main() -> None:
    chapters = []
    for i, (title, start) in enumerate(CHAPTERS):
        end = CHAPTERS[i + 1][1] - 1 if i + 1 < len(CHAPTERS) else LAST_PAGE
        chapters.append({
            "index": i + 1, "title": title, "printed": start, "unit": None,
            "pdfPage": start, "pdfOffset": 0, "located": True, "pdfPageEnd": end,
        })
    doc = {"book": BOOK, "contentsPage": 0, "pageOffset": 0, "unitCount": 0,
           "handAuthored": True, "chapters": chapters}
    path = ROOT / "corpus" / "taxonomy" / f"{BOOK}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    io.open(path, "w", encoding="utf-8", newline="\n").write(
        json.dumps(doc, ensure_ascii=False, indent=1))
    for c in chapters:
        print("  %3d-%-3d  %s" % (c["pdfPage"], c["pdfPageEnd"], c["title"]))
    print("\n  %d chapters -> corpus/taxonomy/%s.json" % (len(chapters), BOOK))
    print("  catalog.csv must point at this folder, not themes-gsls-en__c6e87a91")


if __name__ == "__main__":
    main()
