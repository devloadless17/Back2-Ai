# -*- coding: utf-8 -*-
"""States the chapter spans for the SE sociology book.

    python scripts/corpus/taxonomy_ejtema3.py

التفاوت والسّياسات الاجتماعية, التعليم الثانوي السنة الثالثة, فرع الاجتماع
والاقتصاد (ملحم شاوول, منسّق). 283 scanned pages, eight محاور.

WHAT IT WAS DOING. The book's فهرس on page 8 lists only محاور 1-4 — the parser
read it correctly and produced those twelve فصول, and then the LAST of them,
"مجالات وسياسات الدمج والاندماج الاجتماعي", ran from page 129 to the end of the
book. It held **209 of the subject's 320 passages**, swallowing محاور 5, 6, 7
and 8 whole: social change, social policy, culture, and Lebanese society. A
student opening that chapter got a fifth of the book; a student looking for
السياسة الاجتماعية found no chapter at all.

One more was missing entirely — "أنظمة القيم في المجتمعات", محور 2 فصل 2 — and
"التفاوت والتدرج الاجتماعيان" had zero passages.

WHY THE SPANS ARE STATED HERE. The فهرس is partial, so it cannot be transcribed
into a complete override; and for an Arabic book `parse_arabic_leader` discards
an override's page numbers anyway, locating titles in the body instead — which
fails for the twelve whose titles must be spelled as the DATABASE spells them.
The page numbers below are the pages of the scan, read off the الفصل headings
the book prints at the top of each chapter's first page, so no offset arithmetic
is involved.

THE FIRST TWELVE TITLES ARE COPIED FROM THE DATABASE, character for character,
including "الابحاث" without its hamza on chapter 3 — the book prints "الأبحاث"
but the stored row does not, and `load-chunks` resolves a chapter BY NAME. Fixing
the spelling here would create a thirteenth chapter and leave the twelfth holding
the questions. Do not tidy them.

THE OTHER EIGHTEEN ARE NEW: محاور 5 to 8, which the corpus has never had.
"""

import io
import json
import pathlib
import sys

sys.stdout.reconfigure(encoding="utf-8")

ROOT = pathlib.Path(__file__).resolve().parents[2]
BOOK = "ejtema3-se__7fa192d5"
LAST_PAGE = 283

# (title, first page OF THE SCAN). Read from the الفصل heading printed at the
# top of each chapter's opening page. Each chapter runs to the page before the
# next one starts.
CHAPTERS = [
    # ---- محور 1: علم الاجتماع — already in the database ----
    ("ولادة علم الاجتماع", 11),
    ("طرق البحث في علم الاجتماع", 29),
    ("التقنيات البارزة في الابحاث الاجتماعية", 35),
    # ---- محور 2: قيم المجتمع ----
    ("مفهوم القيمة الاجتماعية", 48),
    ("أنظمة القيم في المجتمعات", 59),        # missing from the database entirely
    ("نقل القيم وانتشارها", 64),
    # ---- محور 3: التفاوت الاجتماعي والحراك ----
    ("التفاوت والتدرج الاجتماعيان", 74),
    ("أنظمة التدرج الاجتماعي", 84),
    ("الحراك الاجتماعي", 88),
    ("التفاوت الاجتماعي وأبعاده", 103),
    # ---- محور 4: الاندماج الاجتماعي ----
    ("مفهوم الاندماج وعلاقته بالتفاوت الاجتماعي", 117),
    ("شروط الاندماج الاجتماعي", 125),
    ("مجالات وسياسات الدمج والاندماج الاجتماعي", 129),
    # ---- محور 5: التغير الاجتماعي — new ----
    ("حالات التشكّل والتغير الاجتماعيين", 138),
    ("معايير توصيف التغير الاجتماعي", 143),
    ("عوامل التغيّر", 148),
    ("حركة التغيّر الاجتماعي على الصعيد المحلي والعالمي", 154),
    ("قوى التغيّر ودوافع مقاومته", 159),
    # ---- محور 6: السياسة الاجتماعية — new ----
    ("السياسة الاجتماعية: تعريفها وبرامجها", 163),
    ("الدور الاقتصادي والاجتماعي لدولة العناية", 177),
    ("تطوّر مفهوم السياسة الاجتماعية في لبنان", 183),
    ("السياسة الاجتماعية في مجالي التعليم وتخطيط الأسرة", 196),
    ("الشأن الاجتماعي في الاهتمامات والمبادرات المحلية", 213),
    # ---- محور 7: الثقافة — new ----
    ("مفاهيم الثقافة والظاهرة الثقافية", 221),
    ("تنوّع الثقافة وصناعتها", 233),
    ("اشكاليّة العصرنة في عملية التثاقف", 239),
    # ---- محور 8: المجتمع اللبناني — new ----
    ("التنوع الجغرافي والروحي والتاريخي", 243),
    ("الخصائص السوسيولوجية لسكان لبنان", 258),
    ("اتخاذ القرار في المجتمع المحلي", 270),
    ("التقليد والتجديد في المجتمع اللبناني", 275),
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
    io.open(path, "w", encoding="utf-8", newline="\n").write(
        json.dumps(doc, ensure_ascii=False, indent=1))
    for c in chapters:
        print("  %3d-%-3d  %s" % (c["pdfPage"], c["pdfPageEnd"], c["title"]))
    print("\n  %d chapters -> corpus/taxonomy/%s.json" % (len(chapters), BOOK))
    print("  Next: npm run db:seed:taxonomy && npm run corpus:chunks   (WHOLE, never --book)")


if __name__ == "__main__":
    main()
