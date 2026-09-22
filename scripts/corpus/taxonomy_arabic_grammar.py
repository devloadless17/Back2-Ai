# -*- coding: utf-8 -*-
"""States the chapter spans for the LH Arabic grammar/rhetoric/prosody book.

    python scripts/corpus/taxonomy_arabic_grammar.py

قواعد اللغة العربية والبلاغة والعروض, Section Literature and Humanities.
Imported from .docx, so "pages" here are synthetic text chunks, not scanned
pages — there is no printed-to-scan offset to reason about, only body
headings to find.

WHAT IT WAS DOING (first pass). The taxonomy had 16 chapters across two units
(القواعد, العَروض) and no البلاغة (Rhetoric) unit at all, even though the
book's own فهرس (page 2-3 of the scan) prints one with six chapters. The
فهرس's fourth القواعد item, "متفرّقات", was also missing, and "ظرفُ المكان
وظرف الزمان" ran all the way to page 78 as a result, absorbing all of it.

WHAT IT WAS STILL MISSING (second pass). The فهرس's second and third القواعد
items — "٢. المصدر وعمله" and "٣. أسماء تعمل عمل الفعل" (اسم الفاعل, اسم
المفعول, صيغ المبالغة, الصفة المشبّهة) — were five more real chapters "ظرفُ
المكان وظرف الزمان" was still absorbing. They have no Word heading style in
the .docx (unlike البلاغة onward, which does), so a style-based search found
nothing, and their scan pages (17-28) are not in topic order at first glance
— page 21 is still اسم الفاعل, page 22 jumps to a متفرّقات topic, page 23
continues it, page 24 returns to اسم الفاعل examples. They were found anyway
by reading the actual .docx (corpus/arabe/kawa3ed.docx, extracted directly —
not through corpus/text/) in its own paragraph order, which is NOT scrambled;
each chapter's heading was then located in corpus/text/<book>/page-NNN.md by
searching for its first sentence, which is what these page numbers below are.
The apparent page disorder is real (a later chapter's examples do sit before
an earlier chapter's exercises finish, e.g. page 22's متفرّقات content
between page 21 and 24's اسم الفاعل content) but did not extend to these five
chapters, which turned out to run in a clean, contiguous block once located.

WHY THE SPANS ARE STATED HERE. Same as the other hand-authored books in this
corpus: locating a title in the body is exactly the step that missed these
chapters, so an override would not fix it. Every page number below was
confirmed against the actual page text, except "الاستعارة" (page 54), which
has no clean typeset heading — the pages around it are worked examples — and
is a good-faith estimate.

KNOWN REMAINING GAP, NOT FIXED HERE. العَروض's البحور (poetic metre) listing —
the sixteen named metres (الطويل, البسيط, الوافر...) that "الوزن العروضي"
introduces — and the chapters after it (الإيقاع, التجديد) sit in a stretch of
the .docx whose own heading order is scrambled at the SOURCE level: its
Heading-styled sections run page 119 -> 170 -> 169 -> 178 -> 175 -> 177 ->
176 -> 174 -> 183 -> 182 -> 179 -> 181 -> 180 -> 184, not sequentially, and
pages 120-169 (which should hold the البحور list) do not appear as headed
text in that range at all. This is a defect in the source document, the same
class of problem as themes-workbook-gsls-en__08c8e964's physically-out-of-
order scan, and needs a source-level fix, not more reading. "الوزن العروضيّ,
والبحور الشعرية", "الإيقاع" and "التجديد" below keep the page numbers the
existing corpus already had for them, which is the best available without
that fix.

TITLES ARE COPIED FROM THE فهرس, character for character, except the five new
القواعد chapters and "متفرّقات", whose titles come from the body headings
themselves (the فهرس abbreviates some of them, e.g. "التمييز" for what the
body calls "تمييز العدد" as a distinct sub-chapter — kept as the corpus
already had it).
"""

import io
import json
import pathlib
import sys

sys.stdout.reconfigure(encoding="utf-8")

ROOT = pathlib.Path(__file__).resolve().parents[2]
BOOK = "arabic-grammar-lh__27a53b20"

