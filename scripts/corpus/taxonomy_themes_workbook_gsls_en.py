# -*- coding: utf-8 -*-
"""States the chapters of the GS/LS English workbook (THEMES Workbook).

    python scripts/corpus/taxonomy_themes_workbook_gsls_en.py
    python scripts/corpus/taxonomy_page_order.py themes_workbook_en --apply

The workbook follows the coursebook chapter for chapter (its contents page, scan
pages 8-9 and 12-14, says so: "a table of contents ... which corresponds to the
Student's Book"), so its nine chapters carry the coursebook's nine names and its
exercises are filed under the same chapter rows as the coursebook's passages.

It had been left out of the database since its taxonomy resolved only three
unit names and its scan is shuffled. taxonomy_page_order.py now puts each
chapter's pages in printed order, from the page map in
corpus/page-audit/dbmaps/themes-workbook-gsls-en__08c8e964.json.

Chapter starts, printed pages, from the contents page:
    Unit 1  13  25  39      Unit 2  55  75  95      Unit 3  119  145  169
"""
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
BOOK = "themes-workbook-gsls-en__08c8e964"
TITLES = [
    ("Natural Phenomena", "Natural Phenomena — The World Within Us", 13),
    ("Natural Phenomena", "Natural Phenomena — The World Around Us", 25),
    ("Natural Phenomena", "Natural Phenomena — New Worlds", 39),
    ("Technology", "Technology — The World Within Us", 55),
    ("Technology", "Technology — The World Around Us", 75),
    ("Technology", "Technology — New Worlds", 95),
    ("Current Concerns", "Current Concerns — The World Within Us", 119),
    ("Current Concerns", "Current Concerns — The World Around Us", 145),
    ("Current Concerns", "Current Concerns — New Worlds", 169),
]

chapters = [{"index": i + 1, "title": t, "unit": u, "printed": p, "pdfPage": 1, "pdfPageEnd": 203,
             "pdfOffset": None, "pdfEndOffset": None, "handAuthored": True}
            for i, (u, t, p) in enumerate(TITLES)]
out = {"book": BOOK, "contentsPage": 8, "pageOffset": None, "unitCount": 3, "chapters": chapters,
       "source": "scripts/corpus/taxonomy_themes_workbook_gsls_en.py; page lists from taxonomy_page_order.py"}
(ROOT / "corpus" / "taxonomy" / f"{BOOK}.json").write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"wrote {len(chapters)} chapters; now run taxonomy_page_order.py themes_workbook_en --apply")
