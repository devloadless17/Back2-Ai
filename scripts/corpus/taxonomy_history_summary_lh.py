# -*- coding: utf-8 -*-
"""States the chapter spans for the LH History revision-summary booklets.

    python scripts/corpus/taxonomy_history_summary_lh.py

Source: corpus/extra_ref/LH/التاريخ/الكتاب (six "History 3H - Lesson N"
study-guide PDFs, 2025-2026, CRDP-aligned but explicitly not the national
edition and not a commercial book - its own last page says so). Condensed
and reorganized here into 11 chapter-length pages
(corpus/text/history-summary-lh-ar__8ff7872c), one lesson sometimes split
across two or three pages where it covered more than one real chapter.

All 11 titles are copied verbatim from tarikh-lubnan-arab__f2a0ce7d (the
89-page real textbook already in the corpus, publisher دار بركات). Chapter
identity here is matched by (subject, exact folded title, occurrence count
within the book) - see prisma/taxonomy-loader.ts - so these passages fuse
into that book's existing chapter rows instead of creating duplicates.
History is a shared subject across all four tracks (GS;LS;SE;LH), matching
tarikh-lubnan-arab's own tracks.

Lesson-to-chapter mapping: Lesson 1 -> ch1; Lesson 2 -> ch2; Lesson 3 splits
into ch3 (mandate/direct rule) and ch4 (Greater Lebanon); Lesson 4 splits
into ch5 (1926 constitution) and ch6 (republic-era events to 1939);
Lesson 5 splits into ch7 (WWII outbreak/Vichy), ch8 (Allied campaign 1941)
and ch9 (political situation under the Allies to the 1943 elections);
Lesson 6 splits into ch10 (National Pact / political independence,
November 1943) and ch11 (economic and military evacuation).

Only chapters 1-11 of tarikh-lubnan-arab's 19 are covered - the six lesson
booklets stop at 1946. Chapters 12-19 (the Arab-world chapters) are not
touched by this book.
"""

import io
import json
import pathlib
import sys

sys.stdout.reconfigure(encoding="utf-8")

ROOT = pathlib.Path(__file__).resolve().parents[2]
BOOK = "history-summary-lh-ar__8ff7872c"

# (title, page) - titles copied verbatim from tarikh-lubnan-arab__f2a0ce7d
CHAPTERS = [
    ("لبنان خلال الحرب العالمية الأولى", 1),
    ("لبنان في فترة الإنتقال من الإحتلال الى الإنتداب", 2),
    ("الانتداب الفرنسي على لبنان", 3),
    ("دولة لبنان الكبير", 4),
    ("نشأة الدستور اللبناني 1926", 5),
    ("أحداث لبنان في ظل الجمهوريّة", 6),
    ("لبنان خلال الحرب العالميّة الثانية", 7),
    ("حملة الحلفاء على لبنان وسوريا خلال الحرب العالمية الثانية", 8),
    ("أوضاع لبنان السياسية في ظل الحلفاء", 9),
    ("تحقيق الاستقلال", 10),
    ("الجلاء الإقتصادي والعسكري", 11),
]

LAST_PAGE = 11


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