# (title, unit, pdfPage, pdfOffset, note)
CHAPTERS = [
    # ---- القواعد — chapters 1-7 unchanged from the existing corpus ----
    ("المفعول المطلق", "القواعد", 2, 75, None),
    ("المصدر النائب عن فعله", "القواعد", 7, 1221, None),
    ("الحال", "القواعد", 8, 149, None),
    ("صاحب الحال", "القواعد", 9, 0, None),
    ("ارتباط الجملة الحاليّة بالواو", "القواعد", 9, 1124, None),
    ("التمييز", "القواعد", 12, 0, None),
    ("تمييز العدد", "القواعد", 12, 887, None),
    # trimmed end: was (78, 1019), swallowing everything up to البلاغة.
    ("ظرفُ المكان وظرف الزمان", "القواعد", 13, 2116, None),
    # ---- القواعد — five more, new: فهرس items 2 and 3, entirely missing ----
    ("المصدر وعمله", "القواعد", 17, 1274, None),
    ("اسم الفاعل وعمله", "القواعد", 20, 387, None),
    ("اسم المفعول وعمله", "القواعد", 24, 170, None),
    ("صيغ المبالغة وعملها", "القواعد", 25, 1173, None),
    ("الصفة المشبّهة وعملها", "القواعد", 27, 358, None),
    # ---- القواعد — متفرّقات, new: فهرس item 4, was entirely missing ----
    ("متفرّقات (كم، أيّ، حتّى، غير، فاء الجزاء، واو رُبَّ، همزتا القطع والوصل، علامات الترقيم، استعمال المعجم)", "القواعد", 28, 1165, None),
    # ---- البلاغة — new unit, was entirely missing ----
    ("البلاغة (تعريف)", "البلاغة", 41, 0, None),
    ("الحقيقة والمجاز", "البلاغة", 43, 0, None),
    ("التشبيه", "البلاغة", 50, 0, None),
    ("الاستعارة", "البلاغة", 54, 0, "estimated - no typeset heading found, page adjoins worked examples on both sides"),
    ("الكناية", "البلاغة", 62, 0, None),
    ("أساليب التعبير الجمليّ: الخبر والإنشاء", "البلاغة", 68, 0, None),
    # ---- العَروض — unchanged from the existing corpus, except as noted ----
    ("التفعيلة", "العَروض", 78, 1019, None),
    ("القافية", "العَروض", 91, 656, None),
    ("أحرف القافية", "العَروض", 94, 629, None),
    # trimmed end from (103, 319) to (103, 0): was swallowing the front of
    # "الكتابة العروضية وتقطيع البيت الشعري", which shares scan page 103.
    ("تنوّع القوافي في القصيدة الواحدة", "العَروض", 98, 208, None),
    # new: was unplaced entirely - shares scan page 103 with "الوزن العروضي"
    # immediately after it; there is no page of its own to point to.
    ("الكتابة العروضيّة وتقطيع البيت الشعريّ", "العَروض", 103, 0, "shares scan page 103 with the next chapter"),
    ("الوزن العروضيّ، والبحور الشعرية", "العَروض", 103, 319, "source scan is out of order past this point (see docstring) - البحور list not verified"),
    ("الإيقاع", "العَروض", 103, 1185, "source scan is out of order here (see docstring) - not re-verified"),
    ("التجديد في الوزن وفي استخدام التفعيلة", "العَروض", 130, 0, "source scan is out of order here (see docstring) - not re-verified"),
]

LAST_PAGE = 144


def main() -> None:
    chapters = []
    for i, (title, unit, page, offset, note) in enumerate(CHAPTERS):
        nxt = CHAPTERS[i + 1] if i + 1 < len(CHAPTERS) else None
        c = {
            "index": i + 1, "title": title, "printed": None, "unit": unit,
            "pdfPage": page, "pdfOffset": offset, "located": True,
        }
        if nxt:
            c["pdfPageEnd"] = nxt[2]
            c["pdfEndOffset"] = nxt[3]
        else:
            c["pdfPageEnd"] = LAST_PAGE
        if note:
            c["note"] = note
        chapters.append(c)
    doc = {"book": BOOK, "contentsPage": 2, "pageOffset": None,
           "unitCount": len({c["unit"] for c in chapters}),
           "handAuthored": True, "chapters": chapters}
    path = ROOT / "corpus" / "taxonomy" / f"{BOOK}.json"
    io.open(path, "w", encoding="utf-8", newline="\n").write(
        json.dumps(doc, ensure_ascii=False, indent=1))
    for c in chapters:
        flag = "  *" if c.get("note") else ""
        print("  %3d.%-5d  [%-10s] %s%s" % (c["pdfPage"], c["pdfOffset"], c["unit"], c["title"][:50], flag))
    print("\n  %d chapters, %d units -> corpus/taxonomy/%s.json" % (len(chapters), doc["unitCount"], BOOK))
    print("  Next: npm run db:seed:taxonomy && npm run corpus:chunks   (WHOLE, never --book)")


if __name__ == "__main__":
    main()
