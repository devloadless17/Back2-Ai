# -*- coding: utf-8 -*-
"""States the chapter spans for the SE Français reader.

    python scripts/corpus/taxonomy_francais_se.py

Français, Sociologie et Économie. 228 scanned pages, six themes.

WHAT IT WAS DOING. Five chapters, of which the first began on page 116 — so
pages 1 to 115, more than half the book, belonged to no chapter at all. Two of
the five ("Sous-thème I", "L'URBANISME") never placed and held nothing. Themes 1
and 2, L'ENTREPRISE and CARRIERES ET EMPLOIS, did not exist in the corpus in any
form.

The reason is the same one that hid units in three other books tonight: this
reader has no single table of contents. Each theme carries its OWN SOMMAIRE page
— at pages 11, 36, 66, 96, 121 and 146 — and `find_contents_pages` returned one
of them, page 14, which lists only themes 5 and 6. Everything before theme 5 was
therefore invisible, and the chapters that did exist started where that page
started.

Spans are the SOMMAIRE pages themselves, which is where each theme begins. No
offset arithmetic: the printed numbers on these pages disagree with the scan by
between -2 and +1 depending on the theme, so stating scan pages is both simpler
and more accurate than fitting one offset to all six.

BACK MATTER IS A CHAPTER HERE, DELIBERATELY. Pages 172 to 228 are SYNTHÈSE (le
genre dramatique, la littérature au XXe siècle) and FICHES TECHNIQUES (écrire un
c.v., une lettre de motivation, lire un texte argumentatif). That is taught
material an SE student is examined on, not an index or a glossary — the rule
against filing back matter exists to stop a mastery bar appearing over "Answers
and Hints", and this is the opposite case. Left out, 56 pages would be
unreachable; folded into theme 6, a cinema chapter would answer questions about
writing a CV.

THE THREE STORED TITLES ARE KEPT character for character, in the book's own
capitals. `load-chunks` resolves a chapter BY NAME.
"""

import io
import json
import pathlib
import sys

sys.stdout.reconfigure(encoding="utf-8")

ROOT = pathlib.Path(__file__).resolve().parents[2]
BOOK = "francais-se-fr__a71d1e47"
LAST_PAGE = 228

CHAPTERS = [
    ("L'ENTREPRISE", 11),               # new
    ("CARRIERES ET EMPLOIS", 36),       # new
    ("LE COUPLE", 66),
    ("L'URBANISME", 96),
    ("SCIENCE ET ETHIQUE", 121),
    ("LITTERATURE ET CINEMA", 146),
    ("Synthèse et fiches techniques", 172),   # new; see the note above
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
    io.open(ROOT / "corpus" / "taxonomy" / f"{BOOK}.json", "w", encoding="utf-8", newline="\n").write(
        json.dumps(doc, ensure_ascii=False, indent=1))
    for c in chapters:
        print("  %3d-%-3d  %s" % (c["pdfPage"], c["pdfPageEnd"], c["title"]))
    print("\n  %d chapters -> corpus/taxonomy/%s.json" % (len(chapters), BOOK))


if __name__ == "__main__":
    main()
