# -*- coding: utf-8 -*-
"""Rebuilds the history textbook from its six scanned parts, and its chapters.

    python scripts/corpus/assemble_history.py

المنهج الجديد في التاريخ — لبنان والعالم العربي (حسين عبيد / نادية حمزة, دار
بركات), الثانوية العامة, الفروع كافة. It arrived as six separate scans in
`corpus/history/` with no text layer and no contents page. `ocr_pdf.py` read
each part; this puts them back together and states the chapter spans.

WHY THIS FILE EXISTS AT ALL. Everything it writes lives under `corpus/`, which
is gitignored — so without a committed generator the taxonomy is one
`taxonomy.py` run away from being lost, and the chapter list is hand-derived
work that cannot be regenerated from anything else.

WHY THE PAGES ARE RENUMBERED RATHER THAN CONCATENATED. The six parts run at six
different offsets between the scan and the page the book prints: +4, +30, +45,
+52, +59, +73. Concatenated, no single offset describes the book — and one
offset per book is exactly what the taxonomy measures. themes-gsls-en is
unmappable for that reason and cannot be fixed. Copying each page to
`page-<printed>.md` makes the file number EQUAL the printed number, so the
offset is zero by construction and any gap announces itself: printed 29 and 30
are absent from the scan, and nothing else between 5 and 95 is.

WHY THE CHAPTERS ARE WRITTEN HERE AND NOT AS A toc-override. For an Arabic book
`parse_arabic_leader` reads the page numbers in an override and deliberately
discards them — in a mangled RTL contents table there is no telling a page
number from a lesson's own ordinal — and locates titles in the body instead.
The first eleven titles below are copied character-for-character from the
chapters ALREADY in the database so that `load-chunks`, which resolves a chapter
by name, files this book onto them rather than beside them. Those names are not
the book's own headings, so they do not locate in its body, and nine of nineteen
chapters came back unplaced. Stating the spans is the only way to have both.

DO NOT "TIDY" THE FIRST ELEVEN TITLES. A changed hamza or a dropped shadda
makes a new chapter and leaves the old one holding the questions.

THE LAST EIGHT ARE NEW. The subject is لبنان والعالم العربي and the book gives
47 of its 91 pages to the Arab world, but every one of the 237 history questions
in the database was filed into a Lebanon chapter because no other existed —
51 of them mentioning العراق, 50 مصر, 34 سايكس-بيكو or الثورة العربية الكبرى,
22 الجزائر. A student practising تحقيق الاستقلال was being asked about the
Iraqi monarchy.
"""

import glob
import json
import io
import os
import pathlib
import shutil
import sys

sys.stdout.reconfigure(encoding="utf-8")

ROOT = pathlib.Path(__file__).resolve().parents[2]
TEXT = ROOT / "corpus" / "text"
BOOK = "tarikh-lubnan-arab__f2a0ce7d"

# (OCR folder, printed page of that part's first scan page). Measured from the
# page numbers the book prints, which each part carries consistently.
PARTS = [
    ("history-p1__643a38dd", 5),
    ("history-p2__b0c4b41f", 31),
    ("history-p32__779bcd42", 46),
    ("history-p42__d1e4f895", 53),
    ("history-p5__d899ed38", 60),
    ("history-p6__ed14ffa7", 74),
]

# (title, first printed page). Each chapter runs to the page before the next.
# Derived from the محور/درس headings the book prints in its own body.
CHAPTERS = [
    ("لبنان خلال الحرب العالمية الأولى", 7),
    ("لبنان في فترة الإنتقال من الإحتلال الى الإنتداب", 13),
    ("الانتداب الفرنسي على لبنان", 18),
    ("دولة لبنان الكبير", 20),
    ("نشأة الدستور اللبناني 1926", 24),
    ("أحداث لبنان في ظل الجمهوريّة", 27),
    ("لبنان خلال الحرب العالميّة الثانية", 31),
    ("حملة الحلفاء على لبنان وسوريا خلال الحرب العالمية الثانية", 33),
    ("أوضاع لبنان السياسية في ظل الحلفاء", 36),
    ("تحقيق الاستقلال", 38),
    ("الجلاء الإقتصادي والعسكري", 46),
    # ---- new with this book: the Arab world half of the syllabus ----
    ("العرب في أواخر العهد العثماني", 49),
    ("الثورة العربية الكبرى واتفاقية سايكس - بيكو", 57),
    ("قيام الجمهورية التركية", 61),
    ("سوريا في ظل الانتداب الفرنسي", 64),
    ("العراق من الانتداب إلى الملكية", 74),
    ("نشوء المملكة العربية السعودية", 78),
    ("مصر من الاحتلال البريطاني حتى الاستقلال", 80),
    ("الجزائر من الاحتلال الفرنسي حتى الاستقلال", 93),
]
LAST_PAGE = 95


def assemble() -> None:
    placed: dict = {}
    for part, first in PARTS:
        files = sorted(glob.glob(str(TEXT / part / "page-*.md")))
        if not files:
            print(f"  MISSING {part} — run ocr_pdf.py for it first")
            continue
        for f in files:
            n = int(os.path.basename(f)[5:-3])
            placed.setdefault(n + first - 1, []).append(f)
        print(f"  {part:<26} {len(files):>3} pages -> printed {first}-{first + len(files) - 1}")

    if not placed:
        return
    lo, hi = min(placed), max(placed)
    missing = [p for p in range(lo, hi + 1) if p not in placed]
    out = TEXT / BOOK
    out.mkdir(parents=True, exist_ok=True)
    for printed, entries in sorted(placed.items()):
        # Parts 2 and 3 both carry printed 46. Keep the fuller transcription.
        best = max(entries, key=lambda f: len(io.open(f, encoding="utf-8", errors="replace").read()))
        shutil.copyfile(best, out / f"page-{printed:03d}.md")
    print(f"\n  printed {lo}-{hi}, {len(placed)} pages, missing {missing or 'none'}")
    print(f"  -> corpus/text/{BOOK}")


def taxonomy() -> None:
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
    print(f"  {len(chapters)} chapters -> corpus/taxonomy/{BOOK}.json")


if __name__ == "__main__":
    assemble()
    taxonomy()
    print("\n  Next:  npm run db:seed:taxonomy")
    print("         npm run corpus:chunks          <- WHOLE, never --book: a single-book")
    print("                                           run prunes other books' passages")
    print("                                           from any chapter they share")
    print("         npm run ingest -- --embed-missing")
