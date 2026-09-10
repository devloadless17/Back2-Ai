# -*- coding: utf-8 -*-
"""States the chapter spans for the SE economics book.

    python scripts/corpus/taxonomy_ektesad.py

التنمية والسياسات الاقتصادية, التعليم الثانوي السنة الثالثة, فرع الاجتماع
والاقتصاد. 315 scanned pages, six محاور, 35 فصول.

WHAT IT WAS DOING. The corpus held twelve chapters for this subject, and they
were محاور 4 and 5 — nothing else. محور 1 (قضايا النمو والبطالة, nine chapters),
محور 2 (الأنظمة الاقتصادية المعاصرة), محور 3 (الدورات والأزمات) and محور 6
(الإدارة, nine chapters) did not exist at all. So the first chapter that DID
exist, "سياسة مكافحة التضخم المالي", absorbed every page before it and held 142
of the subject's 343 passages, while "سياسة النهضة الاقتصادي" and "دالة الإنتاج
ومروبة الإنتاج" held none.

The cause is that the contents table runs across TWO pages of the scan and they
are out of order: page 9 carries محاور 1 and 2, page 8 carries محاور 4 and 5.
`find_contents_pages` took one of them. That is the same shape as the sociology
book, whose فهرس listed only half of itself.

THE FIRST TWELVE TITLES ARE THE DATABASE'S, character for character, and two of
them are WRONG as Arabic:

    stored  سياسة النهضة الاقتصادي        the book prints  سياسة النهوض الاقتصادي
    stored  دالة الإنتاج ومروبة الإنتاج    the book prints  دالة الانتاج ومرونة الانتاج

"مروبة" is not a word; it is an OCR error for "مرونة" (elasticity). They are kept
exactly as stored anyway, because `load-chunks` resolves a chapter BY NAME and a
corrected spelling creates a NEW chapter, leaving the old one holding the
questions and the student's mastery. Correcting them is a rename in the database
plus a re-file, not an edit here.

Page numbers are pages OF THE SCAN, read off the الفصل heading the book prints at
the top of each chapter's opening page, so no offset arithmetic is involved.
"""

import io
import json
import pathlib
import sys

sys.stdout.reconfigure(encoding="utf-8")

ROOT = pathlib.Path(__file__).resolve().parents[2]
BOOK = "economics-se__7979fbf6"
LAST_PAGE = 315

CHAPTERS = [
    # ---- محور 1: قضايا النمو والبطالة — new ----
    ("الثورات الصناعية", 18),
    ("التطور الاقتصادي والاجتماعي للبلدان الصناعية", 24),
    ("التقسيم الدولي للعمل", 28),
    ("الأوضاع الاقتصادية والاجتماعية في البلدان النامية", 35),
    ("تطور مفهوم التنمية", 45),
    ("المؤشرات الاقتصادية والمالية للتنمية", 49),
    ("المؤشرات الاجتماعية والصحية والديموغرافية للتنمية", 54),
    ("المؤشرات الثقافية والتربوية والسياسية للتنمية", 63),
    ("تجارب التنمية", 68),
    # ---- محور 2: الأنظمة الاقتصادية المعاصرة ودور الدولة — new ----
    ("النظام الليبرالي", 85),
    ("النظام الاشتراكي", 93),
    # ---- محور 3: الدورات والأزمات الاقتصادية — new ----
    ("الدورة الاقتصادية", 101),
    ("أزمة 1929 الاقتصادية العالمية", 109),
    ("أزمة 1973 الاقتصادية العالمية", 120),
    # ---- محور 4: السياسات الاقتصادية — already in the database ----
    ("سياسة النهضة الاقتصادي", 127),          # book: النهوض. Stored spelling kept.
    ("سياسة مكافحة التضخم المالي", 134),
    ("سياسة مكافحة البطالة", 142),
    ("السياسة الزراعية", 150),
    ("السياسة الصناعية", 157),
    # ---- محور 5: الحسابات الاقتصادية والمالية — already in the database ----
    ("الكلفة الثابتة والكلفة المتغيرة", 174),
    ("دالة الاستهلاك", 189),
    ("دالة الإنتاج ومروبة الإنتاج", 201),      # book: مرونة. Stored OCR error kept.
    ("الاستثمار", 214),
    ("الفائدة البسيطة والفائدة المركبة", 224),
    ("الجدوى الاقتصادية", 230),
    ("مدخل إلى التحليل المالي", 240),
    # ---- محور 6: الإدارة — new ----
    ("مفهوم الإدارة وأبعادها", 246),
    ("الفكر الإداري عبر مدارسه", 255),
    ("التخطيط الاداري", 265),
    ("وظيفة التنظيم", 268),
    ("التحفيز وتنمية الدافعية للعمل", 280),
    ("التوجيه الاداري", 285),
    ("الرقابة", 292),
    ("إتخاذ القرارات", 303),
    ("المتغيرات البيئية", 310),
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
