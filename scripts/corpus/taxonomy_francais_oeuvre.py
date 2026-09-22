# -*- coding: utf-8 -*-
"""States the chapter spans for the LH French set-works reader.

    python scripts/corpus/taxonomy_francais_oeuvre.py

Table des matières, Section Lettres et Humanités — two genre units (le genre
dramatique, le genre romanesque), each opening with a short genre essay
followed by full set-work studies. 252 scanned pages, 9 chapters.

WHAT IT WAS DOING. The taxonomy held four entries with corrupted index values
(9, 15, 59, 8 — not 1, 2, 3, 4), and "LE GENRE DRAMATIQUE" was never located.
Worse, "L'ÉMIGRÉ DE BRISBANE" ran from page 107 to the end of the book (252),
swallowing "LE GENRE ROMANESQUE" and all four novels that follow it —
L'Étranger, Le Sang des autres, Les Choses, Lettres à un jeune poète — whole.

WHY THE SPANS ARE STATED HERE. The فهرس (page 8 of the scan) is a real,
readable table with correct printed page numbers, but this book prints
several full-page image plates that are not counted in its own printed
pagination, and does so UNEVENLY — the offset between a فهرس page number and
its actual scan page grows from +4 near the front (Dom Juan: فهرس says 15,
opens on scan 19) to +21 by L'Étranger (فهرس says 155, opens on scan 176) and
back down to +12 by Le Sang des autres (فهرس says 179, opens on scan 191) —
so no single offset works, and each chapter's scan page was found by opening
it and reading the chapter's own title card or opening essay.

Two chapters (Le Sang des autres, Les Choses) sit in a stretch of the scan
that is itself out of physical order — the printed-page footers on scan pages
204 and 205 run backwards (202, then 199) — so page ADJACENCY cannot be
trusted there either. Both spans given here were confirmed by a page that
names its own chapter and prints its own page number together in the same
caption (e.g. scan 203: "Les Choses ... LES CHOSES 203"), which holds
regardless of what scan page comes before or after it.

TITLES ARE COPIED FROM THE فهرس, character for character.
"""

import io
import json
import pathlib
import sys

sys.stdout.reconfigure(encoding="utf-8")

ROOT = pathlib.Path(__file__).resolve().parents[2]
BOOK = "francais-oeuvre-lh__7c70d592"
LAST_PAGE = 252

# (title, first page OF THE SCAN)
CHAPTERS = [
    ("LE GENRE DRAMATIQUE", 11),
    ("DOM JUAN de MOLIÈRE", 19),
    ("ANTIGONE de JEAN ANOUILH", 51),
    ("L'ÉMIGRÉ DE BRISBANE de GEORGES SCHÉHADÉ", 107),
    ("LE GENRE ROMANESQUE", 174),
    ("L'ÉTRANGER d'ALBERT CAMUS", 176),
    ("LE SANG DES AUTRES de SIMONE DE BEAUVOIR", 191),
    ("LES CHOSES de GEORGES PEREC", 203),
    ("LETTRES À UN JEUNE POÈTE de RAINER MARIA RILKE", 229),
]


def main() -> None:
    chapters = []
    for i, (title, start) in enumerate(CHAPTERS):
        end = CHAPTERS[i + 1][1] - 1 if i + 1 < len(CHAPTERS) else LAST_PAGE
        chapters.append({
            "index": i + 1, "title": title, "printed": None, "unit": None,
            "pdfPage": start, "pdfOffset": 0, "located": True, "pdfPageEnd": end,
        })
    doc = {"book": BOOK, "contentsPage": 8, "pageOffset": None, "unitCount": 0,
           "handAuthored": True, "chapters": chapters}
    path = ROOT / "corpus" / "taxonomy" / f"{BOOK}.json"
    io.open(path, "w", encoding="utf-8", newline="\n").write(
        json.dumps(doc, ensure_ascii=False, indent=1))
    for c in chapters:
        print("  %3d-%-3d  %s" % (c["pdfPage"], c["pdfPageEnd"], c["title"]))
    print("\n  %d chapters -> corpus/taxonomy/%s.json" % (len(chapters), BOOK))
    print("  Next: npm run db:seed:taxonomy && npm run corpus:chunks   (WHOLE, never --book)")


if __name__ == "__main__":
    main()
