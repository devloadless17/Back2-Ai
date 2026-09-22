# -*- coding: utf-8 -*-
"""States the chapter spans for the LH Arabic-philosophy book.

    python scripts/corpus/taxonomy_falsafa_arabiya.py

الفلسفة, Section Literature and Humanities — the Arabic-philosophy half of
the LH philosophy curriculum (falsafa-3amma-lh covers the general half).
265 scanned pages, six محاور, 17 فصول.

WHAT IT WAS DOING. The taxonomy held six entries, four of them sharing the
index 2 (a duplicate key) and one ("الله والحرية الإنسانية") never located at
all. Only "وجود الله" (محور 2 فصل 1) was placed correctly. Every other
"located" entry was actually pointing at the WRONG chapter's opening —
"الفضائل والرذائل" (محور 3 فصل 2) was recorded at page 89, which is really
where محور 3 فصل 1 ("مسألة الخير والشر") begins, so a student opening
"الفضائل والرذائل" got a different chapter's ethics essay instead. The three
chapters of محور 1 (الإنسان) were entirely missing, and so were محور 4 in
full and half of محور 5. "الحرية والتقدم", the last chapter in the book, had
no row at all.

The fهرس (page 9 of the scan) is a real, readable two-column table — unlike
several books in this corpus its numbers were never the problem. What broke
here was locating the chapters in the BODY: this book prints philosopher
biographies ("حياته ونسبه", "حياته") inside several chapters, and those
biography sections apparently outscored the chapter's own opening heading in
the automatic search, which is why the placements drifted onto neighbours.

WHY THE SPANS ARE STATED HERE. Same reasoning as taxonomy_ejtema3.py and
taxonomy_ektesad.py: an override still resolves chapters by locating their
titles in the body, which is exactly the step that went wrong, so an override
would reproduce the same drift. The page numbers below are pages OF THE SCAN,
read off the المحور / chapter-number heading the book prints at the top of
each chapter's own opening page — verified by opening each page and reading
it, not inferred from the فهرس's printed page numbers (which run on a
different, offset count: e.g. "وجود الله" prints as page 56 in the فهرس and
opens on scan page 57).

"الحرية والتقدم" is the one exception: its own chapter divider lists all
three محور 6 titles together with no per-chapter page (page 233), and the
book never prints a second typeset heading for it the way the other sixteen
chapters get one — its content is reached by a softer transition after محور
6 فصل 2's own "خاتمة" (page 254). Scan page 256 is where the tone shifts from
that conclusion to the new chapter's subject; there is no sharper anchor to
give it. Flagged inferred=True for that reason alone.

TITLES ARE COPIED FROM THE فهرس, character for character.
"""

import io
import json
import pathlib
import sys

sys.stdout.reconfigure(encoding="utf-8")

ROOT = pathlib.Path(__file__).resolve().parents[2]
BOOK = "falsafa-arabiya-lh__86df4a40"
LAST_PAGE = 265

# (title, unit, first page OF THE SCAN, inferred?)
CHAPTERS = [
    # ---- محور 1: الانسان في الفلسفة العربية — was entirely missing ----
    ("مراتبها، قواها، روحانية النفس الإنسانية (إبن سينا)", "الانسان في الفلسفة العربية", 14, False),
    ("خلودها (إبن سينا - أخوان الصفا)", "الانسان في الفلسفة العربية", 30, False),
    ("العقل: جوهر أم عرضية (إبن سينا، المحاسبي)", "الانسان في الفلسفة العربية", 44, False),
    # ---- محور 2: في الالهيات (فلسفة عربية) ----
    ("وجود الله (إبن سينا، أخوان الصفاء، المعري)", "في الالهيات (فلسفة عربية)", 57, False),
    ("الله والحرية الإنسانية (المعتزلة، الغزالي)", "في الالهيات (فلسفة عربية)", 73, False),
    # ---- محور 3: في الأخلاق (فلسفة عربية) ----
    ("مسألة الخير والشر (المعري، الغزالي، ابن عربي)", "في الأخلاق (فلسفة عربية)", 89, False),
    ("الفضائل والرذائل (مسكويه، يحيى ابن عدي)", "في الأخلاق (فلسفة عربية)", 108, False),
    # ---- محور 4: السياسة والاجتماع في الفلسفة العربية — was entirely missing ----
    ("نشأة المجتمع", "السياسة والاجتماع في الفلسفة العربية", 125, False),
    ("العمل والثروة والملكية (إخوان الصفا، الماوردي، ابن خلدون)", "السياسة والاجتماع في الفلسفة العربية", 138, False),
    ("الدولة الفاضلة (الفارابي، إخوان الصفا)", "السياسة والاجتماع في الفلسفة العربية", 153, False),
    # ---- محور 5: في المعرفة (فلسفة عربية) ----
    ("العقل والدين (ابن رشد، فصل المقال)", "في المعرفة (فلسفة عربية)", 168, False),
    ("المعرفة الإشراقية", "في المعرفة (فلسفة عربية)", 185, False),
    ("الشك واليقين (المعري، الغزالي)", "في المعرفة (فلسفة عربية)", 205, False),
    ("سببية المحسوسات (نقدها ونقد النقد)", "في المعرفة (فلسفة عربية)", 220, False),
    # ---- محور 6: قضايا معاصرة في الفلسفة العربية ----
    ("إشكالية الشرق والغرب", "قضايا معاصرة في الفلسفة العربية", 233, False),
    ("التراث والحداثة", "قضايا معاصرة في الفلسفة العربية", 243, False),
    ("الحرية والتقدم", "قضايا معاصرة في الفلسفة العربية", 256, True),
]


def main() -> None:
    chapters = []
    for i, (title, unit, start, inferred) in enumerate(CHAPTERS):
        end = CHAPTERS[i + 1][2] - 1 if i + 1 < len(CHAPTERS) else LAST_PAGE
        c = {
            "index": i + 1, "title": title, "printed": None, "unit": unit,
            "pdfPage": start, "pdfOffset": 0, "located": True, "pdfPageEnd": end,
        }
        if inferred:
            c["inferred"] = True
        chapters.append(c)
    doc = {"book": BOOK, "contentsPage": 9, "pageOffset": None,
           "unitCount": len({c["unit"] for c in chapters}),
           "handAuthored": True, "chapters": chapters}
    path = ROOT / "corpus" / "taxonomy" / f"{BOOK}.json"
    io.open(path, "w", encoding="utf-8", newline="\n").write(
        json.dumps(doc, ensure_ascii=False, indent=1))
    for c in chapters:
        flag = " (inferred)" if c.get("inferred") else ""
        print("  %3d-%-3d  [%s] %s%s" % (c["pdfPage"], c["pdfPageEnd"], c["unit"][:20], c["title"], flag))
    print("\n  %d chapters, %d units -> corpus/taxonomy/%s.json" % (len(chapters), doc["unitCount"], BOOK))
    print("  Next: npm run db:seed:taxonomy && npm run corpus:chunks   (WHOLE, never --book)")


if __name__ == "__main__":
    main()
