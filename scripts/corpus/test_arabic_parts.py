# -*- coding: utf-8 -*-
"""Fixtures for arabic_parts — the Arabic-taught GS papers as parts with answers.

    python scripts/corpus/test_arabic_parts.py

Each case is what a real paper prints, named beside it.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.stdout.reconfigure(encoding="utf-8")

import arabic_parts as ap  # noqa: E402

FAILURES = []


def check(name, ok, detail=""):
    print(f"  {'ok  ' if ok else 'FAIL'} {name}" + ("" if ok else f" — {detail}"))
    if not ok:
        FAILURES.append(name)


print("passage paragraphs taken for questions")
check("prose with no marks and no question (gs/2012 2/arabe.pdf)",
      ap.passage_paragraph("2- انظرْ إلى العالم من داخل تكنْ فناناً، أو انظرْ إليه من خارج تكنْ عالماً. انظرْ إلى العالم "
                           "من باطن تكنْ شاعراً، أو انظرْ إليه من ظاهر تكنْ من رجال التجربة والعلم وهكذا تمضي الحياة.", ""))
check("a question with its marks is kept",
      not ap.passage_paragraph("٤ - لخّص الفقرة الرابعة في ما بين ١٥ و ٢٠ كلمة ، مراعياً أصول التلخيص . (علامة ونصف)", ""))
check("a short question with no marks is kept",
      not ap.passage_paragraph("٤- لخّص الفقرة الخامسة بنسبة الربع مراعياً أصول التلخيص.", ""))
check("'ما' inside a word does not make a question",
      ap.passage_paragraph("٨- ممّا تقدّم، نستطيع القول إنّ تنمية الموارد البشريّة تُعَدّ من أهمّ المسائل على المستويات "
                           "جميعها وإن الإنسان يبقى صاحب الدور الأساسي والمحوري في عملية التطوير والتحديث الدائمة.", ""))

print("answers in the wrong place")
parts = [{"label": "2", "text": "2 - استخرج من المستندات الأفكار التي تظهر: أ- الأهداف", "answer": "أ - النتائج"},
         {"label": "3", "text": "3 - يشير المستند الثالث إلى أهمية الانتخابات",
          "answer": "النوع : نص - المصدر: حوار الأجيال - المسألة: مبدأ دورية الانتخابات"}]
check("type and source under a part that does not ask them (gs/2006 2/tarbeya.pdf)", bool(ap.misplaced(parts, "")))
check("type and source under the part that asks them",
      not ap.misplaced([{"label": "1", "text": "1- قدم كلّا من المستندين: نوعه ومصدره", "answer": "النوع: نص المصدر: قانون"}], ""))

print("one block for a set of items")
items = [{"label": str(k), "text": f"{k}- عبارة"} for k in (1, 2, 3)]
check("numbers listing the items (gs/2018 2/geo.pdf)",
      ap.block_answer([{**items[0], "answer": "1- تشيلي 2- الولايات المتحدة 3- نستله"}, items[1], items[2]]))
check("letters, the only answer among the items (gs/2021 2/SVSG_Geo_2021_2.pdf)",
      ap.block_answer([{**items[0], "answer": "أ- باكستان. ب- أستراليا. ج- المملكة المتحدة"}, items[1], items[2]]))
check("the same block copied under each item",
      ap.block_answer([{**p, "answer": "1- أ 2- ب"} for p in items]))
check("each item with its own answer is not a block",
      not ap.block_answer([{**p, "answer": f"جواب {k}"} for k, p in enumerate(items)]))

print(f"\n{len(FAILURES)} failure(s)")
sys.exit(1 if FAILURES else 0)
