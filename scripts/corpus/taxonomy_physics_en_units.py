# -*- coding: utf-8 -*-
"""Patches unit labels onto the GS/LS physics (English) taxonomy.

    python scripts/corpus/taxonomy_physics_en_units.py

Run AFTER taxonomy.py has (re)built physics-en__7f314f5e.json — this only
layers two corrections on top of that output, it does not re-derive the
chapter spans, which are already correct.

WHY THE AUTOMATIC BUILD MISSED THE UNITS. The book's contents page (page 8 of
the scan) prints each unit as "Unit" on one line and the roman numeral + title
on the next — OCR turned the numerals into leader-dot noise ("Unit\n ..... 1
Mechanics", "Unit\n ..... யும்" for Unit III, Tamil garbage for a mangled "iii").
The UNIT regex in taxonomy.py expects the label and numeral on one line, so it
never matched here, even though the same regex reads the French edition's
clean "Unité 1 Mécanique" correctly. Scan-specific noise, not a pattern the
general parser should be bent to catch.

The four units and their chapter ranges are read directly off that same
contents page (chapters 1-7 Mechanics, 8-12 Electricity, 13-16 Aspects of
Light, 17-21 Atom, Nucleus and Universe) and confirmed against the printed
cover in corpus/text/physics-en__7f314f5e/page-008.md.

Also fixes chapter 7's title, which kept raw OCR/LaTeX markup instead of the
plain "(*)" every other starred chapter in this corpus uses:
"Special Relativity ( ${ }^{*}$ )" -> "Special Relativity (*)".
"""

import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
PATH = ROOT / "corpus" / "taxonomy" / "physics-en__7f314f5e.json"

UNITS = [
    ("Mechanics", range(1, 8)),
    ("Electricity", range(8, 13)),
    ("Aspects of Light", range(13, 17)),
    ("Atom, Nucleus and Universe", range(17, 22)),
]

TITLE_FIX = {7: "Special Relativity (*)"}


def main() -> None:
    doc = json.loads(PATH.read_text(encoding="utf-8"))
    unit_by_index = {i: name for name, idxs in UNITS for i in idxs}

    for c in doc["chapters"]:
        c["unit"] = unit_by_index.get(c["index"])
        if c["index"] in TITLE_FIX:
            c["title"] = TITLE_FIX[c["index"]]

    doc["unitCount"] = len(UNITS)
    PATH.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")

    for c in doc["chapters"]:
        print("  %2d  [%-27s] %s" % (c["index"], c["unit"], c["title"]))
    print("\n  %d chapters, %d units -> %s" % (len(doc["chapters"]), doc["unitCount"], PATH))


if __name__ == "__main__":
    main()
