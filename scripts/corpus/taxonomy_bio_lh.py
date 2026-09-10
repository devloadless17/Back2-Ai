# -*- coding: utf-8 -*-
"""States the chapter spans for the LH biology book.

    python scripts/corpus/taxonomy_bio_lh.py

Sciences de la vie / Life Sciences, Lettres et Humanités. 154 scanned pages,
four units.

WHAT IT WAS DOING. Five chapters, of which the last — "Cerebral activity and
conditioned reflexes" — ran from page 69 to page 154 and held 104 of the
subject's 168 passages. Everything after it was inside it: the endocrine
system, drugs and drug-addiction, the whole of Unit III (theories of evolution)
and the whole of Unit IV (science and economy, biotechnology). A student
revising biotechnology opened a chapter called "Cerebral activity".

The parser was right about what it could see. The contents table on page 8 lists
Units I and II with dot leaders and page numbers, and stops. Page 12 continues
it — "Chapter 3 Endocrine system", "Unit iii THEORIES OF EVOLUTION" — but as a
graphical layout with no page numbers at all, so there was nothing to read even
if it had been found. Same shape as the sociology and economics books: a
contents page that does not describe the whole book.

The five missing chapters were read off the "Chapter N" heading the book prints
at the top of each chapter's opening page.

THE FIRST FIVE TITLES ARE THE DATABASE'S, character for character, including the
space before the colon in "Nutritional diseases : characteristics...".
`load-chunks` resolves a chapter BY NAME, so a tidied title creates a new chapter
and leaves the old one holding the questions.
"""

import io
import json
import pathlib
import sys

sys.stdout.reconfigure(encoding="utf-8")

ROOT = pathlib.Path(__file__).resolve().parents[2]
BOOK = "biology-lh-en__39d396cf"
LAST_PAGE = 154

CHAPTERS = [
    # ---- Unit I: Nutrition and health — already in the database ----
    ("Diversity of food habits", 13),
    ("The basic principles of balanced diets", 21),
    ("Nutritional diseases : characteristics, causes and prevention", 43),
    # ---- Unit II: Neurobiology, human behaviour and health ----
    ("Neural communication", 57),
    ("Cerebral activity and conditioned reflexes", 69),
    ("The endocrine system and hormonal communication", 82),   # new
    ("Drugs and drug-addiction", 100),                          # new
    # ---- Unit III: Theories of evolution — new ----
    ("Theories of evolution", 113),
    # ---- Unit IV: Science and economy — new ----
    ("Biotechnology and immunology", 128),
    ("Biotechnology, agriculture and environment", 139),
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
