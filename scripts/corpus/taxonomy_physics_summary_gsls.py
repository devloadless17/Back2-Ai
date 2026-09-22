# -*- coding: utf-8 -*-
"""States the chapter spans for the GS/LS physics revision-summary booklet.

    python scripts/corpus/taxonomy_physics_summary_gsls.py

Source: corpus/extra_ref (a teacher-made revision summary, credited
"@husseinfneish386", not a CRDP textbook). It is a synthetic 6-page
transcription (corpus/text/physics-summary-gsls-en__091252dd), one page per
topic, condensed from the original 24-page PDF.

Five of its six chapters are titled to match physics-en__7f314f5e's own
chapter titles character for character: "Linear Momentum", "Corpuscular
Aspect of Light. Photoelectric Effect", "The Atom", "Atomic Nucleus",
"Radioactivity". Chapter identity in this corpus is matched by
(subject, exact folded title, occurrence count within the book) — see
prisma/taxonomy-loader.ts — so these five chapters share the SAME chapter
row as the real textbook instead of creating duplicates; the summary's
passages are added alongside the textbook's own.

The sixth, "RC Circuits" (source: "CHAPTER 10.1 CAPACITORS"), has no match
anywhere in physics-en's chapter list under any unit, so it is filed as its
own new chapter under Electricity rather than force-fit into an unrelated one.

Units are copied from physics-en__7f314f5e for the five matched chapters so
ordering stays sensible; RC Circuits is placed under Electricity, the closest
existing unit.
"""

import io
import json
import pathlib
import sys

sys.stdout.reconfigure(encoding="utf-8")

ROOT = pathlib.Path(__file__).resolve().parents[2]
BOOK = "physics-summary-gsls-en__091252dd"

# (title, unit, page) - one page per chapter, in corpus/text/<book>/page-NNN.md
CHAPTERS = [
    ("Linear Momentum", "Mechanics", 1),
    ("RC Circuits", "Electricity", 2),
    ("Corpuscular Aspect of Light. Photoelectric Effect", "Aspects of Light", 3),
    ("The Atom", "Atom, Nucleus and Universe", 4),
    ("Atomic Nucleus", "Atom, Nucleus and Universe", 5),
    ("Radioactivity", "Atom, Nucleus and Universe", 6),
]

LAST_PAGE = 6


def main() -> None:
    chapters = []
    for i, (title, unit, page) in enumerate(CHAPTERS):
        nxt = CHAPTERS[i + 1] if i + 1 < len(CHAPTERS) else None
        c = {
            "index": i + 1, "title": title, "printed": None, "unit": unit,
            "pdfPage": page, "pdfOffset": 0, "located": True,
        }
        c["pdfPageEnd"] = nxt[2] if nxt else LAST_PAGE
        chapters.append(c)
    doc = {"book": BOOK, "contentsPage": None, "pageOffset": None,
           "unitCount": len({c["unit"] for c in chapters}),
           "handAuthored": True, "chapters": chapters}
    path = ROOT / "corpus" / "taxonomy" / f"{BOOK}.json"
    io.open(path, "w", encoding="utf-8", newline="\n").write(
        json.dumps(doc, ensure_ascii=False, indent=1))
    for c in chapters:
        print("  page %d  [%-28s] %s" % (c["pdfPage"], c["unit"], c["title"]))
    print("\n  %d chapters -> corpus/taxonomy/%s.json" % (len(chapters), BOOK))
    print("  Next: npm run db:seed:taxonomy && npm run corpus:chunks   (WHOLE, never --book)")


if __name__ == "__main__":
    main()
